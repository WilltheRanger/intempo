"""Give a model its own bad arithmetic back, and let it try again.

**The pieces for this were all here and never joined up.** `validate.py` has
had `describe_for_retry` since Batch 2 — it names the measures whose durations
do not sum to the time signature and asks for those measures to be re-read —
and nothing has ever called it. A transcription that failed the beat-sum check
was kept as a low-confidence fallback and shown to the musician uncorrected.

This is what replaced the OMR second opinion. That step read the page with
Audiveris and asked a model to check it; it was removed because the engine
needed a 2 GB host to find fewer measures than the model already found. But the
*shape* of it was right, and it survives here with the model on both sides:

    read → check the arithmetic → hand back what does not add up → read again

The one thing that makes it safe is the same thing that made the OMR version
safe: **a correction is taken only if it is not worse.** A model asked to fix
three bars can rewrite thirty, and beat sums are not an opinion.

Why this is worth a second call. A bar whose durations do not sum is *known* to
be wrong — no judgement, just arithmetic — and the model is told which bar and
by how much, so the retry is aimed rather than a re-roll. It is also the one
error that matters most: `alignment.py` builds its expected timeline by
accumulating durations, so a single wrong bar shifts every bar after it.
"""

from __future__ import annotations

import logging

from app.services.ocr.base import OCRProvider, OCRProviderError, OCRResponse
from app.services.ocr.validate import describe_for_retry, validate_measures
from app.services.score_schema import Measure, ScoreJson

log = logging.getLogger(__name__)



#: Appended to the arithmetic complaint. The saving is the whole point.
#:
#: Re-transcribing the page to fix two bars costs the page again — measured,
#: ~2,200 output tokens against the ~250 those two bars actually need. It also
#: re-risks every measure that was already correct: a model given the whole
#: page again is free to change its mind about bar 12, which nobody asked
#: about and which was right.
_ONLY_THESE = (
    "\n\nReturn ONLY the measures listed above, in the same JSON shape, with "
    "their original measure_number values. Do not return the measures that "
    "were not listed — they are correct and will be kept as they are. Set "
    "clef and time_signature to what you read before."
)


def _splice(original: ScoreJson, patch: ScoreJson, asked_for: list[int]) -> ScoreJson:
    """Put the re-read measures back into the score, in place.

    Matched by `measure_number`, not by position: the model returns a handful
    of measures and the numbers are the only thing that says where they belong.

    A measure the model returns that was *not* asked about is ignored. It has
    not been checked against anything, the version already held was not
    reported as broken, and quietly accepting it would let a retry aimed at bar
    3 rewrite bar 12.
    """
    wanted = set(asked_for)
    held = {measure.measure_number: measure for measure in original.measures}
    replacements: dict[int, Measure] = {}
    for measure in patch.measures:
        if measure.measure_number not in wanted:
            continue
        previous = held.get(measure.measure_number)
        # A change of metre belongs to the *bar*, not to the notes in it, and
        # the retry is asked about the notes. A model that fixes four durations
        # and says nothing about the time signature would otherwise delete it —
        # and then the bars after it read short too, because the metre it set
        # was running for all of them. Verified: bar 2 carrying "3/4", re-read
        # with the count corrected, came back with the metre gone and bars 2
        # *and* 3 newly flagged.
        #
        # The patch can still change it. It just cannot lose it by omission.
        if (
            previous is not None
            and measure.time_signature is None
            and previous.time_signature is not None
        ):
            measure = measure.model_copy(
                update={"time_signature": previous.time_signature}
            )
        replacements[measure.measure_number] = measure
    if not replacements:
        return original
    return original.model_copy(
        update={
            "measures": [
                replacements.get(measure.measure_number, measure)
                for measure in original.measures
            ]
        }
    )


def retry_with_arithmetic(
    score: ScoreJson,
    image_bytes: bytes,
    *,
    media_type: str,
    provider: OCRProvider,
    context: str | None = None,
) -> ScoreJson:
    """Return a corrected reading, or the original if the retry does not help.

    Never raises. A retry is an improvement on something that already works, so
    a failure here must leave the first reading standing rather than lose the
    page — the caller has a usable transcription in hand and would be trading
    it for an exception.

    `context` is whatever the first reading was told about this image beyond
    the shared prompt — currently that it is one system cut from a page. It has
    to be repeated here or the retry is a *different question about a different
    thing*: told to renumber a page it thinks it can see all of, a model asked
    to re-read "measure 3" will look for the third bar of the piece rather than
    the third bar of the line, and the correction is spliced onto the wrong bar.
    """
    rows = validate_measures(score)
    note = describe_for_retry(rows)
    if not note:
        return score

    broken = [row.measure_number for row in rows if row.is_problem]
    broken_before = len(broken)
    log.info(
        "%d of %d measure(s) do not add up; asking %s to re-read only those",
        broken_before, len(score.measures), provider.name,
    )

    try:
        ask = note + _ONLY_THESE
        if context:
            ask = f"{context}\n\n{ask}"
        response: OCRResponse = provider.parse(image_bytes, media_type, ask)
    except (OCRProviderError, ValueError) as exc:
        log.info("retry by %s failed, keeping the first reading: %s", provider.name, exc)
        return score

    # Belt and braces, and it is the braces. `_splice` returns the original
    # untouched when nothing in the patch matches a measure that was asked
    # about, so removing this changes no outcome — verified by mutation, which
    # is why there is no test for it and this comment instead. What it buys is
    # the log line and not running the validator over a page nobody corrected.
    if not response.score.measures:
        log.info("retry by %s returned no measures, keeping the first reading", provider.name)
        return score

    # The program does the splicing. The model was asked for the broken bars
    # and nothing else, so what comes back is a handful of measures rather
    # than the page — and the measures that were already right are kept
    # verbatim rather than re-transcribed and re-risked.
    corrected = _splice(score, response.score, broken)
    broken_after = sum(1 for row in validate_measures(corrected) if row.is_problem)
    if broken_after > broken_before:
        # A model asked to fix three bars can rewrite thirty. A rewrite that
        # breaks measures which previously added up has made the page worse
        # while sounding more confident about it.
        log.info(
            "%s's retry breaks more measures than it fixes (%d -> %d); keeping the first reading",
            provider.name, broken_before, broken_after,
        )
        return score

    log.info(
        "%s re-read the page: measures that do not add up %d -> %d",
        provider.name, broken_before, broken_after,
    )
    return corrected

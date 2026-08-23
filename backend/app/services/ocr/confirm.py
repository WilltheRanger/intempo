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
from app.services.score_schema import ScoreJson

log = logging.getLogger(__name__)


def retry_with_arithmetic(
    score: ScoreJson,
    image_bytes: bytes,
    *,
    media_type: str,
    provider: OCRProvider,
) -> ScoreJson:
    """Return a corrected reading, or the original if the retry does not help.

    Never raises. A retry is an improvement on something that already works, so
    a failure here must leave the first reading standing rather than lose the
    page — the caller has a usable transcription in hand and would be trading
    it for an exception.
    """
    rows = validate_measures(score)
    note = describe_for_retry(rows)
    if not note:
        return score

    broken_before = sum(1 for row in rows if row.is_problem)
    log.info("%d measure(s) do not add up; asking %s to re-read them", broken_before, provider.name)

    try:
        response: OCRResponse = provider.parse(image_bytes, media_type, note)
    except (OCRProviderError, ValueError) as exc:
        log.info("retry by %s failed, keeping the first reading: %s", provider.name, exc)
        return score

    corrected = response.score
    if not corrected.measures:
        log.info("retry by %s returned no measures, keeping the first reading", provider.name)
        return score

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

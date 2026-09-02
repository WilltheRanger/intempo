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
from app.services.ocr.validate import (
    clefs_in_force,
    describe_for_retry,
    keys_in_force,
    meters_in_force,
    validate_measures,
)
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
    log.info(
        "%d of %d measure(s) do not add up; asking %s to re-read only those",
        len(broken), len(score.measures), provider.name,
    )
    return ask_and_splice(
        score, image_bytes,
        media_type=media_type, provider=provider,
        bars=broken, note=note,
        context=_joined(what_this_piece_is(score, broken), context),
    )


def ask_and_splice(
    score: ScoreJson,
    image_bytes: bytes,
    *,
    media_type: str,
    provider: OCRProvider,
    bars: list[int],
    note: str,
    context: str | None = None,
) -> ScoreJson:
    """Ask for exactly `bars`, splice back only those, keep the better reading.

    **Split out so a caller can restrict the question to part of the page.**
    `retry_by_system` shows the model one line at a time, and it must name only
    the bars on that line — it computed a per-line note and then called
    `retry_with_arithmetic`, which recomputed its own list from the whole score
    and asked about all of them. So a crop of line 0 went out naming bars on
    line 1, and `_splice` would then accept a reply about bars the model was
    never shown. Which is the exact contamination the crop exists to prevent.

    Never raises. A retry improves something that already works, so its failure
    must leave the first reading standing.
    """
    if not bars:
        return score
    broken_before = sum(1 for row in validate_measures(score) if row.is_problem)

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
    corrected = _splice(score, response.score, bars)
    after_rows = validate_measures(corrected)
    broken_after = sum(1 for row in after_rows if row.is_problem)
    if broken_after > broken_before:
        # A model asked to fix three bars can rewrite thirty. A rewrite that
        # breaks measures which previously added up has made the page worse
        # while sounding more confident about it.
        log.info(
            "%s's retry breaks more measures than it fixes (%d -> %d); keeping the first reading",
            provider.name, broken_before, broken_after,
        )
        return score

    # **And the bars asked about must not drift further from their metre.**
    #
    # Counting broken bars is too coarse on its own: a bar asked about because
    # it held three beats of four can come back holding *one*, leaving the count
    # unchanged, so it was accepted — strictly worse music, reported as no worse.
    # A scripted corrector did exactly that in
    # `test_one_bad_line_does_not_discard_another_line_s_correction`.
    #
    # **But strict improvement is the wrong rule too**, and there is a test that
    # says so and is right: the re-read fixes *pitches* as well, and a bar whose
    # beats stay equally wrong may have had a notehead corrected — which is not
    # cosmetic here, because a tie is validated by two noteheads sharing a pitch,
    # so a wrong pitch can delete an onset. Demanding a better beat sum throws
    # those away.
    #
    # So the measure is **distance**, not count: how far the asked-about bars sit
    # from what their metre says, totalled. Equal distance with different pitches
    # is accepted, as it was; three beats becoming one is not.
    asked = set(bars)

    def _drift(rows_: list) -> float:
        return sum(
            abs(row.actual_beats - row.expected_beats)
            for row in rows_
            if row.measure_number in asked and row.expected_beats is not None
        )

    drifted_before = _drift(validate_measures(score))
    drifted_after = _drift(after_rows)
    if drifted_after > drifted_before + 1e-9:
        log.info(
            "%s's retry moves the bars it was asked about further from the "
            "metre (%.2f -> %.2f beats out); keeping the first reading",
            provider.name, drifted_before, drifted_after,
        )
        return score

    log.info(
        "%s re-read the page: measures that do not add up %d -> %d",
        provider.name, broken_before, broken_after,
    )
    return corrected


def _systems_in(score: ScoreJson) -> list[int]:
    """The staff systems this score knows it was printed on, in order."""
    return sorted({m.system for m in score.measures if m.system is not None})


def _one_line_context(bars: list[int]) -> str:
    """What to tell a model that is being shown a single line of a page.

    **The numbering sentence is the load-bearing half.** `retry_with_arithmetic`
    already warns about this: told to look at "measure 3" while holding what it
    takes to be a whole page, a model reads the third bar of the piece rather
    than the third bar of the line, and the correction is spliced onto the wrong
    bar. Shown a crop, the same model will number what it sees from 1 unless it
    is told not to — and the numbers it is being asked about are the page's.
    """
    first, last = bars[0], bars[-1]
    span = f"bar {first}" if first == last else f"bars {first} to {last}"
    return (
        "This image is a single line of music cut out of a larger page. "
        f"It contains {span}, numbered as they are numbered on the whole page. "
        "Use those numbers in your answer — do not renumber the bars from 1, "
        "and do not report bars that are not in this image."
    )


def _joined(*parts: str | None) -> str | None:
    """The context sentences that exist, in order, or None if there are none."""
    said = [p for p in parts if p]
    return "\n\n".join(said) if said else None


def what_this_piece_is(score: ScoreJson, bars: list[int]) -> str:
    """The key, clef and metre in force where the re-read is being aimed.

    **The key is the one that changes the notes.** `pitch` is an absolute name,
    so a notehead on the F line in D major is `F#4` — and a tie is recognised
    only when two noteheads share a pitch name, so one mis-spelled accidental
    deletes an onset rather than merely looking wrong. A model shown a crop of a
    line does have the key signature printed at its left, but saying it costs
    nothing and removes the one reading error that is invisible to arithmetic:
    a bar can sum perfectly and still be in the wrong key.

    The clef for the same reason and worse — a bass part read as treble is a
    seventh out on every note, which is the mistake `ScoreJson.clef` is
    documented never to guess at.

    The key is taken **at those bars** for the same reason the metre is. A part
    that turns from B-flat to G at bar 7 would otherwise be re-read in B-flat,
    and every F in the crop would come back spelled `F4` where the page prints
    `F#4` — a bar that adds up perfectly, in the wrong key, with a tie the
    pitch mismatch has quietly deleted. When the bars asked about do not agree
    on one key the sentence is dropped rather than guessed at, which is the
    rule the metre below already follows.

    The metre is taken **at those bars**, not from the header: `meters_in_force`
    follows a change, and a page that turns 3/4 at bar 12 would otherwise be
    re-read against the 4/4 it started in — reporting bars that are correct as
    short, which is precisely the false caveat `Measure.time_signature` was
    added to stop.

    Empty when the score states none of the three, which is honest rather than
    unhelpful: an inner page often carries no header at all, and inventing a key
    to sound authoritative is how a wrong note gets written confidently.
    """
    parts: list[str] = []
    wanted = set(bars)
    # **The clef in force at those bars, not the one the page opens in.** This
    # took a clef only when one of the bars asked about *stated* it, so a
    # passage that moved into tenor seven bars earlier was described as the
    # bass part it started as — while the model looked at a tenor crop. A key
    # named wrongly misspells the accidented notes; a clef named wrongly moves
    # every note on the staff, and `read_ties` matches noteheads by pitch, so
    # the mismatch deletes onsets rather than merely looking wrong.
    running_clefs = clefs_in_force(score)
    clefs_at = {
        running_clefs[i]
        for i, measure in enumerate(score.measures)
        if measure.measure_number in wanted and i < len(running_clefs)
    }
    # Straddling a change, say nothing rather than pick one — the same rule the
    # key and the metre already follow.
    clef = clefs_at.pop() if len(clefs_at) == 1 else None
    if clef:
        parts.append(f"a {clef}-clef part")
    # The key where the question is, which is not always the key at the top.
    running_keys = keys_in_force(score)
    keys_at = {
        running_keys[i]
        for i, measure in enumerate(score.measures)
        if measure.measure_number in wanted and i < len(running_keys)
    }
    key = keys_at.pop() if len(keys_at) == 1 else None
    if key and key != "unknown":
        parts.append(f"in {key}")

    said = ""
    if parts:
        said = "This is " + " ".join(parts) + ". "
        if key and key != "unknown":
            said += (
                "Spell every pitch with the accidental the key gives it — a "
                "notehead on a line the key sharpens is written sharp, whether "
                "or not a sharp is printed in front of it. "
            )

    # The metre where the question is, which is not always the metre at the top.
    meters = meters_in_force(score)
    at = {
        meters[i]
        for i, measure in enumerate(score.measures)
        if measure.measure_number in set(bars) and i < len(meters)
    }
    stated = {
        m.time_signature
        for m in score.measures
        if m.measure_number in set(bars) and m.time_signature
    } or ({score.time_signature} if score.time_signature else set())
    if len(stated) == 1 and len(at) <= 1:
        metre = stated.pop()
        if metre and metre != "unknown":
            said += f"These bars are in {metre}."

    return said.strip()


def retry_by_system(
    score: ScoreJson,
    crops: list[bytes],
    *,
    media_type: str,
    provider: OCRProvider,
) -> ScoreJson:
    """Re-read the bars that do not add up, a line at a time.

    **The point is what the model is shown.** `retry_with_arithmetic` hands over
    the whole page and names the bar, which asks a model to count to fourteen on
    a photograph — and a miscount produces a *plausible* correction for the wrong
    bar, which every guard downstream will accept because it adds up. Cropping to
    the line removes the counting problem instead of detecting it.

    **The crops must correspond to the systems the score knows about, or this
    does nothing.** `crop_systems` cuts by ink density and `Measure.system`
    comes from `<print new-system="yes">`; they are two independent opinions
    about how many lines are on the page, and when they disagree there is no way
    to tell which is right. Sending the wrong crop is worse than sending the
    page — the model would be shown music that is not the bar and asked to
    correct it — so a disagreement falls back to the caller's whole-page path.

    Never raises, and returns the score unchanged when it cannot help.
    """
    systems = _systems_in(score)
    if not systems or not crops:
        return score
    if len(crops) != len(systems) or systems != list(range(len(systems))):
        log.info(
            "the page was cut into %d line(s) and the reading names %d; not "
            "cropping the re-read, because there is no way to tell which is right",
            len(crops),
            len(systems),
        )
        return score

    rows = validate_measures(score)
    broken = [row.measure_number for row in rows if row.is_problem]
    if not broken:
        return score

    where = {m.measure_number: m.system for m in score.measures}
    corrected = score
    for system in systems:
        here = [n for n in broken if where.get(n) == system]
        if not here:
            continue

        # The bars this line holds, so the model can be told what it is seeing.
        on_this_line = sorted(
            m.measure_number for m in score.measures if m.system == system
        )
        note = describe_for_retry([row for row in rows if row.measure_number in here])
        if not note:
            continue

        before = sum(1 for row in validate_measures(corrected) if row.is_problem)
        attempt = ask_and_splice(
            corrected,
            crops[system],
            media_type=media_type,
            provider=provider,
            # Only this line's bars, which is the whole point: a reply about a
            # bar the model was not shown must not be accepted.
            bars=here,
            note=note,
            context=_joined(
                what_this_piece_is(corrected, here), _one_line_context(on_this_line)
            ),
        )
        after = sum(1 for row in validate_measures(attempt) if row.is_problem)
        if after > before:
            # Per line rather than once at the end: one bad line must not throw
            # away the corrections another line got right.
            log.info(
                "line %d: the re-read leaves more bars broken (%d -> %d); keeping "
                "what was already read",
                system,
                before,
                after,
            )
            continue
        corrected = attempt

    return corrected

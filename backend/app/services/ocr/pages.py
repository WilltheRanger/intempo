"""Several photographs of the same part, read as one piece of music.

**No orchestral part is one page.** `scores.source_image_url` was a single
column, so a scan was a single photograph: a musician who photographed three
pages of a bass part got the first one transcribed and the other two discarded.
This is the join.

**A joined score is all-or-nothing, and that is the design.** Assembling a
piece out of whichever pages happened to read produces a timeline with a
silent hole in the middle of it, and `alignment.py` accumulates durations — so
every bar after the gap is compared against music that is not there, and the
musician is told they rushed a passage they played correctly. It is the same
mistake as a page read at 0.00 being drawn as a score, one level up. So the
worker fails a scan whose pages did not all read, and names the page; this
module is only ever handed complete readings.
"""

from __future__ import annotations

from app.services.ocr.homr_provider import confidence_from_arithmetic
from app.services.ocr.score_join_errors import NoPagesToJoin
from app.services.ocr.validate import validate_measures
from app.services.score_schema import Repeat, ScoreJson, TempoChange


def join_pages(readings: list[ScoreJson]) -> ScoreJson:
    """One score from the pages of one part, in page order.

    The list is in page order — the app settles the ordering before it uploads
    anything (`lib/scan/drag.ts`), so there is no ordering decision here to get
    wrong.
    """
    if not readings:
        raise NoPagesToJoin("nothing to join")
    if len(readings) == 1:
        # **Bit-identical, not merely equivalent.** A one-page scan is what
        # every scan was before this module existed and what most scans will
        # keep being. Rebuilding it through the join would put this code in the
        # path of the common case for no gain, and would silently change the
        # measure numbering of every single-page score in the library.
        return readings[0]

    measures = []
    repeats: list[Repeat] = []
    tempo_changes: list[TempoChange] = []
    notes: list[str] = []

    # The metre in force as the reader crosses a page break.
    #
    # **The bug this exists to prevent.** `musicxml.py` puts a page's metre in
    # `score.time_signature` and leaves `Measure.time_signature` empty unless
    # the metre *changes within that page*. Page 2 of a part that is in 3/4
    # therefore states 3/4 in its own header and nowhere else — so joined
    # naively under page 1's 4/4, every bar of page 2 is checked against the
    # wrong metre and the whole page reads as short. Stamping the change onto
    # the first measure of the page is precisely what `meters_in_force` reads,
    # and is how the printed page works too: a metre holds until another one
    # is printed.
    #: The metre in force as the reader crosses a page break — which is the
    #: last one printed *anywhere* on the pages so far, not the header of the
    #: first.
    #:
    #: **Measured bug (2026-08-26).** This tracked `readings[0].time_signature`
    #: and never moved. So a part headed 4/4 that changes to 2/4 partway down
    #: page one, and returns to 4/4 on page two — an entirely ordinary shape,
    #: and the shape of the one real photograph here, whose only printed metre
    #: is mid-page — compared page two's "4/4" against page one's *header*
    #: "4/4", found them equal, and stamped nothing. The 2/4 from mid-page one
    #: therefore stayed in force, and every correctly-read bar of page two came
    #: out `long`: confidence 1.00 → 0.67 on a reading with nothing wrong in it.
    running_metre: str | None = None

    for page_number, page in enumerate(readings, start=1):
        offset = len(measures)

        for index, measure in enumerate(page.measures):
            update: dict = {
                # Position, renumbered from 1 across the whole part. homr
                # numbers each page from 1, so keeping the page's own numbers
                # would give a three-page part three measure 1s — and position
                # in the list is what every reader downstream uses anyway
                # (`musicxml.py` says so where it handles a pickup numbered 0).
                "measure_number": offset + index + 1,
            }
            stated = _stated_metre(page.time_signature)
            if index == 0 and page_number > 1 and stated and stated != running_metre:
                update["time_signature"] = stated
            measures.append(measure.model_copy(update=update))

        # What is in force at the end of this page: its header, then any
        # change printed on one of its measures, in the order they are read.
        # Taking only the header is what caused the bug above.
        if _stated_metre(page.time_signature):
            running_metre = _stated_metre(page.time_signature)
        for measure in page.measures:
            printed = _stated_metre(measure.time_signature)
            if printed:
                running_metre = printed

        # A repeat or a tempo change names a measure, so both move with them.
        repeats.extend(
            repeat.model_copy(
                update={
                    "start_measure": repeat.start_measure + offset,
                    "end_measure": repeat.end_measure + offset,
                }
            )
            for repeat in page.repeats
        )
        tempo_changes.extend(
            change.model_copy(
                update={"measure_number": change.measure_number + offset}
            )
            for change in page.tempo_changes
        )

        if page.notes_to_human:
            # Named by page, because the musician's next action is to
            # re-photograph one of them and an unattributed caveat says which
            # of three pages to go back to only by luck.
            notes.append(f"Page {page_number}: {page.notes_to_human}")

    joined = ScoreJson(
        # The header of the part is the header of its first page. A later page
        # repeating it is the same fact printed twice; a later page
        # contradicting it is a change, and changes ride on the measure.
        time_signature=readings[0].time_signature,
        key_signature=_first(page.key_signature for page in readings),
        tempo_marking=_first(page.tempo_marking for page in readings),
        bpm_hint=_first(page.bpm_hint for page in readings),
        # **Never defaulted, the same rule as everywhere else.** The clef is
        # printed at the start of the part and often at the start of each
        # system; taking the first page that names one is reading it, and
        # falling back to treble would caption a guess identically to a
        # reading. A part whose first page had its clef cut off but whose
        # second page shows one is read from the second — which is still
        # reading it off the page.
        clef=_first(page.clef for page in readings),
        measures=measures,
        repeats=repeats,
        tempo_changes=tempo_changes,
        # Recomputed over the whole part rather than averaged across the
        # pages' own numbers. It is the same measurement — the share of bars
        # that add up — asked of the score that actually exists, and averaging
        # would weight a four-bar page the same as a forty-bar one.
        ocr_confidence=confidence_from_arithmetic(
            validate_measures(
                ScoreJson(
                    time_signature=readings[0].time_signature,
                    measures=measures,
                    ocr_confidence=0.0,
                )
            )
        ),
        notes_to_human=" ".join(notes),
    )
    return joined


def _stated_metre(value: str | None) -> str | None:
    """The metre this page actually prints, or None if it does not print one.

    **`"unknown"` is not a metre and is not a change.** `ScoreJson` allows the
    literal string for a header that was cropped or illegible, which is the
    ordinary case for an inner page — and `meters_in_force` treats `"unknown"`
    *on a measure* as invalidating the metre in force, deliberately, because a
    metre change printed and unreadable is worse than no change at all.

    Both of those are right, and together they are a trap: writing a page's
    `"unknown"` header onto its first measure would say "a metre change is
    printed here and cannot be read", when the page says nothing of the kind.
    One page's missing header would then switch off the beat check for every
    page after it. Only `None` was guarded here at first; the mutation that
    replaced the guard with `True` survived, because `None` written onto a
    measure is indistinguishable from `None` left there — and `"unknown"` is
    not.
    """
    if value is None or value.strip().lower() == "unknown":
        return None
    return value


def _first(values):
    """The first page that states this, or None if no page does."""
    for value in values:
        if value is not None:
            return value
    return None

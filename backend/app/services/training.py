"""What a musician changed about a reading, and whether we may keep it.

Every scan this app has read has been corrected by a person and then thrown
away — `MeasureEditScreen` writes the corrected bar over the misread one and
keeps nothing about what it replaced, and `POST /v1/scores/:id/accept` then
deletes the photograph. The pair (what the reader said, what it should have
said) is the one asset here that cannot be bought, and it was being destroyed
at the moment it was created.

This module holds the two rules that decide what happens, out of the request
handlers so they can be tested without a database:

- `may_keep_corrections` — consent, and it fails closed.
- `corrections_between` — what actually changed between two readings.

**Nothing here writes anything.** It reports what a caller *may* keep and what
there *is* to keep; `routers/scores.py` does the writing. That split is what
lets every rule below have a test that needs no Supabase.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from app.services.score_schema import Measure, ScoreJson

log = logging.getLogger("intempo.training")

#: Score-level facts worth recording a correction about.
#:
#: Not every field on `ScoreJson` — `measures` is handled per bar below, and
#: `ocr_confidence` and `notes_to_human` are the reader talking about itself
#: rather than claims about the page. These four are things printed on the
#: paper that the reader can get wrong.
SCORE_FIELDS: tuple[str, ...] = ("clef", "key_signature", "time_signature", "tempo_marking")


@dataclass(frozen=True)
class Correction:
    """One thing a musician changed, ready to be stored.

    `measure_number` is None for a score-level field — the clef, the key —
    which is a correction with no bar to name.

    `before` and `after` are `None` for a bar that did not exist on that side.
    A bar the reader missed has no `before`; a bar it invented has no `after`.
    Both being None is impossible by construction and asserted by the database.
    """

    measure_number: int | None
    before: dict[str, Any] | None
    after: dict[str, Any] | None
    #: What changed, for a human reading the table later. Not parsed by
    #: anything — the JSON either side is the record.
    summary: str


def may_keep_corrections(user_row: Any) -> bool:
    """Whether this account has agreed their corrections may be kept.

    **Fails closed on every uncertainty**, which is the opposite of how
    `shouldOnboard` treats a missing answer and deliberately so. There, an
    unreadable `/v1/me` opens the app rather than holding it behind a network
    request, because guessing wrong costs one screen shown twice. Here guessing
    wrong means keeping a person's photographs and corrections without being
    told to, so: no row means no, a row with no timestamp means no, a value that
    is not a timestamp means no, and an exception means no.

    Takes the row rather than a user id so it cannot fetch — a consent check
    that does IO is one that can fail open by timing out.
    """
    if not isinstance(user_row, dict):
        return False
    granted = user_row.get("training_consent_at")
    # A timestamp is whatever the driver hands back — string or datetime — and
    # this must not care which. What it must care about is that *something* is
    # there: `None`, `""` and a missing key are all "they have not agreed".
    return bool(granted)


def _measure_payload(measure: Measure) -> dict[str, Any]:
    return measure.model_dump(mode="json")


def _by_number(score: ScoreJson) -> dict[int, Measure]:
    """Measures keyed by their number, last one winning on a duplicate.

    **Matched by number, not position**, the same rule
    `clear_unwritable_where_rewritten` follows: an edit that inserts or removes
    a bar shifts every position after it, and diffing by position would then
    report the whole rest of the page as corrected. A duplicate number is a
    misread page rather than a reason to fail here — the last one is kept, and
    the effect is one lost correction rather than a save that raises.
    """
    return {m.measure_number: m for m in score.measures}


def corrections_between(before: ScoreJson, after: ScoreJson) -> list[Correction]:
    """What a musician changed, one entry per corrected measure or field.

    Returns an empty list when nothing that matters changed, which is the
    ordinary case: renaming a piece, favouriting it, or saving a bar back
    unmodified all reach the same endpoint and none of them is a correction.

    **Compares the model, not the raw JSON.** Two readings can differ as
    dictionaries and be the same music — a field defaulted on one side and
    stated on the other, key order, `1` against `1.0`. Round-tripping both
    through `Measure` first means a correction is recorded when the *music*
    changed, and a corpus of no-op diffs is worse than no corpus.
    """
    out: list[Correction] = []

    for field in SCORE_FIELDS:
        was, now = getattr(before, field, None), getattr(after, field, None)
        if was != now:
            out.append(
                Correction(
                    measure_number=None,
                    before={field: was},
                    after={field: now},
                    summary=f"{field}: {was!r} → {now!r}",
                )
            )

    old, new = _by_number(before), _by_number(after)
    for number in sorted(set(old) | set(new)):
        was_m, now_m = old.get(number), new.get(number)
        was = _measure_payload(was_m) if was_m is not None else None
        now = _measure_payload(now_m) if now_m is not None else None
        if was == now:
            continue
        out.append(
            Correction(
                measure_number=number,
                before=was,
                after=now,
                summary=_describe(number, was_m, now_m),
            )
        )
    return out


def _describe(number: int, before: Measure | None, after: Measure | None) -> str:
    if before is None:
        return f"measure {number} was missing from the reading"
    if after is None:
        return f"measure {number} was read but is not in the music"
    changes: list[str] = []
    if len(before.notes) != len(after.notes):
        changes.append(f"{len(before.notes)} → {len(after.notes)} notes")
    if [n.duration for n in before.notes] != [n.duration for n in after.notes]:
        changes.append("durations")
    if [n.pitch for n in before.notes] != [n.pitch for n in after.notes]:
        changes.append("pitches")
    if before.time_signature != after.time_signature:
        changes.append(f"time signature {before.time_signature} → {after.time_signature}")
    # `unwritable_notes` deliberately not reported: it is cleared as a
    # side effect of rewriting a bar (`clear_unwritable_where_rewritten`), so it
    # changes on every correction and describes none of them.
    return f"measure {number}: " + (", ".join(changes) if changes else "edited")


def rows_for(
    corrections: list[Correction],
    *,
    user_id: str,
    score_id: str,
    reader: str | None,
    page_image_key: str | None,
) -> list[dict[str, Any]]:
    """The corrections as rows for `training_corrections`.

    `reader` is copied in here rather than joined at read time, because a score
    can be re-transcribed by a different chain later and that must not
    retroactively blame a reader that never made the mistake.
    """
    return [
        {
            "user_id": user_id,
            "score_id": score_id,
            "measure_number": c.measure_number,
            "before": c.before,
            "after": c.after,
            "reader": reader,
            "page_image_key": page_image_key,
        }
        for c in corrections
    ]

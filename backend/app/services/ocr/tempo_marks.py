"""Tempo markings read off a photographed page: "poco rit.", "a tempo", "♩ = 88".

The owner's question (2026-09-25): "how am I supposed to account for tempo
variations or where it says poco". The analysis stops judging bars under a
`rit.` and judges a new tempo against its own number — but only for markings
the score carries, and a photographed part carried none. homr, the reader in
use, reads notes and not words: its MusicXML has no `<words>` and no `<sound
tempo>`, so a musician who slowed down where the page says "poco rit." was told
they dragged. The vision readers are asked for these in the transcription
prompt; homr has no prompt to ask.

So one more question per page, to a vision model: which tempo words are
printed, and where. **Asked only when the reading has none** — a reader that
already wrote them down is not second-guessed.

**Positions are a line and a bar within it, never a bar number.** Counting to
bar 37 on a photograph is where a model goes wrong, and a miscount is a
*plausible* answer — a `rit.` two bars early is not detectably wrong. "Line 4,
bar 2" asks it to count to two. The reading knows which line each bar is on
(homr marks `<print new-system>`), so the line and bar become a bar number
here, by arithmetic. A position the reading has no bar for is dropped.

Where the page can be cut into exactly as many lines as the reading found, the
model is shown the lines one by one and labelled, so it does not count lines
either; otherwise it is shown the page. The same rule, for the same reason, as
`confirm.retry_by_system`.

**Conservative.** Which words are a tempo change is `tempo_words.tempo_word`'s
call, not the model's, so "cresc." or "dolce" reported by mistake changes
nothing. A word read wrongly as a change costs the musician the verdict on
those bars; a word missed costs what it cost before this existed — and a
missed one can still be marked by hand in the bar editor.

**Best effort, never raises.** A page whose words could not be read is read
exactly as it was before this existed.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from app.services.ocr.base import json_object_in
from app.services.page_image import crop_systems
from app.services.score_schema import DURATION_BEATS, ScoreJson, TempoChange
from app.services.tempo_words import one_per_bar, tempo_word

log = logging.getLogger("intempo.ocr")

#: The note values a printed metronome mark counts, as the schema names them.
_UNITS = ("whole", "half", "dotted_half", "quarter", "dotted_quarter", "eighth", "dotted_eighth")

#: A few marks, a few lines each. Far more than a page prints.
_MAX_TOKENS = 1024

#: How long the page waits for its words. The scan is finished without them,
#: so a slow answer costs the musician time for something optional.
_TIMEOUT_S = 60.0

_PROMPT = """\
Find every TEMPO marking printed on this music: words that change the speed \
(rit., rall., poco rit., allarg., accel., a tempo, Tempo I, più mosso, meno \
mosso, a tempo name such as Adagio printed part-way through) and metronome \
marks (a note value = a number). Include the tempo printed at the top of the \
piece.

Do NOT include dynamics (p, f, cresc., dim.), expression (dolce, espressivo), \
playing instructions (pizz., arco, sul tasto), or anything else that is not \
about speed.

Say where each one is printed. "line" is the line of music it is printed over, \
counting from 1 at the top{lines_hint}. "bar" is the bar it is printed over, \
counting from 1 at the start of that line. A tempo printed at the top of the \
piece is line 1, bar 1.

Answer with JSON only, in this shape:
{{"marks": [{{"line": 3, "bar": 2, "text": "poco rit.", "bpm": null, "unit": null}}]}}

"text" is the printed words exactly, without the metronome mark. "bpm" is the \
number of a metronome mark and "unit" the note value beside it — one of \
{units} — or both null when none is printed. If there are no tempo markings, \
answer {{"marks": []}}."""


def _prompt(*, as_lines: bool) -> str:
    hint = (
        "; each image above is one line of this page, in order, and the label "
        "before it is its line number"
        if as_lines
        else " of the page, and count only lines of music"
    )
    return _PROMPT.format(lines_hint=hint, units=", ".join(f'"{u}"' for u in _UNITS))


@dataclass(frozen=True)
class PrintedMark:
    """One marking as the model placed it: a line, a bar in that line, words."""

    line: int
    bar: int
    text: str
    #: Quarter notes per minute, converted from the printed unit.
    bpm: int | None
    unit: str | None


@dataclass(frozen=True)
class PageTempo:
    """What one page prints for tempo, in that page's bar numbers."""

    changes: list[TempoChange]
    #: The piece's own tempo, printed over the first bar of the first page —
    #: "Allegro", "♩ = 104". Not a change: it is what the changes change.
    heading_words: str | None = None
    heading_bpm: int | None = None
    heading_unit: str | None = None


def _quarter_bpm(value: object, unit: object) -> tuple[int | None, str | None]:
    """A printed metronome mark as quarter notes per minute, with its unit.

    A number with no unit is taken as quarters, which is what almost every
    part prints; a unit this cannot name drops the number rather than guess —
    a dotted-quarter piece read as quarters would be judged at two-thirds of
    its tempo.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None, None
    name = unit if isinstance(unit, str) and unit else "quarter"
    if name not in _UNITS:
        return None, None
    quarters = int(round(float(value) * DURATION_BEATS[name]))
    if not 20 <= quarters <= 300:
        return None, None
    return quarters, name


def marks_in(answer: str) -> list[PrintedMark]:
    """The marks a model's answer names, leaving out any not stated properly."""
    try:
        data = json.loads(json_object_in(answer))
    except (ValueError, TypeError):
        return []
    raw = data.get("marks") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        return []
    found: list[PrintedMark] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        line, bar = item.get("line"), item.get("bar")
        if not all(isinstance(n, int) and not isinstance(n, bool) and n >= 1 for n in (line, bar)):
            continue
        words = item.get("text")
        text = " ".join(words.split()) if isinstance(words, str) else ""
        bpm, unit = _quarter_bpm(item.get("bpm"), item.get("unit"))
        if text or bpm is not None:
            found.append(PrintedMark(line, bar, text, bpm, unit))  # type: ignore[arg-type]
    return found


def bars_by_line(score: ScoreJson) -> list[list[int]]:
    """Each line's bar numbers, top line first — or nothing, if not known.

    `Measure.system` is set only when the reading says where its lines break.
    A reading that says it for some bars and not others is not trusted for
    any: a bar on no line would shift every bar after it.
    """
    if not score.measures or any(m.system is None for m in score.measures):
        return []
    systems = sorted({m.system for m in score.measures})  # type: ignore[type-var]
    return [
        list(dict.fromkeys(m.measure_number for m in score.measures if m.system == system))
        for system in systems
    ]


def place_marks(
    marks: list[PrintedMark], lines: list[list[int]], *, first_page: bool
) -> PageTempo:
    """The marks as tempo changes at bar numbers, and the piece's heading.

    Over the first bar of the first page, a tempo name or a metronome mark is
    the piece's own tempo; anywhere else, a mark with a number sets a new
    tempo, and words are whatever `tempo_word` says they are.
    """
    placed = []
    heading_words: str | None = None
    heading_bpm: int | None = None
    heading_unit: str | None = None
    for mark in marks:
        if mark.line > len(lines) or mark.bar > len(lines[mark.line - 1]):
            log.info(
                "a tempo marking %r was placed at line %d, bar %d, which the "
                "reading has no bar for; leaving it out",
                mark.text,
                mark.line,
                mark.bar,
            )
            continue
        measure = lines[mark.line - 1][mark.bar - 1]
        heading = first_page and mark.line == 1 and mark.bar == 1
        word = tempo_word(mark.text, heading=heading) if mark.text else None
        if heading:
            if mark.bpm is not None and heading_bpm is None:
                heading_bpm, heading_unit = mark.bpm, mark.unit
            if word is None:
                # The piece's tempo by name. Only a word that *is* a tempo,
                # so a "dolce" reported by mistake does not become one.
                if heading_words is None and tempo_word(mark.text) is not None:
                    heading_words = tempo_word(mark.text).text  # type: ignore[union-attr]
                continue
            placed.append((measure, word.kind, word.text, None))
        elif mark.bpm is not None:
            # A number states a new tempo whatever the words beside it say —
            # the rule `musicxml._tempo_mark_in` holds for a file.
            placed.append((measure, "new_tempo", word.text if word else (mark.text or "new tempo")[:40], mark.bpm))
        elif word is not None:
            placed.append((measure, word.kind, word.text, None))
    return PageTempo(
        changes=one_per_bar(placed),  # type: ignore[arg-type]
        heading_words=heading_words,
        heading_bpm=heading_bpm,
        heading_unit=heading_unit,
    )


def tempo_reader():
    """The provider that reads tempo words off a page, or None.

    Resolved on each call, as `pipeline.corrector` is and for its reason.
    Anything that cannot be asked a question about an image is refused here,
    and so is an unknown name — logged, and the page read as before.
    """
    from app.config import settings
    from app.services.ocr.pipeline import PROVIDER_REGISTRY

    name = settings.OCR_TEMPO_READER.strip()
    if not name:
        return None
    provider = PROVIDER_REGISTRY.get(name)
    if provider is None or not callable(getattr(provider, "ask", None)):
        log.warning(
            "OCR_TEMPO_READER names %r, which cannot be asked about a page "
            "(%s can); tempo words will not be read from photographs",
            name,
            ", ".join(sorted(n for n, p in PROVIDER_REGISTRY.items() if hasattr(p, "ask"))),
        )
        return None
    return provider


def read_tempo_marks(
    page: bytes,
    score: ScoreJson,
    *,
    media_type: str = "image/jpeg",
    source: bytes | None = None,
    first_page: bool = True,
    provider=None,
) -> PageTempo | None:
    """What this page prints for tempo, or None when it could not be asked."""
    helper = provider if provider is not None else tempo_reader()
    if helper is None:
        return None
    lines = bars_by_line(score)
    if not lines:
        log.info("the reading does not say where its lines break; not reading tempo words")
        return None

    crops: list[bytes] = []
    try:
        crops = crop_systems(page, source=source)
    except Exception as exc:  # noqa: BLE001 — the page itself is still worth asking about
        log.info("could not cut the page into lines for the tempo words: %s", exc)
    as_lines = len(crops) == len(lines)
    try:
        answer = helper.ask(
            [(f"Line {n}", crop) for n, crop in enumerate(crops, start=1)]
            if as_lines
            else [(None, page)],
            _prompt(as_lines=as_lines),
            media_type="image/jpeg" if as_lines else media_type,
            max_tokens=_MAX_TOKENS,
            timeout_s=_TIMEOUT_S,
        )
    except Exception as exc:  # noqa: BLE001 — best effort, by the module's contract
        log.warning("could not read the tempo words on this page: %s", exc)
        return None
    return place_marks(marks_in(answer), lines, first_page=first_page)


def apply_page_tempo(score: ScoreJson, tempo: PageTempo) -> ScoreJson:
    """The reading with what the page prints for tempo, where it had nothing.

    Nothing the reading already says is replaced: a marking at a bar that has
    one is left out, and the heading fills only what is empty.
    """
    update: dict = {}
    held = {change.measure_number for change in score.tempo_changes}
    added = [change for change in tempo.changes if change.measure_number not in held]
    if added:
        update["tempo_changes"] = sorted(
            [*score.tempo_changes, *added], key=lambda change: change.measure_number
        )
    if score.bpm_hint is None and tempo.heading_bpm is not None:
        update["bpm_hint"] = tempo.heading_bpm
        if score.tempo_beat_unit is None:
            update["tempo_beat_unit"] = tempo.heading_unit or "quarter"
    if score.tempo_marking is None and tempo.heading_words:
        update["tempo_marking"] = tempo.heading_words
    return score.model_copy(update=update) if update else score


def with_tempo_marks(
    score: ScoreJson,
    page: bytes,
    *,
    media_type: str = "image/jpeg",
    source: bytes | None = None,
    first_page: bool = True,
) -> ScoreJson:
    """The reading, with the page's tempo words if it had none. Never raises."""
    if score.tempo_changes:
        return score
    try:
        tempo = read_tempo_marks(
            page, score, media_type=media_type, source=source, first_page=first_page
        )
        if tempo is None:
            return score
        read = apply_page_tempo(score, tempo)
    except Exception:  # noqa: BLE001 — a page is never lost over its words
        log.exception("reading the tempo words failed; keeping the reading as it was")
        return score
    if read is not score:
        log.info(
            "tempo words on this page: %s",
            ", ".join(f"bar {c.measure_number} {c.text!r}" for c in read.tempo_changes)
            or f"the piece's tempo only ({read.tempo_marking or read.bpm_hint})",
        )
    return read

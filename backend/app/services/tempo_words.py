"""What a tempo word printed on a page means: "poco rit.", "a tempo", "meno mosso".

The owner's question (2026-09-25): "how am I supposed to account for tempo
variations or where it says poco". The analysis already refuses to judge bars
under a `rit.` and judges a stated new tempo against its own number
(`score_schema.tempo_in_force`) — but only for markings the score carries, and
nothing turned the words on a page into one. This is that, in one place, for
every route a score arrives by: a MusicXML file's `<words>`, and the words read
off a photograph.

**Conservative on purpose.** A word read as a tempo change stops bars being
judged, or judges them against another number, so a false one costs a musician
their verdict for those bars. Only words a part prints *for* tempo are read:
"morendo" and "calando" die away in sound as often as in time, "stretto" is a
fugue as often as a tempo, and "poco a poco" alone is half of a longer phrase —
none of them are taken. A heading ("Allegro") is the piece's tempo, not a
change; only the caller knows whether a word is at the top of the piece.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass

from app.services.score_schema import TempoChange, TempoChangeKind

#: Back to the opening: before "a tempo", which it also contains.
_PRIMO = re.compile(r"\b(tempo\s*(i|1|primo|1o|1º)|1\s*[oº°]?\s*tempo|primo\s+tempo)\b", re.I)
_A_TEMPO = re.compile(r"\ba\s+tempo\b|\btempo\s+giusto\b", re.I)
_SLOWING = re.compile(
    r"\b(rit|ritard|ritardando|riten|ritenuto|rall|rallent|rallentando|allarg|allargando|slentando)\b",
    re.I,
)
_SPEEDING = re.compile(r"\b(accel|accelerando|string|stringendo|affrett|affrettando)\b", re.I)
#: A new tempo, by name — "più mosso", "meno mosso", "Adagio" part-way in.
_NEW_TEMPO = re.compile(
    r"\b((più|piu|meno)\s+(mosso|moto|lento|allegro|presto|vivo)"
    r"|l'istesso\s+tempo|doppio\s+movimento"
    r"|largo|larghetto|lento|adagio|adagietto|andante|andantino|moderato"
    r"|allegretto|allegro|vivace|vivo|presto|prestissimo|grave)\b",
    re.I,
)


@dataclass(frozen=True)
class TempoWord:
    """A tempo marking read from words: the schema's kind, and the words kept."""

    kind: TempoChangeKind
    text: str


def tempo_word(words: str, *, heading: bool = False) -> TempoWord | None:
    """The tempo change these printed words make, or None.

    `heading` is True for words printed over the piece's first bar, where a
    tempo name is the piece's own tempo rather than a change to it; a `rit.`
    or "a tempo" there is still one.
    """
    text = " ".join((words or "").split())[:40]
    if not text:
        return None
    if _PRIMO.search(text):
        return TempoWord("a_tempo", text)
    if _A_TEMPO.search(text):
        return TempoWord("a_tempo", text)
    if _SLOWING.search(text):
        return TempoWord("ritardando", text)
    if _SPEEDING.search(text):
        return TempoWord("accelerando", text)
    if not heading and _NEW_TEMPO.search(text):
        return TempoWord("new_tempo", text)
    return None


def one_per_bar(marks: Iterable[tuple[int, TempoChangeKind, str, float | None]]) -> list[TempoChange]:
    """Tempo marks as (bar, kind, text, bpm), made into one change per bar.

    A bar often prints its words and its metronome mark apart — "meno mosso"
    and "♩ = 88" — which are one change: the words, with the number. Otherwise
    the first mark at a bar is kept: two changes at one bar would leave the
    order between them to chance (`applyTempoMarkEdit` holds the same rule).
    """
    by_bar: dict[int, tuple[TempoChangeKind, str, float | None]] = {}
    for bar, kind, text, bpm in marks:
        held = by_bar.get(bar)
        if held is None:
            by_bar[bar] = (kind, text, bpm)
        elif kind == "new_tempo" and held[0] == "new_tempo":
            by_bar[bar] = (
                "new_tempo",
                held[1] if held[2] is None else text,
                bpm if bpm is not None else held[2],
            )
    return [
        TempoChange(measure_number=bar, kind=kind, text=text, bpm=bpm)
        for bar, (kind, text, bpm) in sorted(by_bar.items())
    ]

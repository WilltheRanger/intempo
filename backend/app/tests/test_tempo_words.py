"""`tempo_words`: what a tempo word printed on a page means.

The owner's piece says "poco" somewhere, and nothing read it (2026-09-25).
These hold what is read and — as much — what is not: a word taken as a tempo
change stops bars being judged, so a false one costs a musician their verdict.
"""

from __future__ import annotations

import pytest

from app.services.tempo_words import tempo_word


@pytest.mark.parametrize(
    ("words", "kind"),
    [
        ("poco rit.", "ritardando"),
        ("rit.", "ritardando"),
        ("rall.", "ritardando"),
        ("allargando", "ritardando"),
        ("molto ritenuto", "ritardando"),
        ("rit. e dim.", "ritardando"),
        ("accel.", "accelerando"),
        ("poco a poco accel.", "accelerando"),
        ("string.", "accelerando"),
        ("a tempo", "a_tempo"),
        ("A Tempo", "a_tempo"),
        ("Tempo I", "a_tempo"),
        ("Tempo primo", "a_tempo"),
        ("più mosso", "new_tempo"),
        ("Poco meno mosso", "new_tempo"),
        ("piu mosso", "new_tempo"),
        ("Adagio", "new_tempo"),
        ("L'istesso tempo", "new_tempo"),
    ],
)
def test_the_words_a_part_prints_for_tempo(words: str, kind: str) -> None:
    mark = tempo_word(words)

    assert mark is not None and mark.kind == kind
    assert mark.text == words


@pytest.mark.parametrize(
    "words",
    [
        "cresc.",
        "dim.",
        "poco a poco",
        "dolce",
        "espressivo",
        "morendo",
        "calando",
        "pizz.",
        "arco",
        "sul tasto",
        "",
    ],
)
def test_words_that_are_not_a_tempo_change(words: str) -> None:
    assert tempo_word(words) is None


def test_a_tempo_name_heading_the_piece_is_its_tempo_not_a_change() -> None:
    assert tempo_word("Allegro", heading=True) is None
    assert tempo_word("Allegro") is not None
    # A change word is one wherever it is printed.
    assert tempo_word("rit.", heading=True) is not None


def test_the_words_are_kept_to_what_the_schema_holds() -> None:
    mark = tempo_word("rit.   " + "e molto " * 10)

    assert mark is not None
    assert len(mark.text) <= 40
    assert "  " not in mark.text

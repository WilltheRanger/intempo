"""A saxophone is heard where it sounds, and told what it read.

Both saxophones transpose, and not by an octave: an alto in E-flat sounds a
major sixth below its page and a tenor in B-flat a major ninth. The double bass
was the only transposing instrument before them, and an octave hides a missing
transposition almost everywhere — a pitch class does not move, and cents folded
into one octave do not either. A sixth moves both. Every place that compared a
heard pitch with a written one had to be asked which of the two it meant; these
are the answers, one take each.

Synthetic takes, as `test_note_chain.py` builds them: a written melody in the
saxophone's easy register, D4 to B5, played at its sounding pitch.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.services import pitch_evidence
from app.services.analysis import analyze, sounding_offset
from app.services.audio_config import load_audio_config
from app.tests.audio_helpers import synth_bowed_take
from app.tests.test_note_chain import BEAT, BPM, SR, _hz, _page, _tune

CFG = load_audio_config()
#: Written D4 to B5: above the low notes and below the palm keys.
WRITTEN = _tune(23)
PAGE = _page(WRITTEN)
GRID = 0.6 + np.arange(len(WRITTEN)) * BEAT


def _take(sounding: list[int]) -> np.ndarray:
    return synth_bowed_take(list(GRID), freqs_hz=[_hz(m) for m in sounding], sr=SR)


def _analyse(instrument: str, written: list[int]):
    shift = sounding_offset(instrument)
    return analyze(
        (_take([m + shift for m in written]), SR), PAGE, BPM, instrument=instrument
    )


def test_each_saxophone_sounds_its_own_interval_below_the_page() -> None:
    assert sounding_offset("alto_sax") == -9
    assert sounding_offset("tenor_sax") == -14
    assert sounding_offset("double_bass") == -12
    assert sounding_offset("violin") == 0
    assert sounding_offset(None) == 0


@pytest.mark.parametrize("instrument", ["alto_sax", "tenor_sax"])
def test_a_saxophone_playing_its_page_is_in_tune_and_right(instrument: str) -> None:
    """The take is the page, note for note. Compared with the written pitch it
    reads three semitones sharp on an alto (-900 cents folds to +300) and every
    note is another note; compared with the sounding pitch it is simply right."""
    result = _analyse(instrument, WRITTEN)

    assert result.status == "ok", result.verdict
    assert result.wrong_notes == []
    assert result.intonation is not None
    assert abs(result.intonation.tuning_cents) < 15


def test_without_the_transposition_the_same_take_is_a_sixth_away() -> None:
    """The guard on the test above: the same alto take, analysed as though it
    sounded where it is written, is not in tune. If this ever passes as in
    tune, the take above proves nothing."""
    take = _take([m - 9 for m in WRITTEN])
    result = analyze((take, SR), PAGE, BPM, instrument="violin")

    in_tune = (
        result.intonation is not None
        and abs(result.intonation.tuning_cents) < 15
        and result.wrong_notes == []
    )
    assert not in_tune


def test_a_wrong_note_is_named_as_the_saxophonist_reads_it() -> None:
    """A saxophonist fingers the page. One who played a written E where the
    page has a D wants to be told E — not the G an alto sounds for it."""
    played = list(WRITTEN)
    at = next(i for i in range(8, len(played)) if played[i] % 12 == 2)  # a D
    played[at] += 2  # fingered E

    result = _analyse("alto_sax", played)

    named = [(w.measure_number, w.heard, w.written) for w in result.wrong_notes]
    assert named == [(at // 4 + 1, "E", "D")]


def test_the_pitch_class_fallback_listens_for_the_sounding_class() -> None:
    """Without a pitch track the note chain pairs attacks by class alone. An
    alto's written C sounds E-flat: listening for C there hears nothing."""
    y = synth_bowed_take([0.5], freqs_hz=[_hz(72 - 9)], sr=SR, note_dur_s=1.2)
    frames = pitch_evidence.chroma(y, SR)

    def against(transpose: int) -> float:
        return float(
            pitch_evidence.mismatch(
                frames,
                SR,
                np.array([0.5]),
                ["C5"],
                steady=CFG.pitch.steady,
                transpose=transpose,
            )[0, 0]
        )

    assert against(-9) < 0.2
    assert against(0) > 0.8

"""A take nobody played is not given a verdict.

The owner's worry, 2026-09-23: "there can be talking in the background, or
someone records like nothing and it picks up like someone's bow hitting the
stand." Measured before this existed, on synthetic takes: a metronome in an
empty room was told "Steady all the way through" at quality 1.00, and talking
on its own reached a verdict at 0.47. The onset detector is amplitude-invariant
by design, so any sound with an attack is a note to it; what separates an
instrument from a click or a voice is that it holds the pitch the page writes.

See `services/pitch_evidence.py` and `analysis.nothing_played`, and
TUNING_LOG.md 2026-09-23 for every number these thresholds came from.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.services.analysis import NOT_PLAYED, analyze, nothing_played
from app.services.audio_config import load_audio_config
from app.services.pitch_evidence import Evidence, midi, pitch_class
from app.services.score_schema import ScoreJson
from app.tests.audio_helpers import (
    OPEN_E1,
    bass_scale,
    evenly_spaced,
    synth_bowed_take,
    synth_click_track,
)

SR = 22050
BPM = 60.0
N = 16

#: G major from the violin's G string: sixteen quarter notes, one per second.
VIOLIN = ["G3", "A3", "B3", "C4", "D4", "E4", "F#4", "G4", "A4", "B4", "C5", "D5", "E5", "F#5", "G5", "A5"]


def _hz(name: str) -> float:
    return 440.0 * 2 ** ((midi(name) - 69) / 12)


def _page(names: list[str], *, clef: str = "treble") -> ScoreJson:
    return ScoreJson.model_validate(
        {
            "time_signature": "4/4",
            "clef": clef,
            "repeats": [],
            "ocr_confidence": 1.0,
            "measures": [
                {
                    "measure_number": m + 1,
                    "notes": [{"pitch": p, "duration": "quarter"} for p in names[4 * m : 4 * m + 4]],
                    "slurs": [],
                }
                for m in range(len(names) // 4)
            ],
        }
    )


def _third_up(name: str) -> str:
    """The same line or space read in the wrong clef, near enough: every note
    moved by a major third, so none keeps its pitch class."""
    steps = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    m = midi(name) + 4
    return f"{steps[m % 12]}{m // 12 - 1}"


def _played(names: list[str]) -> np.ndarray:
    return synth_bowed_take(evenly_spaced(len(names), BPM, start_s=0.5), freqs_hz=[_hz(n) for n in names], sr=SR)


def _room(seconds: float, seed: int = 3) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return (rng.standard_normal(int(seconds * SR)) * 10 ** (-55 / 20)).astype(np.float32)


def _talking(seconds: float, seed: int = 11) -> np.ndarray:
    """Voiced syllables at three to six a second, in phrases, gliding in pitch.

    A stand-in, not a voice: harmonic, formant-free, bright. What it shares
    with speech is what matters to the detector — an attack every syllable —
    and to this check: a pitch that never settles on the page's.
    """
    rng = np.random.default_rng(seed)
    out = np.zeros(int(seconds * SR), np.float32)
    at = int(0.3 * SR)
    while at < out.size - SR // 2:
        for _ in range(rng.integers(3, 9)):
            dur = rng.uniform(0.12, 0.3)
            t = np.arange(int(dur * SR)) / SR
            f0 = rng.uniform(100, 220) * (1 + 0.1 * np.sin(2 * np.pi * rng.uniform(1, 3) * t))
            phase = 2 * np.pi * np.cumsum(f0) / SR
            voice = sum(np.sin(k * phase) / k for k in range(1, 30))
            envelope = np.minimum(1, t / 0.02) * np.minimum(1, (dur - t) / 0.04)
            if at + t.size >= out.size:
                break
            out[at : at + t.size] += (voice * envelope).astype(np.float32)
            at += t.size + int(rng.uniform(0.03, 0.15) * SR)
        at += int(rng.uniform(0.4, 1.2) * SR)
    return out / np.abs(out).max() * 0.5


def _knock(seed: int = 5) -> np.ndarray:
    """A bow or a knuckle on a wooden stand: a click and a short woody body."""
    rng = np.random.default_rng(seed)
    t = np.arange(int(0.12 * SR)) / SR
    k = rng.standard_normal(t.size) * np.exp(-t / 0.004)
    k += 2 * np.sin(2 * np.pi * 180 * t) * np.exp(-t / 0.025)
    return (k / np.abs(k).max() * 0.8).astype(np.float32)


def _woodblock(bpm: float, seconds: float, seed: int = 9) -> np.ndarray:
    rng = np.random.default_rng(seed)
    y = np.zeros(int(seconds * SR), np.float32)
    t = np.arange(int(0.03 * SR)) / SR
    click = (rng.standard_normal(t.size) * np.exp(-t / 0.004) + np.sin(2 * np.pi * 2200 * t) * np.exp(-t / 0.006))
    click = (click / np.abs(click).max() * 0.5).astype(np.float32)
    beat = 0.5
    while beat < seconds - 0.1:
        s = int(beat * SR)
        y[s : s + click.size] += click
        beat += 60.0 / bpm
    return y


def _analyse(y: np.ndarray, page: ScoreJson, *, bass: bool = False):
    return analyze((y.astype(np.float32), SR), page, BPM, double_bass=bass)


# ---- parsing ---------------------------------------------------------------


@pytest.mark.parametrize(
    "pitch, cls, number",
    [
        ("E2", 4, 40),
        ("A4", 9, 69),
        ("F#4", 6, 66),
        ("Bb3", 10, 58),
        ("B#3", 0, 60),
        ("Cb4", 11, 59),
        ("G##3", 9, 57),
        ("rest", None, None),
        (None, None, None),
    ],
)
def test_a_written_pitch_has_a_class_and_a_number(pitch, cls, number) -> None:
    assert pitch_class(pitch) == cls
    assert midi(pitch) == number


# ---- the decision, number by number ----------------------------------------


def _evidence(tonal: float, page: float, *, one: float = 0.3, classes: int = 7) -> Evidence:
    return Evidence(
        tonal_share=tonal,
        n_attacks=32,
        one_pitch_share=one,
        page_classes=classes,
        page_share=page,
        n_matched=32,
        n_confirmed=round(page * 32),
        confirmed=(),
    )


CFG = load_audio_config()


@pytest.mark.parametrize(
    "case, evidence, quality, detected, played",
    [
        # Measured cases, from TUNING_LOG.md 2026-09-23.
        ("a take of the page", _evidence(0.97, 1.00), 1.0, 32, True),
        ("talking as loud as the bass", _evidence(0.25, 0.29), 0.73, 32, True),
        ("sixteenths on a page a third off", _evidence(0.93, 0.00), 0.95, 32, True),
        ("an open string on a misread page", _evidence(0.97, 0.00, one=1.0, classes=1), 1.0, 32, True),
        ("a metronome", _evidence(0.00, 0.00), 1.0, 33, False),
        ("an empty room", _evidence(0.00, 0.00), 0.0, 31, False),
        ("talking", _evidence(0.35, 0.03), 0.47, 26, False),
        ("a stand rung three times", _evidence(1.00, 0.00, one=1.0), 0.0, 3, False),
        ("four notes of a different piece", _evidence(1.00, 0.00, one=0.33), 0.0, 3, True),
        ("a beeping metronome", _evidence(1.00, 0.19, one=1.0), 1.0, 33, False),
        # Real double bass takes, the re-run of 2026-09-25 (TUNING_LOG.md): as
        # tonal as the take the chain reads perfectly (0.66), and refused by
        # the alignment — which is what they are told, not "not played".
        ("a bass take timing could not pair", _evidence(0.69, 0.20), 0.0, 67, True),
        ("a bass take from bar 7, unpaired", _evidence(0.48, 0.00), 0.0, 29, True),
        # Talking as near the page's rhythm as it came stays not played.
        ("talking, fit for a verdict", _evidence(0.69, 0.03), 0.47, 26, False),
    ],
)
def test_nothing_played_on_the_measured_numbers(case, evidence, quality, detected, played) -> None:
    assert nothing_played(
        evidence, quality=quality, n_detected=detected, n_expected=32, config=CFG
    ) is not played, case


def test_the_page_heard_beyond_chance_is_never_called_silence() -> None:
    """Somebody played the page: whatever else went wrong, what they are told
    is the rest of the pipeline's. Half of 32 notes is far beyond chance."""
    for tonal in (0.0, 0.1, 0.5):
        assert not nothing_played(
            _evidence(tonal, 0.5),
            quality=0.0,
            n_detected=2,
            n_expected=32,
            config=CFG,
        )


def test_a_few_notes_of_chance_do_not_count_as_the_page() -> None:
    """Glass clinks against a bass page: eight notes matched, two held by
    chance, 0.25 — on the line as a share, one in three by luck. The clinks
    are one pitch each time (1.00, measured), which is what calls them."""
    chance = Evidence(
        tonal_share=1.0,
        n_attacks=3,
        one_pitch_share=1.0,
        page_classes=5,
        page_share=0.25,
        n_matched=8,
        n_confirmed=2,
        confirmed=(),
    )
    assert nothing_played(chance, quality=0.0, n_detected=3, n_expected=32, config=CFG)


def test_two_notes_of_two_are_the_page() -> None:
    """A player who stopped after two notes, both held: one in fifty by luck.
    Not "we didn't hear you play" — they were heard, and the take is refused
    for being too short, by the rest of the pipeline."""
    stopped = Evidence(
        tonal_share=1.0,
        n_attacks=2,
        one_pitch_share=1.0,
        page_classes=1,
        page_share=1.0,
        n_matched=2,
        n_confirmed=2,
        confirmed=(),
    )
    assert not nothing_played(stopped, quality=0.0, n_detected=2, n_expected=8, config=CFG)


def test_a_single_pitched_page_is_not_judged_by_one_pitch() -> None:
    """A page of open E and a real take of it are one pitch every time too.
    Against such a page a beep cannot be told from a misread transcription,
    so the one-pitch rule stands aside — the known limit, written down."""
    assert not nothing_played(
        _evidence(1.0, 0.0, one=1.0, classes=1), quality=1.0, n_detected=33, n_expected=32, config=CFG
    )


# ---- whole takes ------------------------------------------------------------


def test_a_metronome_in_an_empty_room_is_not_played() -> None:
    """The case that was told "Steady all the way through" at quality 1.00."""
    page = _page(VIOLIN)
    seconds = N + 1.5
    for sound in (
        synth_click_track(evenly_spaced(N, BPM, start_s=0.5), sr=SR, freq_hz=1500.0),
        _woodblock(BPM, seconds),
    ):
        y = np.pad(sound, (0, max(0, int(seconds * SR) - sound.size)))[: int(seconds * SR)]
        result = _analyse(y + _room(seconds), page)
        assert result.status == "not_played"
        assert result.verdict == NOT_PLAYED
        assert result.quality == 0.0
        assert result.per_note == []


def test_talking_on_its_own_is_never_given_a_verdict() -> None:
    """Refused either way, but not always as "not played".

    A voice that holds each syllable's pitch as steadily as a bow — this one
    does, 0.94 of attacks — is not separable from a real take by pitch alone
    when the page's pitches are not heard, because that is also what a take
    against a misread page looks like. What still stops it is the rhythm:
    talking fits the page at 0.22 here, and the alignment refuses it. Closing
    the gap by pitch would also swallow "your take is longer than this page"
    for a real take read against a page with missing bars.
    """
    result = _analyse(_talking(N + 2) + _room(N + 2), _page(VIOLIN))

    assert result.status in ("not_played", "alignment_failed")
    assert result.per_note == []


def test_a_bow_knocking_the_stand_is_not_played() -> None:
    y = _room(N + 2)
    for at in (2.0, 7.5, 12.0):
        s = int(at * SR)
        y[s : s + _knock().size] += _knock()

    assert _analyse(y, _page(VIOLIN)).status == "not_played"


def test_a_take_of_the_page_is_played() -> None:
    result = _analyse(_played(VIOLIN), _page(VIOLIN))

    assert result.status == "ok"


def test_a_take_against_a_page_read_in_the_wrong_clef_is_still_played() -> None:
    """None of its written pitches is heard, and it must not be called silence:
    the transcription is what is wrong, not the musician's microphone."""
    result = _analyse(_played(VIOLIN), _page([_third_up(n) for n in VIOLIN]))

    assert result.status != "not_played"


def test_a_click_leaking_under_a_take_changes_nothing() -> None:
    take = _played(VIOLIN)
    click = synth_click_track(evenly_spaced(N, BPM, start_s=0.5), sr=SR, freq_hz=1500.0)
    click = np.pad(click, (0, max(0, take.size - click.size)))[: take.size]
    leak = click * (np.sqrt(np.mean(take**2)) / np.sqrt(np.mean(click**2))) * 10 ** (-10 / 20)

    assert _analyse(take + leak, _page(VIOLIN)).status == "ok"


def test_the_bottom_of_the_bass_is_heard() -> None:
    """The short STFT cannot separate semitones below E2 — a scale from the
    open E held a pitch after 0.35 of attacks through it — so a low page is
    heard through the constant-Q transform. This is the take that found it."""
    freqs = bass_scale(N, root_hz=OPEN_E1)
    names = []
    for f in freqs:
        m = int(round(69 + 12 * np.log2(f / 440.0)))
        names.append(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][m % 12] + str(m // 12 - 1))
    y = synth_bowed_take(evenly_spaced(N, BPM, start_s=0.5), freqs_hz=freqs, sr=SR)

    assert _analyse(y, _page(names, clef="bass"), bass=True).status == "ok"


def test_a_sound_with_no_pitch_class_standing_out_is_no_note_s_match() -> None:
    """**A flat profile of pitch classes is no pitch, and it matched every
    note.** Where no pitch held, the mismatch falls back on the classes, as
    how far the written one is below the strongest; a breath or a click has
    every class near the strongest, so it cost 0.01 to 0.37 against any note.
    In the cello part of URMP's fugue (2026-11-14), five such sounds before the
    cello came in took its first notes, 2 to 19 s early. A flat profile now
    says nothing, as an attack with no window does (`_FLAT_CLASSES`)."""
    from app.services import pitch_evidence as pe

    rng = np.random.default_rng(1)
    frames = 0.9 + 0.1 * rng.random((12, int(2.0 * SR / pe.HOP)))
    held = int(1.5 * SR / pe.HOP)
    frames[:, held:] = 0.05
    frames[2, held:] = 1.0  # a D, held

    out = pe.mismatch(
        frames, SR, np.array([0.5, 1.5]), ["D4", "A4", "F4"], steady=load_audio_config().pitch.steady
    )

    assert out[0].tolist() == [0.5, 0.5, 0.5]
    assert out[1, 0] == pytest.approx(0.0)
    assert out[1, 1] > 0.9


def _partials_of(f0: float, amps: list[float], seconds: float = 0.4) -> np.ndarray:
    t = np.arange(int(seconds * SR)) / SR
    return sum(a * np.sin(2 * np.pi * f0 * (k + 1) * t) for k, a in enumerate(amps))


@pytest.mark.parametrize(
    ("f0", "amps", "read", "want"),
    [
        # A viola's F♯3 with a weak fundamental, read an octave up as F♯4.
        (185.0, [0.05, 1.0, 0.8, 0.6, 0.4, 0.3], 66.0, 54.0),
        # A real F♯4 stays F♯4: it has nothing at F♯3's odd partials.
        (370.0, [1.0, 0.6, 0.4, 0.3, 0.2, 0.1], 66.0, 66.0),
        # An F♯4 read an octave down as F♯3: F♯3's odd partials are empty.
        (370.0, [1.0, 0.6, 0.4, 0.3, 0.2, 0.1], 54.0, 66.0),
        # A real F♯3 stays F♯3.
        (185.0, [1.0, 0.7, 0.5, 0.4, 0.3, 0.2], 54.0, 54.0),
    ],
)
def test_a_pitch_read_an_octave_off_is_put_back_by_its_partials(f0, amps, read, want) -> None:
    """**YIN reads a weak fundamental an octave up.** At URMP's labelled notes
    (2026-11-14) a viola read an octave high at 6.5% of them, and four F♯3s
    read as F♯4 took the first notes of a run of F♯4s in the note chain. A note
    at f/2 has partials at the odd multiples of f/2, which a note at f never
    has; a note at 2f has nothing at f's odd multiples."""
    from app.services import pitch_evidence as pe

    y = np.concatenate([np.zeros(int(0.1 * SR)), _partials_of(f0, amps)])
    out = pe.octave_checked(
        np.array([read]), y, SR, np.array([0.1]),
        below_ratio=0.2, above_ratio=0.15, fmin=120.0, fmax=1500.0,
    )
    assert out[0] == want


def test_the_octave_check_is_off_at_zero() -> None:
    from app.services import pitch_evidence as pe

    y = np.concatenate([np.zeros(int(0.1 * SR)), _partials_of(185.0, [0.05, 1.0, 0.8, 0.6, 0.4, 0.3])])
    out = pe.octave_checked(
        np.array([66.0]), y, SR, np.array([0.1]),
        below_ratio=0.0, above_ratio=0.0, fmin=120.0, fmax=1500.0,
    )
    assert out[0] == 66.0

"""The chain of notes: pairing a take with its page by what each attack sounded.

The owner's real double-bass take (2026-09-24) played every note of its page in
order at a steady 97 BPM and was refused twice over as "same notes, different
times": timing alone lost its place among 105 attacks against 95 written
notes, and once pitch found it, the timing trust score read human rubato as a
bad pairing. The owner's rule, 2026-09-25: judge the chain of notes — if it is
the page, one note in between that is out of tune, or that the scan misread,
does not make it something else — and report the timing instead of refusing.

See `alignment.align_chain`, `analysis._trusted_by_pitch` and `[pitch]`
`confirmed_*` in config.toml; TUNING_LOG.md 2026-09-25 for every number.
"""

from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest

from app.services import analysis, pitch_evidence
from app.services.alignment import (
    AlignmentResult,
    _chain_path,
    align_chain,
    apply_fuzzy_match,
)
from app.services.analysis import (
    _Confirmed,
    _heard_by_pitch,
    _nothing_to_doubt,
    _trusted_by_pitch,
    analyze,
)
from app.services.audio_config import load_audio_config
from app.services.pitch_evidence import midi
from app.services.score_schema import ScoreJson
from app.tests.audio_helpers import synth_bowed_take, synth_plucked_take

CFG = load_audio_config()
SR = 22050
BPM = 90.0
BEAT = 60.0 / BPM

_STEPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
#: G major across the violin's range, as MIDI numbers.
G_MAJOR = [m for m in range(55, 84) if m % 12 in (7, 9, 11, 0, 2, 4, 6)]


def _name(m: int) -> str:
    return f"{_STEPS[m % 12]}{m // 12 - 1}"


def _hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def _tune(seed: int, n: int = 32) -> list[int]:
    """A melody in G major: steps and small leaps, the shape of real lines."""
    rng = np.random.default_rng(seed)
    at, out = int(rng.integers(4, len(G_MAJOR) - 8)), []
    for _ in range(n):
        out.append(G_MAJOR[at])
        at = int(np.clip(at + rng.choice([-2, -1, -1, 1, 1, 2, 3, -3]), 0, len(G_MAJOR) - 1))
    return out


def _page(tune: list[int]) -> ScoreJson:
    return ScoreJson.model_validate(
        {
            "time_signature": "4/4",
            "clef": "treble",
            "repeats": [],
            "ocr_confidence": 1.0,
            "measures": [
                {
                    "measure_number": k + 1,
                    "notes": [
                        {"pitch": _name(p), "duration": "quarter"} for p in tune[4 * k : 4 * k + 4]
                    ],
                    "slurs": [],
                }
                for k in range(len(tune) // 4)
            ],
        }
    )


def _loose(seed: int, n: int, spread: float = 0.7) -> np.ndarray:
    """Onsets whose every gap is anywhere within ±`spread` of a beat."""
    rng = np.random.default_rng(seed)
    return np.concatenate([[0.6], 0.6 + np.cumsum(BEAT * rng.uniform(1 - spread, 1 + spread, n - 1))])


def _take(tune: list[float], times: np.ndarray) -> np.ndarray:
    return synth_bowed_take(times, freqs_hz=[_hz(m) for m in tune], sr=SR)


def _traced(y: np.ndarray, page: ScoreJson) -> tuple[str, dict]:
    trace: dict = {}
    result = analyze((y, SR), page, BPM, instrument="violin", trace=trace)
    return result.status, trace


# ---- the chain ---------------------------------------------------------------


def _same_pitch(heard: list[str], written: list[str]) -> np.ndarray:
    return np.array([[0.0 if h == w else 1.0 for w in written] for h in heard])


def _chain(heard: list[str], written: list[str], optional: list[bool] | None = None):
    skip = np.array([0.05 if o else 0.6 for o in (optional or [False] * len(written))])
    return _chain_path(_same_pitch(heard, written), 0.6, skip)


def test_an_extra_attack_is_left_out_of_the_chain() -> None:
    assert _chain(["C", "D", "D", "E", "F"], ["C", "D", "E", "F"]) in (
        [(0, 0), (1, 1), (3, 2), (4, 3)],
        [(0, 0), (2, 1), (3, 2), (4, 3)],
    )


def test_a_held_note_bowed_again_is_paired_at_its_first_attack() -> None:
    """**A note begins once.** A cellist holding a note swells it or changes
    bow inside it, and each is an attack at the note's own pitch. Pitch alone
    cannot say which of them is the note, and the chain took the last. On
    URMP's Jupiter cello part (2026-11-13) that was 126 attacks for 54 notes:
    every note was paired near its end, and 49 of the 54 sat more than 100 ms
    from their label. A note begins at its first attack at that pitch; the
    rest are the note going on (`alignment._first_attacks`)."""
    written = ["D3", "E3", "C#3", "D3"]
    heard = ["D3", "D3", "D3", "E3", "E3", "C#3", "C#3", "D3"]
    detected = np.array([0.0, 0.35, 0.7, 1.0, 1.4, 2.0, 2.5, 3.0])
    anchored = align_chain(
        detected,
        np.arange(len(written), dtype=float),
        _same_pitch(heard, written),
        target_bpm=60.0,
        config=CFG,
    )
    assert anchored.alignment.mapping == [(0, 0), (3, 1), (5, 2), (7, 3)]


def test_the_right_pitch_far_from_its_place_is_not_its_note() -> None:
    """**An attack more than four played gaps from where its note belongs is
    something else** (`CHAIN_TIME_WEIGHT`, unsaturated 2026-11-14). The page
    ends on two B4s, the player holds them as one, and a sound 5 s after the
    last attack still reads B4. With the time cost saturated at one gap, it
    cost the chain no more than an attack slightly late, and it was paired as
    the last note. Unsaturated, it is left out. On URMP's real takes that
    added up to 21 more notes paired within 100 ms of their labels in K515's
    cello part alone."""
    written = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "B4"]
    heard = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "B4"]
    detected = np.array([0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 12.0])
    anchored = align_chain(
        detected,
        np.arange(len(written), dtype=float),
        _same_pitch(heard, written),
        target_bpm=60.0,
        config=CFG,
    )
    mapping = anchored.alignment.mapping
    assert all(detected[d + anchored.trimmed_lead] < 7.0 for d, _ in mapping), mapping
    assert [e for _, e in mapping][:6] == [0, 1, 2, 3, 4, 5]


def test_a_note_not_played_is_skipped() -> None:
    assert _chain(["C", "D", "F"], ["C", "D", "E", "F"]) == [(0, 0), (1, 1), (2, 3)]


def test_a_wrong_note_between_right_ones_stays_paired() -> None:
    """The owner's rule: the note in between that is out of tune is still that
    note, and its timing is still reported."""
    assert _chain(["C", "D", "X", "F", "G"], ["C", "D", "E", "F", "G"]) == [
        (0, 0), (1, 1), (2, 2), (3, 3), (4, 4),
    ]


def test_an_unheard_slurred_note_costs_the_chain_almost_nothing() -> None:
    path = _chain(["C", "E", "F"], ["C", "D", "E", "F"], optional=[False, True, False, False])
    assert path == [(0, 0), (1, 2), (2, 3)]


def test_where_one_pitch_repeats_the_attack_on_time_takes_the_note() -> None:
    """Pitch cannot say which of two D attacks is the written D; where they
    fall can. A re-attack half a beat after the one on time is the extra."""
    written = ["C4", "D4", "E4", "F4", "G4", "A4"]
    detected = np.array([0.0, 1.0, 1.55, 2.0, 3.0, 4.0, 5.0])
    heard = ["C4", "D4", "D4", "E4", "F4", "G4", "A4"]
    anchored = align_chain(
        detected,
        np.arange(len(written), dtype=float),
        _same_pitch(heard, written),
        target_bpm=60.0,
        config=CFG,
    )
    assert anchored.alignment.mapping == [(0, 0), (1, 1), (3, 2), (4, 3), (5, 4), (6, 5)]


def _run_of_e4(detected: np.ndarray, extra: float | None = None) -> dict[int, float]:
    """Twelve written E4s between C4 D4 and F4 G4, one second apart, paired
    with `detected` (every attack heard at its own pitch, `extra` at E4 too)."""
    written = ["C4", "D4", *["E4"] * 12, "F4", "G4"]
    times = sorted([*detected, *([] if extra is None else [extra])])
    heard = [
        "C4" if t < 0.5 else "D4" if t < 1.5 else "F4" if 13.9 < t < 14.5 else "G4" if t > 14.5 else "E4"
        for t in times
    ]
    anchored = align_chain(
        np.array(times),
        np.arange(len(written), dtype=float),
        _same_pitch(heard, written),
        target_bpm=60.0,
        config=CFG,
        heights=[midi(p) for p in written],
    )
    lead = anchored.trimmed_lead
    return {e: times[d + lead] for d, e in anchored.alignment.mapping}


def test_an_extra_attack_in_a_run_of_one_pitch_is_left_out_where_it_was() -> None:
    """**Inside a run of one pitch, pitch cannot say which attack is extra.**
    Twelve written E4s heard as thirteen attacks at E4, one a re-attack half
    a second into the last. The chain left out the run's second attack
    instead and paired every later E4 with the attack after its own. The
    spacing says where the extra one is: it leaves a gap half the written
    one (`alignment._runs_by_spacing`)."""
    paired = _run_of_e4(np.arange(16.0), extra=13.5)
    assert paired == {e: float(e) for e in range(16)}


def test_an_out_of_tune_note_inside_a_run_of_one_pitch_is_still_its_note() -> None:
    """The owner's rule for the chain holds inside a run too: the note that is
    out of tune is still that note. The first version of the spacing repair
    looked only at attacks heard at the run's pitch, and so left out a note
    the chain had kept: one synthetic bass take in a noisy room lost note 19.
    """
    written = ["C4", "D4", *["E4"] * 12, "F4", "G4"]
    heard = [*written[:7], "X", *written[8:]]
    detected = np.arange(16.0)
    anchored = align_chain(
        detected,
        np.arange(len(written), dtype=float),
        _same_pitch(heard, written),
        target_bpm=60.0,
        config=CFG,
        heights=[midi(p) for p in written],
    )
    assert sorted(anchored.alignment.mapping) == [(e, e) for e in range(16)]


def test_a_missed_attack_in_a_run_of_one_pitch_leaves_out_its_own_note() -> None:
    """**And the same for an attack the detector did not hear.** On URMP's
    "In the Hall of the Mountain King" (2026-11-14) the second violin's 64
    repeated E4s lost one attack, and the 31 E4s after it were each paired
    with the attack of the note after: a slide of one note, 329 ms, to the
    end of the run. The missing attack leaves a gap twice the written one,
    and that is the note left out."""
    paired = _run_of_e4(np.delete(np.arange(16.0), 7))
    assert paired == {e: float(e) for e in range(16) if e != 7}


def test_an_attack_the_chain_left_out_is_extra() -> None:
    """`align_dtw` gives every attack a note, so the cleanup only ever found
    extras among several attacks on one note. The chain leaves them out."""
    detected = np.array([0.0, 1.0, 1.5, 2.0])
    expected = np.array([0.0, 1.0, 2.0])
    alignment = AlignmentResult(
        mapping=[(0, 0), (1, 1), (3, 2)], cost=0.0, quality=1.0, n_detected=4, n_expected=3
    )
    cleaned = apply_fuzzy_match(alignment, detected, expected)
    assert cleaned.extra_detected == [2]
    assert cleaned.missed_expected == []


# ---- trust ---------------------------------------------------------------------


def test_trust_counts_the_notes_the_page_asks_for_not_the_notes_paired() -> None:
    """A chain free to leave notes out can pair only the ones that match: a
    different tune in the same key matched every note it paired."""
    assert not _trusted_by_pitch(_Confirmed(notes=12, paired=12, pitches=6, asked=32), CFG)
    assert _trusted_by_pitch(_Confirmed(notes=28, paired=31, pitches=9, asked=32), CFG)


def test_a_long_page_needs_less_of_its_chain_heard_as_a_last_resort() -> None:
    """**Chance falls as a page grows, and the share was set where it is
    highest.** A different tune in the same key reaches 0.62 of a 16-note page
    but at most 0.50 of 64 notes and 0.45 of 256 (2026-11-14). URMP's K515
    cello part, 360 notes with rubato, was refused as "same notes, different
    times" with 242 of them heard at pitch: 0.67.

    Only as a last resort — timing refused the take and no other reading of
    it follows. Rescued on the first of its two readings, "He's a Pirate"'s
    viola was kept from the second, which pairs it better; that half is held
    by `test_a_take_refused_with_the_vibrato_filter_is_read_without_it`. And
    only to be paired: a take is reported at the usual share, after the
    second look (`test_a_long_page_paired_on_the_lower_share_is_reported_only_at_the_usual_one`)."""
    k515 = _Confirmed(notes=242, paired=283, pitches=24, asked=360)
    assert _trusted_by_pitch(k515, CFG, last_resort=True)
    assert not _trusted_by_pitch(k515, CFG)
    short = _Confirmed(notes=22, paired=24, pitches=8, asked=32)
    assert not _trusted_by_pitch(short, CFG, last_resort=True)
    below = _Confirmed(notes=230, paired=283, pitches=24, asked=360)
    assert not _trusted_by_pitch(below, CFG, last_resort=True)


def test_trust_needs_enough_notes_on_enough_pitches() -> None:
    assert not _trusted_by_pitch(_Confirmed(notes=6, paired=6, pitches=4, asked=6), CFG)
    assert not _trusted_by_pitch(_Confirmed(notes=16, paired=16, pitches=2, asked=16), CFG)


def test_the_page_heard_beyond_chance_is_somebody_playing() -> None:
    """The owner's bass take told "Try again closer to your instrument" on the
    re-run of 2026-09-25: 15 of 59 paired notes at their exact written pitch,
    on seven pitches — far from trusted, and far beyond chance."""
    assert _heard_by_pitch(_Confirmed(notes=15, paired=59, pitches=7, asked=75), CFG)
    assert _heard_by_pitch(_Confirmed(notes=7, paired=17, pitches=3, asked=75), CFG)


def test_a_few_notes_at_pitch_are_not_somebody_playing() -> None:
    """Chance, or one sound: what `why_not_played` is still asked about."""
    # About what chance puts on the page's pitches.
    assert not _heard_by_pitch(_Confirmed(notes=9, paired=59, pitches=5, asked=75), CFG)
    # Too few to tell from luck.
    assert not _heard_by_pitch(_Confirmed(notes=2, paired=5, pitches=2, asked=75), CFG)
    # Beyond chance, but one or two pitches: a ringing stand, an open string.
    assert not _heard_by_pitch(_Confirmed(notes=12, paired=16, pitches=1, asked=32), CFG)
    assert not _heard_by_pitch(_Confirmed(notes=12, paired=16, pitches=2, asked=32), CFG)


# ---- a take ------------------------------------------------------------------------


def test_the_page_played_with_loose_timing_is_judged_not_refused(monkeypatch) -> None:
    """Every note of the page in order, every gap anywhere between 0.3 and 1.7
    beats: the timing is the finding, and it is reported.

    **Re-based 2026-11-13 from the gaps of seed 0 to those of seed 1**, when
    timing alone stopped refusing seed 0: with each mel band held at its own
    noise floor, the second look recovered none of the three onsets it used
    to, and timing paired the 26 attacks left as bars 1–3 at 69 BPM — quality
    0.411, a hair over `broken_quality`. The chain still reads it, as this
    test's first half says of seed 1, and timing alone still refuses seeds 1–3
    of tune 101 and all four of tunes 102 and 103.
    """
    tune = _tune(101)
    y = _take(tune, _loose(1, len(tune)))

    status, trace = _traced(y, _page(tune))
    assert status == "ok"
    assert trace["paired_by"] == "chain"
    assert trace["confirmed"]["trusted"]

    # And timing alone refused it, which is the point.
    monkeypatch.setattr(analysis, "_by_chain", lambda *a, **k: None)
    status, _ = _traced(y, _page(tune))
    assert status == "alignment_failed"


def test_a_long_page_paired_on_the_lower_share_is_reported_only_at_the_usual_one(
    monkeypatch,
) -> None:
    """**The lower share lets the chain pair a long page; the usual share
    reports it.** As a last resort, a long page timing refused is paired by
    its chain on 0.65 of it heard at pitch (`_trusted_by_pitch`), so the second
    look searches where the page's notes belong. The take is reported only if
    it is then heard at 0.7. The notes a take of the page missed are there to
    be found, and the notes a different part lacks are not. K515's cello part
    rose from 0.67 of its page to 0.81. Jerusalem's double bass, read against
    the cello part it doubles, rose from 0.66 to 0.67, and was given a verdict
    until the usual share held it (2026-11-14).

    Here 96 notes are played with every fourth a step away, and gaps anywhere
    within ±70% of a beat. Timing refuses the take. The chain hears 0.69 of
    the page and pairs it on the lower share, and the second look takes it
    past 0.7. With nothing for the second look to find, the take is refused.
    """
    admitted: list[float] = []
    trust = analysis._trusted_by_pitch

    def watched(confirmed, config, *, last_resort: bool = False) -> bool:
        out = trust(confirmed, config, last_resort=last_resort)
        if last_resort and out and not trust(confirmed, config):
            admitted.append(confirmed.notes / confirmed.asked)
        return out

    monkeypatch.setattr(analysis, "_trusted_by_pitch", watched)
    page = _tune(104, 96)
    played = [
        G_MAJOR[min(G_MAJOR.index(m) + 2, len(G_MAJOR) - 1)] if i % 4 == 3 else m
        for i, m in enumerate(page)
    ]
    y = _take(played, _loose(4, len(page)))

    status, trace = _traced(y, _page(page))
    assert admitted, "the chain was not paired on the lower share: re-base the take"
    assert status == "ok"
    assert trace["paired_by"] == "chain"
    assert trace["confirmed"]["notes"] / trace["confirmed"]["asked"] >= 0.7

    admitted.clear()
    monkeypatch.setattr(
        analysis, "_recover_missed_onsets", lambda *a, **k: np.array([], dtype=float)
    )
    status, _ = _traced(y, _page(page))
    assert admitted
    assert status == "alignment_failed"


def test_one_note_out_of_tune_does_not_break_the_chain() -> None:
    tune = _tune(101)
    played = [float(m) for m in tune]
    played[13] += 1.0  # a semitone sharp
    status, trace = _traced(_take(played, _loose(0, len(tune))), _page(tune))

    assert status == "ok"
    assert trace["paired_by"] == "chain"


def test_a_bar_the_scan_misread_does_not_cost_the_take_its_verdict() -> None:
    """The page says one thing in bar 5, the musician played what was printed."""
    tune = _tune(101)
    misread = list(tune)
    misread[16:20] = [G_MAJOR[min(G_MAJOR.index(m) + 2, len(G_MAJOR) - 1)] for m in tune[16:20]]
    status, trace = _traced(_take(tune, _loose(0, len(tune))), _page(misread))

    assert status == "ok"
    assert trace["confirmed"]["trusted"]


@pytest.mark.parametrize("seed", range(5))
def test_a_different_tune_in_the_same_key_is_never_paired_as_the_page(seed: int) -> None:
    """The failure this rule exists to prevent. Before trust was counted against
    the page's notes, two of six such takes were trusted and given a verdict."""
    page = _tune(100 + seed)
    other = _tune(200 + seed)
    _, trace = _traced(_take(other, _loose(seed, len(other))), _page(page))

    assert trace.get("paired_by") != "chain"
    assert not trace.get("confirmed", {}).get("trusted")


# ---- one note more ----------------------------------------------------------------


def _candidate(notes: int, paired: int, quality: float) -> SimpleNamespace:
    """What `_nothing_to_doubt` reads of a chained pairing, and nothing else."""
    return SimpleNamespace(
        confirmed=_Confirmed(notes=notes, paired=paired),
        anchored=SimpleNamespace(alignment=SimpleNamespace(quality=quality)),
    )


def test_one_note_more_is_enough_only_where_the_chain_leaves_nothing_to_doubt() -> None:
    assert _nothing_to_doubt(_candidate(37, 37, 0.931), 0.827)
    assert not _nothing_to_doubt(_candidate(31, 35, 0.892), 0.823), "a note at another pitch"
    assert not _nothing_to_doubt(_candidate(37, 37, 0.827), 0.827), "timing scores it as well"
    assert not _nothing_to_doubt(_candidate(37, 37, 0.80), 0.827), "timing scores it better"
    assert not _nothing_to_doubt(_candidate(0, 0, 0.9), 0.827), "nothing paired"


#: Eight bars of a pizzicato violin part, the synthetic take that found this
#: (`accuracy_bench.py`, `violin/pizz/108/missed/noise/1057`): bar 4 is four
#: D's and then a G.
_TWO_HOLES_BARS = [
    ["F#5 q", "E5 q", "F#5 q", "D5 q"],
    ["B4 q", "A4 e", "B4 e", "C5 q", "B4 q"],
    ["D5 q", "A4 q", "F#4 e", "G4 e", "F#4 e", "D4 e"],
    ["D4 q", "D4 q", "D4 e", "D4 e", "G4 e", "F#4 e"],
    ["G4 q", "D4 e", "G4 e", "A4 q", "F#4 q"],
    ["E4 e", "D4 e", "D4 e", "G4 e", "D4 q", "E4 q"],
    ["D4 dq", "D4 e", "D4 q", "D4 q"],
    ["D4 h", "D4 q", "F#4 q"],
]
_TWO_HOLES_AT = [
    1.1, 1.646, 2.202, 2.755, 3.319, 3.88, 4.168, 4.427, 4.985, 5.546, 6.091, 6.657, 6.931,
    7.216, 7.484, 7.773, 8.317, 8.873, 9.149, 9.426, 9.702, 9.99, 10.548, 10.814, 11.104,
    11.656, 12.219, 12.483, 12.768, 13.044, 13.332, 13.875, 14.428, 15.272, 15.546, 16.106,
    16.651, 17.764, 18.32,
]


def test_two_notes_left_out_of_a_run_of_one_pitch_are_the_ones_reported(monkeypatch) -> None:
    """The second and fourth D's of bar 4 left out, at 108 BPM.

    Timing read the take a note early across both holes: the third D's sound
    on the second D, the G's on the third D, and the third D and the G
    reported missing. The chain pairs every note at its own pitch and fits
    the take's timing better by timing's own score, but hears only one note
    more at pitch than timing's pairing, which `CHAIN_GAIN_NOTES` alone
    refused (`_nothing_to_doubt`).
    """
    lengths = {"q": "quarter", "e": "eighth", "dq": "dotted_quarter", "h": "half"}
    page = ScoreJson.model_validate(
        {
            "time_signature": "4/4",
            "clef": "treble",
            "repeats": [],
            "ocr_confidence": 1.0,
            "measures": [
                {
                    "measure_number": k + 1,
                    "notes": [
                        {"pitch": p, "duration": lengths[d]}
                        for p, d in (note.split() for note in bar)
                    ],
                    "slurs": [],
                }
                for k, bar in enumerate(_TWO_HOLES_BARS)
            ],
        }
    )
    pitches = [midi(note.split()[0]) for bar in _TWO_HOLES_BARS for note in bar]
    left_out = {16, 18}
    played = [i for i in range(len(_TWO_HOLES_AT)) if i not in left_out]
    y = synth_plucked_take(
        [_TWO_HOLES_AT[i] for i in played], [_hz(pitches[i]) for i in played], sr=SR
    )

    def missing() -> set[int]:
        result = analyze((y, SR), page, 108.0, instrument="violin")
        assert result.status == "ok"
        return set(range(len(_TWO_HOLES_AT))) - {p.global_index for p in result.per_note}

    assert missing() == left_out
    monkeypatch.setattr(analysis, "_nothing_to_doubt", lambda candidate, quality: False)
    assert missing() == left_out, "timing's own score prefers the chain's pairing as well"
    monkeypatch.setattr(
        analysis, "_timing_prefers_the_chain", lambda candidate, timed, quality: False
    )
    assert missing() == {17, 18}, "without either rule, timing's pairing stands"


# ---- where pitch cannot choose -----------------------------------------------------


def test_the_chain_re_pairs_where_it_dominates_on_every_count() -> None:
    """At least as many notes paired and heard at pitch, and scored higher by
    timing's own measure. The numbers are the synthetic takes'."""
    prefers = analysis._timing_prefers_the_chain
    assert prefers(_candidate(39, 39, 0.922), _Confirmed(notes=39, paired=39), 0.892), "1087"
    assert prefers(_candidate(18, 35, 0.935), _Confirmed(notes=17, paired=35), 0.814), "1180"
    assert not prefers(
        _candidate(27, 38, 0.932), _Confirmed(notes=27, paired=39), 0.913
    ), "1140: one note fewer paired"
    assert not prefers(_candidate(30, 36, 0.95), _Confirmed(notes=31, paired=36), 0.90), (
        "a note fewer at pitch"
    )
    assert not prefers(_candidate(39, 39, 0.892), _Confirmed(notes=39, paired=39), 0.892), (
        "timing scores it as well"
    )
    assert not prefers(_candidate(96, 96, 0.979), _Confirmed(notes=96, paired=96), 0.977), (
        "a lead the score cannot tell from a tie"
    )
    assert not prefers(_candidate(0, 0, 0.9), _Confirmed(notes=0, paired=0), 0.8), "nothing"


#: Eight bars of a bowed viola part, the synthetic take that found this
#: (`accuracy_bench.py`, `viola/bowed/132/missed/noise/1087`): bar 6 ends and
#: bar 7 begins on eight D5's in a row, and the second and the seventh are
#: left out.
_D_RUN_BARS = [
    ["F#4 q", "E4 q", "C4 q", "D4 q"],
    ["C4 e", "A3 e", "B3 e", "C4 e", "F#4 q", "B4 q"],
    ["C5 q", "D5 e", "D5 e", "D5 q", "D5 q"],
    ["D5 q", "A4 e", "C5 e", "B4 q", "C5 q"],
    ["B4 q", "A4 q", "D5 q", "A4 q"],
    ["C5 q", "B4 e", "D5 e", "D5 q", "D5 q"],
    ["D5 e", "D5 e", "D5 e", "D5 e", "D5 q", "C5 q"],
    ["D5 e", "A4 e", "G4 e", "D4 e", "B3 q", "A3 q"],
]
_D_RUN_AT = [
    0.4, 0.856, 1.289, 1.766, 2.215, 2.429, 2.678, 2.901, 3.136, 3.581, 4.032, 4.486, 4.717,
    4.954, 5.395, 5.837, 6.303, 6.536, 6.773, 7.227, 7.672, 8.133, 8.586, 9.048, 9.49, 9.928,
    10.16, 10.4, 10.85, 11.322, 11.536, 11.779, 11.988, 12.217, 12.667, 13.119, 13.343,
    13.592, 13.81, 14.038, 14.487,
]


def test_notes_left_out_of_a_run_of_one_pitch_are_reported_where_pitch_cannot_tell(
    monkeypatch,
) -> None:
    """Two of eight D5's left out, at 132 BPM: the chain and timing hear every
    note they pair at its pitch, so pitch cannot choose between them, and
    timing paired a note late across the second hole. Timing's own score
    prefers the chain's pairing (`analysis._timing_prefers_the_chain`)."""
    lengths = {"q": "quarter", "e": "eighth"}
    page = ScoreJson.model_validate(
        {
            "time_signature": "4/4",
            "clef": "treble",
            "repeats": [],
            "ocr_confidence": 1.0,
            "measures": [
                {
                    "measure_number": k + 1,
                    "notes": [
                        {"pitch": p, "duration": lengths[d]}
                        for p, d in (note.split() for note in bar)
                    ],
                    "slurs": [],
                }
                for k, bar in enumerate(_D_RUN_BARS)
            ],
        }
    )
    pitches = [midi(note.split()[0]) for bar in _D_RUN_BARS for note in bar]
    left_out = {26, 32}
    played = [i for i in range(len(_D_RUN_AT)) if i not in left_out]
    y = synth_bowed_take(
        [_D_RUN_AT[i] for i in played],
        freqs_hz=[_hz(pitches[i]) for i in played],
        sr=SR,
        note_dur_s=0.2,
    )

    def untimed() -> set[int]:
        result = analyze((y, SR), page, 132.0, instrument="viola")
        assert result.status == "ok"
        return set(range(len(_D_RUN_AT))) - {p.global_index for p in result.per_note if p.timed}

    assert untimed() == left_out
    monkeypatch.setattr(
        analysis, "_timing_prefers_the_chain", lambda candidate, timed, quality: False
    )
    assert untimed() != left_out, "without the rule, timing's pairing stands"


# ---- the octave ------------------------------------------------------------------


def _mismatch_of_one_bass_note(sounding_midi: int, written: list[str]) -> np.ndarray:
    y = synth_bowed_take([0.5], freqs_hz=[_hz(sounding_midi)], sr=SR, note_dur_s=1.2)
    return pitch_evidence.mismatch(
        pitch_evidence.chroma(y, SR, low_register=True),
        SR,
        np.array([0.5]),
        written,
        steady=CFG.pitch.steady,
        track=pitch_evidence.pitch_track(y, SR, fmin=35.0, fmax=500.0),
        transpose=-12,
    )[0]


def test_a_bass_note_is_matched_an_octave_below_where_it_is_written() -> None:
    """G3 on a bass part sounds G2. Pitch class alone could not tell G2 from
    G1 or G3, and on the owner's take that is what put bars 11–13 wrong."""
    at_g2 = _mismatch_of_one_bass_note(midi("G2"), ["G3", "G2", "A3"])
    assert at_g2[0] == 0.0, "the written note, where a bass sounds it"
    assert at_g2[1] == pytest.approx(0.5), "the same letter an octave off"
    assert at_g2[2] == 1.0, "another note"

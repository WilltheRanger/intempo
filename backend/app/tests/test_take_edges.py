"""The sound a recording is bracketed by, before the first note and after the last.

Every take begins and ends with something that is not playing: a bow settling
on the string, a chair, a page, the instrument going down. Both ends did
damage, for different reasons.

**The front moved the origin.** `to_timeline_base` has to pick one before
anything is matched, and the only candidate is the earliest detection. Its
docstring claimed the damage "does not reach the verdict", reasoning that
`compute_deltas` re-derives its origin from the first *matched* pair. Wrong:
the spurious onset is what gets matched. On eight quarters played exactly on
the grid at 60 BPM:

    scrape 0.5 s before   quality 0.486   "You rushed by 28 BPM"
    scrape 1.0 s before   quality 0.604   "Steady tempo"
    scrape 2.0 s before   quality 0.100   "check you're on the right piece"

Three answers for one perfect take, two of them confident and wrong. A
confident wrong verdict is the worst thing this app can produce — worse than
refusing to answer, because the musician has no reason to doubt it.

**The back cost confidence.** A trailing detection maps to the last written
note, and its residual is the whole distance between them:

    noise 0.6 s after     0.988 → 0.766
    noise 1.2 s after     0.988 → 0.539
    noise 2.5 s after     0.988 → 0.029

`warn_quality` is 0.7, so a perfect take was one stray sound away from
"results may be inaccurate" and two from being refused.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.services.alignment import (
    MAX_EDGE_TRIM,
    align_take,
    build_timeline,
)
from app.services.analysis import analyze
from app.services.score_schema import Measure, Note, ScoreJson
from app.tests.audio_helpers import bass_scale, synth_bowed_take

SR = 22050
BPM = 60.0
SEC_PER_BEAT = 60.0 / BPM


def _score(measures: int = 2) -> ScoreJson:
    return ScoreJson(
        clef="bass",
        time_signature="4/4",
        ocr_confidence=0.9,
        measures=[
            Measure(
                measure_number=m + 1,
                notes=[Note(pitch="E2", duration="quarter")] * 4,
            )
            for m in range(measures)
        ],
    )


def _scrape(seconds: float = 0.05, amplitude: float = 0.35, seed: int = 5) -> np.ndarray:
    """A bow settling on a string: broadband, short, and not loud.

    Deliberately quieter than the playing. A bang would be an easier problem —
    the failure being fixed here is caused by something at the *level of the
    music*, which is why volume gating never solved it.
    """
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    noise = rng.normal(0, 1, n) * np.exp(-np.linspace(0, 4, n))
    return (noise / np.abs(noise).max() * amplitude).astype(np.float32)


def _take(*, lead_in: float, scrapes_at: tuple[float, ...] = (), notes: int = 8):
    times = [lead_in + i * SEC_PER_BEAT for i in range(notes)]
    y = synth_bowed_take(times, freqs_hz=bass_scale(notes), note_dur_s=0.55)
    for index, at in enumerate(scrapes_at):
        noise = _scrape(seed=5 + index)
        start = int(at * SR)
        end = min(start + noise.size, y.size)
        y[start:end] += noise[: end - start]
    return np.clip(y, -1.0, 1.0).astype(np.float32)



def _cfg():
    from app.services.audio_config import load_audio_config

    return load_audio_config()


def _onsets_of(y: np.ndarray, timeline) -> np.ndarray:
    """The onsets `analyze()` would detect for this waveform, filter included."""
    from app.services import audio as audio_svc
    from app.services.alignment import closest_expected_gap

    cfg = _cfg()
    return audio_svc.detect_onsets(
        audio_svc.pre_emphasis(
            audio_svc.high_pass(y, SR, cfg.onset.double_bass_highpass_hz), config=cfg
        ),
        SR,
        double_bass=True,
        config=cfg,
        min_gap_s=closest_expected_gap(timeline.onsets),
    )


def _take_with_trailing(
    *,
    after_s: float,
    notes: int = 8,
    lead_in: float = 1.0,
    scrapes_at: tuple[float, ...] = (),
) -> np.ndarray:
    """A take with a sound after the last note, and optionally before the first."""
    y = _take(lead_in=lead_in, scrapes_at=scrapes_at, notes=notes)
    noise = _scrape(seconds=0.06, amplitude=0.4, seed=4)
    start = int((lead_in + (notes - 1) * SEC_PER_BEAT + after_s) * SR)
    if start + noise.size > y.size:
        y = np.concatenate(
            [y, np.zeros(start + noise.size - y.size, dtype=np.float32)]
        )
    y[start : start + noise.size] += noise
    return np.clip(y, -1.0, 1.0).astype(np.float32)


@pytest.mark.parametrize("gap_s", [0.5, 1.0, 2.0, 3.0])
def test_a_bow_settling_before_the_first_note_no_longer_writes_the_verdict(
    gap_s: float,
) -> None:
    """The take is perfect. The app has to say so, whenever the bow went down."""
    y = _take(lead_in=1.0 + gap_s, scrapes_at=(1.0,))

    result = analyze((y, SR), _score(), target_bpm=BPM, double_bass=True)

    assert result.status == "ok"
    assert result.quality > 0.9, f"quality {result.quality} — the scrape is still the origin"
    mean_pct = float(np.mean([d.delta_pct for d in result.per_note]))
    # The inner tolerance band is 5% of a beat. Anything beyond it here is the
    # scrape being reported as the musician's timing.
    assert abs(mean_pct) < 5.0, f"take reads as {mean_pct:+.1f}% of a beat off"


def test_two_false_starts_are_both_discarded() -> None:
    """One is the common case; more than one is a musician who is not ready."""
    y = _take(lead_in=3.0, scrapes_at=(0.6, 1.4))

    result = analyze((y, SR), _score(), target_bpm=BPM, double_bass=True)

    assert result.status == "ok"
    assert result.quality > 0.9
    assert abs(float(np.mean([d.delta_pct for d in result.per_note]))) < 5.0


def test_a_clean_take_is_left_exactly_alone() -> None:
    """The guard that matters most.

    Trimming can only make the matching problem smaller, so a search that
    rewarded any improvement at all would quietly eat the first note of every
    recording. Nothing may be discarded without being paid for it.
    """
    y = _take(lead_in=1.0)
    timeline = build_timeline(_score(), BPM)

    from app.services import audio as audio_svc
    from app.services.alignment import closest_expected_gap
    from app.services.audio_config import load_audio_config

    cfg = load_audio_config()
    onsets = audio_svc.detect_onsets(
        audio_svc.pre_emphasis(
            audio_svc.high_pass(y, SR, cfg.onset.double_bass_highpass_hz), config=cfg
        ),
        SR,
        double_bass=True,
        config=cfg,
        min_gap_s=closest_expected_gap(timeline.onsets),
    )

    anchored = align_take(
        onsets, timeline.onsets, target_bpm=BPM, config=cfg
    )
    assert anchored.trimmed_lead == 0, "a clean take had its opening note thrown away"


def test_the_wrong_piece_is_not_rescued_by_trimming() -> None:
    """The search must not become a way to pass by discarding evidence.

    Someone recording a different piece should still be told so. Four extra
    alignments give four extra chances to find a flattering one, and the only
    thing stopping that is coverage — trimming cannot invent expected notes
    that were never played.
    """
    # Twenty-four expected notes; the musician played four, of something else.
    played = [0.4, 0.9, 1.15, 2.3]
    y = synth_bowed_take(played, freqs_hz=bass_scale(4), note_dur_s=0.35)

    result = analyze((y, SR), _score(measures=6), target_bpm=BPM, double_bass=True)

    assert result.status == "alignment_failed", (
        f"a four-note take matched a twenty-four-note score at "
        f"quality {result.quality}"
    )


def test_a_take_shorter_than_the_search_survives_it() -> None:
    """Three onsets and a trim ceiling of three is how a take vanishes.

    The limit is `size - 2`, because two onsets is the least that can express
    an interval and an interval is the least DTW can score.
    """
    onsets = np.array([0.5, 1.5, 2.5])
    timeline = build_timeline(_score(measures=1), BPM)

    anchored = align_take(onsets, timeline.onsets, target_bpm=BPM)

    assert anchored.onsets.size >= 2
    assert anchored.trimmed_lead <= MAX_EDGE_TRIM


def test_one_onset_is_returned_untouched() -> None:
    """`05_open_e_long` is a single sustained note. It has nothing to trim."""
    timeline = build_timeline(_score(measures=1), BPM)

    anchored = align_take(
        np.array([0.4]), timeline.onsets, target_bpm=BPM
    )

    assert anchored.trimmed_lead == 0
    assert anchored.onsets.size == 1


def test_no_onsets_at_all_does_not_raise() -> None:
    anchored = align_take(np.array([]), np.array([0.0, 1.0]), target_bpm=BPM)
    assert anchored.trimmed_lead == 0
    assert anchored.onsets.size == 0


@pytest.mark.parametrize("gap_s", [0.6, 1.2, 2.5])
def test_putting_the_instrument_down_does_not_cost_confidence(gap_s: float) -> None:
    """The take is over. What happens next is not part of it.

    Below `warn_quality` (0.7) the screen tells the musician the numbers may be
    inaccurate. Earning that caveat by setting the bow down was the pipeline
    doubting itself for a reason that had nothing to do with the playing.
    """
    y = _take_with_trailing(after_s=gap_s)

    result = analyze((y, SR), _score(), target_bpm=BPM, double_bass=True)

    assert result.status == "ok"
    assert result.low_confidence is False
    assert result.quality > 0.9, f"quality {result.quality} — the noise is still in the take"


def test_a_stray_sound_at_the_end_does_not_cost_the_first_note() -> None:
    """Why the search is a grid and not one end and then the other.

    Trimming the *front* also raises the score on a take whose only problem is
    at the back — the sequence gets shorter either way. Greedy front-first
    therefore threw away a real first note to compensate for a problem at the
    other end, which moves the origin and rewrites every delta. The joint
    search cannot make that trade because the correct cell scores higher.
    """
    y = _take_with_trailing(after_s=2.5)
    timeline = build_timeline(_score(), BPM)
    anchored = align_take(
        _onsets_of(y, timeline), timeline.onsets, target_bpm=BPM, config=_cfg()
    )

    assert anchored.trimmed_lead == 0, "a real first note was discarded"
    assert anchored.trimmed_tail == 1


def test_noise_at_both_ends_is_trimmed_at_both_ends() -> None:
    y = _take_with_trailing(after_s=1.5, scrapes_at=(1.0,), lead_in=3.0)

    result = analyze((y, SR), _score(), target_bpm=BPM, double_bass=True)

    assert result.status == "ok"
    assert result.quality > 0.9
    assert abs(float(np.mean([d.delta_pct for d in result.per_note]))) < 5.0


def test_a_clean_take_keeps_its_last_note_too() -> None:
    """The mirror of the opening guard, and it fails for the same reason.

    On a clean take each note trimmed costs about 0.12 of quality — the metric
    pays for itself here. This asserts the outcome rather than the mechanism,
    because the mechanism is allowed to change.
    """
    y = _take(lead_in=1.0)
    timeline = build_timeline(_score(), BPM)

    anchored = align_take(
        _onsets_of(y, timeline), timeline.onsets, target_bpm=BPM, config=_cfg()
    )

    assert (anchored.trimmed_lead, anchored.trimmed_tail) == (0, 0)

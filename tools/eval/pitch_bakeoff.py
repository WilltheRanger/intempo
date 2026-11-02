#!/usr/bin/env python3
"""Compare pitch trackers against URMP's manually-corrected note labels.

    tools/eval/pitch_bakeoff.py                 # every tracker that imports
    tools/eval/pitch_bakeoff.py --tracker yin --tracker pyin
    tools/eval/pitch_bakeoff.py --out DIR       # default: tools/eval/.report/

JERA-565 asks whether `pitch_evidence.pitch_track`'s YIN should be replaced.
The docstring there already carries a measurement — pYIN 13.7 s per minute of
audio against YIN's 1.7 s, agreeing within half a semitone on 88% of attacks
and an octave apart on 3% — but it was taken on one unlabelled take, so it
could say how far the two *disagree* and not which one was *right*. URMP's
`Notes_*.txt` are manually corrected, so this can.

Two numbers, because the pipeline asks two different questions of the track:

* **frame level** — every frame inside a labelled note, which is what
  `intonation.py` medians over. RPA/RCA in the MIREX sense: raw pitch accuracy
  within a tolerance, and raw *chroma* accuracy, which folds octaves away. The
  gap between them is the octave-error rate, the thing YIN is suspected of.
* **note level** — one reading per labelled note, taken the way
  `pitch_evidence.heights_at` takes it (median of the window after the attack
  settles). This is what the note matcher and the intonation report see, and
  a tracker can be worse per frame and no worse per note.

Both are needed, and on this corpus they disagree about which tracker wins:
see `TUNING_LOG.md`, 2026-11-02.

Everything here is read-only on the pipeline: it calls `pitch_track` and the
candidate trackers directly and writes a report. Nothing is adopted by running
it.

Eval-only, like every other dataset here: URMP audio is never committed.

**Run it per tracker on a small machine.** pYIN holds a transition matrix the
length of the take; the two trackers in one process peaked around 1.5 GB on
URMP's longest part and a session container killed it. `--tracker pyin` alone
is the same numbers at a third of the memory.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

_EVAL = Path(__file__).resolve().parent
if str(_EVAL) not in sys.path:
    sys.path.insert(0, str(_EVAL))
_BACKEND = _EVAL.parents[1] / "backend"
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from app.services import pitch_evidence
from datasets.urmp import UrmpDataset

log = logging.getLogger("intempo.eval")

#: The violin row of `analysis._SOUNDING_RANGE_HZ`. Every URMP take here is a
#: separated violin part, so the range the pipeline would pick is known.
FMIN_HZ, FMAX_HZ = 180.0, 3600.0

#: A frame counts as correct within this many cents of the label — MIREX's
#: half-semitone convention, and about the same width `_IN_TUNE_ST = 0.6`
#: draws around "this *is* that note" in `pitch_evidence`.
TOLERANCE_CENTS = 50.0

#: Frames this close to a labelled note's start or end are left out. A bow's
#: attack is noise before it is a note (`heights_at` drops 30 ms for the same
#: reason), and the label's end time is where the *next* note is already
#: sounding on a slur. Scoring a tracker on frames whose true pitch is
#: genuinely ambiguous measures the label, not the tracker.
EDGE_SKIP_START_S = 0.03
EDGE_SKIP_END_S = 0.02


def _hz_to_midi(hz: np.ndarray | float) -> np.ndarray:
    return 69.0 + 12.0 * np.log2(np.asarray(hz, dtype=float) / 440.0)


def reference_contour(
    performed_notes: list[dict[str, float]], n_frames: int, sr: int
) -> np.ndarray:
    """The labelled pitch at each `HOP` frame, as fractional MIDI; NaN where
    no note is sounding or the frame sits in a note's skipped edge."""
    times = (np.arange(n_frames) * pitch_evidence.HOP) / float(sr)
    ref = np.full(n_frames, np.nan)
    for note in performed_notes:
        start = note["onset_s"] + EDGE_SKIP_START_S
        end = note["onset_s"] + note["duration_s"] - EDGE_SKIP_END_S
        if end <= start:
            continue
        ref[(times >= start) & (times < end)] = _hz_to_midi(note["hz"])
    return ref


# --- the trackers under test ------------------------------------------------
#
# Each returns fractional MIDI, one value per `pitch_evidence.HOP`, NaN where
# it reports nothing. YIN never reports nothing, which is half of what is
# being compared.


def _track_yin(y: np.ndarray, sr: int) -> np.ndarray:
    """What ships today — `pitch_evidence.pitch_track` itself, not a copy."""
    return pitch_evidence.pitch_track(y, sr, fmin=FMIN_HZ, fmax=FMAX_HZ)


def _frame_length(sr: int) -> int:
    """`pitch_track`'s own frame sizing, so the candidates are compared at the
    same analysis window rather than at librosa's defaults."""
    return 1 << int(np.ceil(np.log2(max(2048.0, 2.2 * sr / FMIN_HZ))))


def _track_pyin(y: np.ndarray, sr: int) -> np.ndarray:
    """librosa's pYIN: YIN's candidates through an HMM that prefers a
    continuous track, plus a voicing decision. Lens's first recommendation,
    and a swap that costs no new dependency — librosa is already here."""
    import librosa

    f0, _voiced, _prob = librosa.pyin(
        y,
        fmin=FMIN_HZ,
        fmax=FMAX_HZ,
        sr=sr,
        frame_length=_frame_length(sr),
        hop_length=pitch_evidence.HOP,
    )
    return librosa.hz_to_midi(np.where(np.isfinite(f0), f0, np.nan))


def _track_torchcrepe(y: np.ndarray, sr: int) -> np.ndarray:
    """CREPE, a trained model. Lens's second recommendation, "only if pyin is
    not enough and the CPU cost is acceptable" — and it is not installed in
    this sandbox, which has no network, so this path is written and unrun.
    `--tracker torchcrepe` reports it as not measured rather than failing."""
    import librosa
    import torch
    import torchcrepe

    audio = torch.tensor(y, dtype=torch.float32)[None, :]
    if sr != 16000:
        audio = torchcrepe.resample(audio, sr, 16000)
    f0 = torchcrepe.predict(
        audio,
        16000,
        int(round(pitch_evidence.HOP * 16000 / sr)),
        FMIN_HZ,
        FMAX_HZ,
        "full",
        batch_size=512,
        device="cpu",
    )
    return librosa.hz_to_midi(f0.squeeze(0).numpy())


TRACKERS = {"yin": _track_yin, "pyin": _track_pyin, "torchcrepe": _track_torchcrepe}


# --- scoring ----------------------------------------------------------------


@dataclass
class Tally:
    """Counts accumulated across takes, so one long take does not get one
    take's worth of weight. Every rate below is over frames or notes, never
    over takes."""

    frames_scored: int = 0
    frames_reported: int = 0  # the tracker returned a number here
    within_tolerance: int = 0  # RPA
    chroma_within_tolerance: int = 0  # RCA
    octave_errors: int = 0  # chroma right, octave wrong
    abs_cents: list[float] = field(default_factory=list)  # |error| where RPA-correct
    notes_scored: int = 0
    notes_within_tolerance: int = 0
    notes_chroma_within: int = 0
    notes_octave_errors: int = 0
    notes_unreported: int = 0
    note_abs_cents: list[float] = field(default_factory=list)
    audio_s: float = 0.0
    cpu_s: float = 0.0
    wall_s: float = 0.0
    takes: int = 0


def score_frames(tally: Tally, est: np.ndarray, ref: np.ndarray) -> None:
    n = min(est.size, ref.size)
    est, ref = est[:n], ref[:n]
    scored = np.isfinite(ref)
    tally.frames_scored += int(scored.sum())

    reported = scored & np.isfinite(est)
    tally.frames_reported += int(reported.sum())
    if not reported.any():
        return

    err_st = est[reported] - ref[reported]
    close = np.abs(err_st) * 100.0 <= TOLERANCE_CENTS
    # Fold to the nearest octave before re-asking: an estimate 12.0 semitones
    # out is the same chroma, which is what RCA forgives and RPA does not.
    folded = err_st - 12.0 * np.round(err_st / 12.0)
    chroma_close = np.abs(folded) * 100.0 <= TOLERANCE_CENTS

    tally.within_tolerance += int(close.sum())
    tally.chroma_within_tolerance += int(chroma_close.sum())
    tally.octave_errors += int((chroma_close & ~close).sum())
    tally.abs_cents.extend((np.abs(err_st[close]) * 100.0).tolist())


def score_notes(
    tally: Tally, est: np.ndarray, performed_notes: list[dict[str, float]], sr: int
) -> None:
    """One reading per labelled note, taken through `heights_at` — the same
    window the matcher and the intonation report read, so this is the number
    that would actually change a verdict."""
    onsets = np.array([n["onset_s"] for n in performed_notes], dtype=float)
    if onsets.size == 0:
        return
    heard = pitch_evidence.heights_at(est, sr, onsets)
    truth = _hz_to_midi(np.array([n["hz"] for n in performed_notes], dtype=float))

    tally.notes_scored += int(onsets.size)
    ok = np.isfinite(heard)
    tally.notes_unreported += int((~ok).sum())
    if not ok.any():
        return
    err_st = heard[ok] - truth[ok]
    close = np.abs(err_st) * 100.0 <= TOLERANCE_CENTS
    folded = err_st - 12.0 * np.round(err_st / 12.0)
    chroma_close = np.abs(folded) * 100.0 <= TOLERANCE_CENTS
    tally.notes_within_tolerance += int(close.sum())
    tally.notes_chroma_within += int(chroma_close.sum())
    tally.notes_octave_errors += int((chroma_close & ~close).sum())
    tally.note_abs_cents.extend((np.abs(err_st[close]) * 100.0).tolist())


def _rate(num: int, den: int) -> float | None:
    return float(num) / den if den else None


def summarise(tally: Tally) -> dict[str, float | int | None]:
    minutes = tally.audio_s / 60.0
    return {
        "takes": tally.takes,
        "audio_s": round(tally.audio_s, 1),
        "cpu_s": round(tally.cpu_s, 2),
        "cpu_s_per_audio_minute": round(tally.cpu_s / minutes, 2) if minutes else None,
        "wall_s_per_audio_minute": round(tally.wall_s / minutes, 2) if minutes else None,
        "frames_scored": tally.frames_scored,
        "frame_voiced_report_rate": _rate(tally.frames_reported, tally.frames_scored),
        "frame_rpa": _rate(tally.within_tolerance, tally.frames_scored),
        "frame_rca": _rate(tally.chroma_within_tolerance, tally.frames_scored),
        "frame_octave_error_rate": _rate(tally.octave_errors, tally.frames_scored),
        "frame_median_abs_cents": (
            round(float(np.median(tally.abs_cents)), 2) if tally.abs_cents else None
        ),
        "notes_scored": tally.notes_scored,
        "note_unreported_rate": _rate(tally.notes_unreported, tally.notes_scored),
        "note_rpa": _rate(tally.notes_within_tolerance, tally.notes_scored),
        "note_rca": _rate(tally.notes_chroma_within, tally.notes_scored),
        "note_octave_error_rate": _rate(tally.notes_octave_errors, tally.notes_scored),
        "note_median_abs_cents": (
            round(float(np.median(tally.note_abs_cents)), 2)
            if tally.note_abs_cents
            else None
        ),
    }


_COLUMNS = [
    ("takes", "takes", "{}"),
    ("audio_s", "audio (s)", "{:.1f}"),
    ("cpu_s_per_audio_minute", "CPU s / audio min", "{:.2f}"),
    ("wall_s_per_audio_minute", "wall s / audio min", "{:.2f}"),
    ("frames_scored", "frames scored", "{}"),
    ("frame_voiced_report_rate", "frames with a reading", "{:.3f}"),
    ("frame_rpa", "frame RPA (±50c)", "{:.3f}"),
    ("frame_rca", "frame RCA (±50c)", "{:.3f}"),
    ("frame_octave_error_rate", "frame octave errors", "{:.3f}"),
    ("frame_median_abs_cents", "frame median |err| (c)", "{:.2f}"),
    ("notes_scored", "notes scored", "{}"),
    ("note_unreported_rate", "notes with no reading", "{:.3f}"),
    ("note_rpa", "note RPA (±50c)", "{:.3f}"),
    ("note_rca", "note RCA (±50c)", "{:.3f}"),
    ("note_octave_error_rate", "note octave errors", "{:.3f}"),
    ("note_median_abs_cents", "note median |err| (c)", "{:.2f}"),
]


def to_markdown(results: dict[str, dict], skipped: dict[str, str]) -> str:
    names = list(results)
    lines = [
        "# Pitch-tracker bake-off (JERA-565)",
        "",
        f"URMP violin parts, manually-corrected note labels. Tolerance "
        f"{TOLERANCE_CENTS:.0f} cents; frames within {EDGE_SKIP_START_S * 1000:.0f} ms "
        f"of a note's start or {EDGE_SKIP_END_S * 1000:.0f} ms of its end are not scored.",
        "",
        "| metric | " + " | ".join(names) + " |",
        "|---" * (len(names) + 1) + "|",
    ]
    for key, label, fmt in _COLUMNS:
        cells = []
        for name in names:
            value = results[name].get(key)
            cells.append("—" if value is None else fmt.format(value))
        lines.append(f"| {label} | " + " | ".join(cells) + " |")
    if skipped:
        lines += ["", "## Not measured", ""]
        for name, why in skipped.items():
            lines.append(f"- **{name}** — {why}")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--tracker",
        action="append",
        choices=sorted(TRACKERS),
        help="repeatable; default is every tracker that imports",
    )
    parser.add_argument("--out", type=Path, default=_EVAL / ".report")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING)

    takes = UrmpDataset().load()
    if not takes:
        print(
            "pitch-bakeoff: no URMP takes — run tools/eval/fetch_urmp.py first",
            file=sys.stderr,
        )
        return 1

    results: dict[str, dict] = {}
    skipped: dict[str, str] = {}

    for name in args.tracker or sorted(TRACKERS):
        track = TRACKERS[name]
        tally = Tally()
        try:
            for take in takes:
                y, sr = take.audio
                cpu, wall = time.process_time(), time.perf_counter()
                est = track(y, sr)
                tally.cpu_s += time.process_time() - cpu
                tally.wall_s += time.perf_counter() - wall
                tally.audio_s += y.size / float(sr)
                tally.takes += 1
                notes = take.ground_truth["performed_notes"]
                score_frames(tally, est, reference_contour(notes, est.size, sr))
                score_notes(tally, est, notes, sr)
                log.info("pitch-bakeoff: %s scored %s", name, take.take_id)
        except ImportError as exc:
            skipped[name] = f"not installed in this sandbox: {exc}"
            continue
        results[name] = summarise(tally)

    args.out.mkdir(parents=True, exist_ok=True)
    payload = {
        "tolerance_cents": TOLERANCE_CENTS,
        "fmin_hz": FMIN_HZ,
        "fmax_hz": FMAX_HZ,
        "trackers": results,
        "skipped": skipped,
    }
    (args.out / "pitch_bakeoff.json").write_text(json.dumps(payload, indent=2) + "\n")
    markdown = to_markdown(results, skipped)
    (args.out / "pitch_bakeoff.md").write_text(markdown)
    print(markdown)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

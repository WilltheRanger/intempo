"""Analyse one recording against one score, and print what the app would say.

    python -m tuning_dashboard.cli fixtures/audio/01_detache_clean.wav

The point is the first five minutes after a recording exists. Everything else
that stands between a musician and a verdict — Supabase keys, a deployed API,
a phone with a microphone permission — is a separate problem, and none of it
should have to work before you can find out whether the *pipeline* does.

Reads the score from `fixtures/audio/manifest.json` when the filename matches a
clip in it, so recording `01_detache_clean.wav` and running this needs no
arguments at all. `--score` takes a `score_json` file for anything else.

Prints exactly what the analysis produced. It does not grade the take, offer
encouragement, or round anything into a sentence that was not in the result —
this is for looking at the pipeline, and a tool that flatters its input is
useless for that.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from app.services.analysis import AnalysisResult, analyze
from app.services.score_schema import ScoreJson


def _clip_for(audio: Path) -> tuple[ScoreJson, float, bool] | None:
    """`(score, bpm, double_bass)` if this file is one of the corpus clips."""
    from tuning_dashboard.corpus import load_corpus

    stem = audio.stem.removesuffix(".synthetic")
    for clip in load_corpus():
        if clip.id == stem:
            return clip.score, clip.target_bpm, clip.double_bass
    return None


def _bar(value_pct: float, width: int = 21) -> str:
    """A signed bar around a centre column. Ahead of the beat is left.

    Full deflection is the outer tolerance band, the same place the app pins
    its own bar — so a bar that runs out of room means "severe" and not "this
    looked better wider".
    """
    from app.services.audio_config import load_audio_config

    tol = load_audio_config().tolerance
    limit = tol.rushing_outer_pct if value_pct < 0 else tol.dragging_outer_pct
    half = width // 2
    cells = max(-half, min(half, round(value_pct / max(limit, 1e-9) * half)))
    line = [" "] * width
    line[half] = "|"
    for step in range(1, abs(cells) + 1):
        line[half + (step if cells > 0 else -step)] = "="
    return "".join(line)


def _render(result: AnalysisResult, audio: Path, bpm: float, bass: bool) -> str:
    out: list[str] = []
    out.append(f"{audio.name}   {bpm:g} BPM" + ("   double bass" if bass else ""))
    out.append("")
    out.append(result.verdict)
    out.append("")
    caveat = "  (low confidence — the app would show a caveat)" if result.low_confidence else ""
    out.append(f"status {result.status}   quality {result.quality:.3f}{caveat}")
    out.append(
        f"heard {result.n_detected_onsets} onsets against {result.n_expected_onsets} "
        f"written   missed {result.n_missed_notes}   extra {result.n_extra_notes}"
    )
    if result.tolerance is not None:
        tol = result.tolerance
        out.append(
            f"bands  on ≤{tol.rushing_inner_pct:g}%  slight ≤{tol.rushing_mid_pct:g}%  "
            f"off ≤{tol.rushing_outer_pct:g}%  (rushing side)"
        )

    if result.per_measure:
        out.append("")
        out.append("  bar  notes   drift            ahead | behind")
        for m in result.per_measure:
            flag = " " if m.worst_band == "on" else "*"
            out.append(
                f"{flag} {m.measure_number:>3}  {m.note_count:>5}  "
                f"{m.avg_delta_pct:+6.1f}%  {_bar(m.avg_delta_pct)}"
            )
        out.append("")
        out.append("  * = outside the on-tempo band. Drift is % of one beat, "
                   "positive is behind.")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m tuning_dashboard.cli",
        description="Run one recording through the analysis pipeline.",
    )
    parser.add_argument("audio", type=Path, help="a WAV (or anything librosa reads)")
    parser.add_argument(
        "--score",
        type=Path,
        help="a score_json file; inferred from the corpus manifest when omitted",
    )
    parser.add_argument("--bpm", type=float, help="target tempo")
    parser.add_argument(
        "--bass",
        action="store_true",
        help="use the low-register onset settings, as the app does for a bass",
    )
    parser.add_argument("--json", action="store_true", help="print the raw result")
    args = parser.parse_args(argv)

    if not args.audio.exists():
        print(f"no such file: {args.audio}", file=sys.stderr)
        return 2

    known = _clip_for(args.audio)
    if args.score is not None:
        score = ScoreJson.model_validate(json.loads(args.score.read_text()))
        bpm, bass = args.bpm, args.bass
    elif known is not None:
        score, bpm, bass = known
        bpm = args.bpm if args.bpm is not None else bpm
        bass = args.bass or bass
    else:
        print(
            f"{args.audio.name} is not a corpus clip, so it needs --score "
            f"(and --bpm). Corpus clips are named after the manifest, e.g. "
            f"01_detache_clean.wav.",
            file=sys.stderr,
        )
        return 2

    if bpm is None:
        print("--bpm is required with --score", file=sys.stderr)
        return 2

    result = analyze(args.audio, score, target_bpm=bpm, double_bass=bass)
    if args.json:
        print(result.model_dump_json(indent=2))
    else:
        print(_render(result, args.audio, bpm, bass))
    # A take the pipeline could not use is a non-zero exit, so this is usable
    # in a script without parsing the words.
    return 0 if result.status == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())

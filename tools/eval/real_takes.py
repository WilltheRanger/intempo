#!/usr/bin/env python3
"""The accuracy benchmark's scoring, on real recordings: URMP's strings and saxophone.

    tools/eval/real_takes.py DATA
    tools/eval/real_takes.py DATA --only Rondeau --json out.json
    tools/eval/real_takes.py DATA --set onset.recovery_pitch_hold_ms=35

**The data, which is never committed.** URMP (Li, Liu, Dinesh, Duan & Sharma,
IEEE Transactions on Multimedia 21(2), 2019) is 44 short classical pieces, each
part recorded alone by a student of the Eastman School of Music, with the
score it was played from and a hand-checked list of when every note started
and at what pitch. Its 72 tracks the app has an instrument for are what this
reads: 61 violin, viola, cello and double bass, and 11 alto saxophone. YourMT3
redistributes it at 16 kHz, 683 MB unpacked:

    curl -L -o urmp.tar.gz \\
      'https://zenodo.org/records/8082232/files/urmp_yourmt3_16k.tar.gz?download=1'
    tar -xzf urmp.tar.gz -C DATA
    tools/eval/urmp_scores.py DATA          # with music21, once

**What a take is scored against.** The written notes are paired with the
labelled ones by pitch, in order (`pair_by_pitch`); the tempo the take is
analysed at is the one it was played at, read from those pairs; and the
reading is scored twice:

- by `accuracy_bench.score_result`, exactly as a synthesised take is, against
  what the app's own rules say of the labelled onsets (the *oracle*); and
- against the labels themselves (`scorecard`): was each played note heard,
  where was it put, and is its colour the oracle's.

**What the labels cannot say, and is not scored.** A labelled pitch between
0.6 and 1.4 semitones off the written one is neither in tune nor certainly
another note, so its bar is not scored for wrong notes; a written note the
labels have no note for (a double stop, an ornament, a note the annotator
left out) is not scored as played or missed. A hand label is itself good to a
few tens of milliseconds on a bowed attack, so the oracle comparison's 12 ms
note tolerance mostly measures the labels here; the scorecard's 50 ms is the
tolerance onset studies use.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

for _var in (
    "OMP_NUM_THREADS",
    "OPENBLAS_NUM_THREADS",
    "MKL_NUM_THREADS",
    "NUMBA_NUM_THREADS",
):
    os.environ.setdefault(_var, "1")
from multiprocessing import Pool
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
from backend_python import use_backend_python

use_backend_python()
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tools" / "eval"))

import accuracy_bench as ab
import librosa
import numpy as np
from app.services import analysis as an
from app.services.alignment import build_timeline, expand_repeats, read_ties
from app.services.classification import Band, classify_band
from app.services.ocr.musicxml import score_json_from_musicxml
from app.services.pitch_evidence import midi

INSTRUMENT = {
    "vn": "violin",
    "va": "viola",
    "vc": "cello",
    "db": "double_bass",
    # URMP's saxophone is an alto: see `urmp_scores.WRITTEN_ABOVE`.
    "sax": "alto_sax",
}
#: Written to sounding, in semitones: the labels are at sounding pitch.
SOUNDING = {"double_bass": -12, "alto_sax": -9}
#: A labelled pitch this close to the written one is that note, in or out of
#: tune; this far is certainly another note — `pitch_evidence`'s own
#: `_IN_TUNE_ST` and `_OTHER_NOTE_ST`.
SAME_ST = 0.6
OTHER_ST = 1.4
#: Past this a labelled note is not the written one played wrong but another
#: event (an ornament, a note the score does not have).
SUBSTITUTE_ST = 2.6
#: Fewer of the written notes than this found in the labels, and the part is
#: not the one that was recorded.
MIN_PAIRED_SHARE = 0.8


class NotScored(Exception):
    pass


def written_pitches(score) -> list[int | None]:
    """The written MIDI pitch of each note `build_timeline` expects, in its
    order: the same walk, repeats taken, ties absorbed, rests skipped."""
    played = expand_repeats(score, take_repeats=True)
    ties = read_ties(played)
    out, position = [], 0
    for measure in played:
        for note in measure.notes:
            if note.pitch != "rest" and not ties.absorbed[position]:
                out.append(midi(note.pitch))
            position += 1
    return out


def pair_by_pitch(written: list[float | None], heard: list[float]) -> list[tuple[int, int]]:
    """Written note -> labelled note, by an edit-distance alignment of the two
    pitch sequences: the same pitch pairs free, another costs a substitution,
    and what is left over is a note not played or a note not written."""
    n, m = len(written), len(heard)
    cost = np.full((n + 1, m + 1), np.inf)
    cost[0, :] = np.arange(m + 1)
    cost[:, 0] = np.arange(n + 1)
    back = np.zeros((n + 1, m + 1), dtype=np.int8)
    for i in range(1, n + 1):
        w = written[i - 1]
        for j in range(1, m + 1):
            same = w is not None and abs(w - heard[j - 1]) < SAME_ST + 0.15
            options = (
                cost[i - 1, j - 1] + (0.0 if same else 1.5),
                cost[i - 1, j] + 1.0,
                cost[i, j - 1] + 1.0,
            )
            k = int(np.argmin(options))
            cost[i, j] = options[k]
            back[i, j] = k
    pairs, i, j = [], n, m
    while i > 0 and j > 0:
        k = back[i, j]
        if k == 0:
            w = written[i - 1]
            if w is not None and abs(w - heard[j - 1]) <= SUBSTITUTE_ST:
                pairs.append((i - 1, j - 1))
            i, j = i - 1, j - 1
        elif k == 1:
            i -= 1
        else:
            j -= 1
    return pairs[::-1]


def tracks(data: Path) -> list[tuple[str, Path, Path, Path, str]]:
    """(name, audio, labels, score, instrument) for every string track."""
    out = []
    for wav in sorted((data / "urmp_yourmt3_16k").glob("*/AuSep_*.wav")):
        found = re.match(r"AuSep_(\d+)_([a-z]+)_", wav.name)
        if not found or found.group(2) not in INSTRUMENT:
            continue
        part, kind = int(found.group(1)), found.group(2)
        piece = wav.parent
        labels = next(iter(piece.glob(f"Notes_{part}_{kind}_*.txt")), None)
        xml = data / "xml" / f"{piece.name}_P{part}.musicxml"
        if labels and xml.exists():
            out.append((f"{piece.name}/{part}_{kind}", wav, labels, xml, INSTRUMENT[kind]))
    return out


def build_truth(track):
    """The take, its page, and what the labels say: which written note each
    labelled onset is, when it started, and at what pitch."""
    _name, wav, labels_txt, xml, instrument = track
    try:
        score = score_json_from_musicxml(xml.read_text())
    except Exception as exc:  # an import failure is a skip, not a crash
        raise NotScored(f"import: {exc}") from exc
    labels = np.loadtxt(labels_txt, ndmin=2)
    onsets = labels[:, 0]
    heard = librosa.hz_to_midi(labels[:, 1])
    written = written_pitches(score)
    timeline = build_timeline(score, 60.0)  # seconds are beats at 60 BPM
    if len(written) != len(timeline.notes):
        raise NotScored(f"{len(written)} pitches for {len(timeline.notes)} notes")
    shift = SOUNDING.get(instrument, 0)
    sounding = [None if w is None else w + shift for w in written]
    pairs = pair_by_pitch(sounding, list(heard))
    if len(pairs) < MIN_PAIRED_SHARE * len(written):
        raise NotScored(f"only {len(pairs)} of {len(written)} written notes in the labels")
    beats = np.array([timeline.onsets[i] for i, _ in pairs])
    seconds = np.array([onsets[j] for _, j in pairs])
    bpm = round(60.0 / float(np.polyfit(beats, seconds, 1)[0]), 1)
    by_written = dict(pairs)
    truth, unsure_bars, unsure_notes = [], set(), set()
    for i, note in enumerate(timeline.notes):
        j = by_written.get(i)
        played_midi = written[i] or 0
        if j is None:
            unsure_notes.add(note.global_index)
        elif sounding[i] is not None:
            off = abs(heard[j] - sounding[i])
            if off >= OTHER_ST:
                played_midi = round(heard[j]) - shift
            elif off >= SAME_ST:
                unsure_bars.add(note.measure_number)
        truth.append(
            ab.TruthNote(
                global_index=note.global_index,
                measure_number=note.measure_number,
                written_midi=written[i] or 0,
                played_midi=played_midi,
                beats_at=float(timeline.onsets[i]),
                played=j is not None,
                onset_s=float(onsets[j]) if j is not None else 0.0,
            )
        )
    y, sr = librosa.load(str(wav), sr=22050, mono=True)
    stats = {"bpm": bpm, "written": len(written), "labelled": len(heard), "paired": len(pairs)}
    return score, truth, bpm, (y, sr), instrument, (unsure_bars, unsure_notes), stats


def scorecard(result, placed: dict[int, float], truth, score, bpm: float) -> dict:
    """What a hand label can check that the oracle comparison cannot.

    - *heard*: a played note is in the reading, not reported missing.
    - *placed (50 ms)*: the sound it was paired with starts within 50 ms of
      the label.
    - *paired (100 ms)*: within 100 ms — paired with this note's sound at all.
    - *band*: its colour (on, a little early, ...) is the oracle's.
    - *bar tempo*: each bar's played tempo within 2% (or 1.5 BPM) of the
      oracle's — read from the notes' spacing, so no anchor can move it.
    - *verdict true*: what the sentence says holds by the labels
      (`verdict_holds`), whichever true thing it chose to say.
    """
    oracle = ab.oracle(score, truth, bpm)
    heard = {p.global_index: p for p in result.per_note}
    card: dict[str, list[int]] = {}

    def tally(key: str, ok: bool) -> None:
        card.setdefault(key, [0, 0])
        card[key][0] += int(ok)
        card[key][1] += 1

    for n in truth:
        if not n.played:
            continue
        g = n.global_index
        tally("heard", g in heard)
        if g in placed:
            error_ms = 1000.0 * abs(placed[g] - n.onset_s)
            tally("placed (50 ms)", error_ms <= 50.0)
            tally("paired (100 ms)", error_ms <= 100.0)
        mine, want = heard.get(g), oracle["deltas"].get(g)
        if mine is not None and want is not None and mine.timed and want.timed:
            tally("band", mine.band == want.band)
    for number, want in oracle["measures"].items():
        if want.played_bpm is None:
            continue
        mine = next((m for m in result.per_measure if m.measure_number == number), None)
        tally(
            "bar tempo",
            mine is not None
            and mine.played_bpm is not None
            and abs(mine.played_bpm - want.played_bpm) <= max(1.5, 0.02 * want.played_bpm),
        )
    tally("verdict true", verdict_holds(result, oracle, bpm))
    return card


_WENT_AT = re.compile(r"went at (\d+)")


def verdict_holds(result, oracle: dict, bpm: float) -> bool:
    """Whether the sentence the app said is true of the take by its labels,
    whichever true thing it chose to say.

    `verdict` asks whether the reading names the bars the labels' reading
    names. A verdict names one run, the longest, and on real playing two runs
    are often near a tie, or one bar of a run sits at a band's edge, so the
    labels' reading can name another: a different sentence, not a false one.
    This asks whether what was said holds:

    - "Bars a–b went at N.": by the labels those bars went the same way off
      their target, past the inner band, and at N within 2% (or 1.5 BPM), the
      bar-tempo card's tolerance.
    - "Bars a–b ran ahead." or "fell behind.": most of the labels' timed notes
      in those bars sit that way of the beat.
    - A sentence naming no run: the labels' reading names none either.
    """
    if result.status != "ok":
        return False
    direction = result.verdict_direction.value
    named = ab.bars_named(result.verdict)
    if direction == "on" or named is None:
        return oracle["direction"] == "on"
    first, last = named
    figure = _WENT_AT.search(result.verdict)
    if figure:
        played = oracle["tempi"].across(first, last)
        if played is None:
            return False
        target = oracle["tempi"].target(first, bpm)
        band = classify_band((1.0 - played / target) * 100.0, config=ab.config())
        return (
            band is not Band.on
            and (played > target) == (direction == "rush")
            and abs(int(figure.group(1)) - played) <= max(1.5, 0.02 * played)
        )
    notes = [
        d
        for d in oracle["deltas"].values()
        if first <= d.measure_number <= last and d.timed and not d.is_slur_interior
    ]
    agree = sum(d.direction.value == direction for d in notes)
    return bool(notes) and agree > len(notes) / 2


def run(track) -> dict:
    name = track[0]
    try:
        score, truth, bpm, audio, instrument, (unsure_bars, unsure_notes), stats = build_truth(track)
    except NotScored as exc:
        return {"name": name, "error": str(exc)}
    # Where the reading put each note, on the recording's clock: the pairing
    # `analyze` hands its wrong-note check.
    seen: dict = {}
    original = an.wrong_notes

    def listen(matched, onsets, *rest, **kw):
        seen["placed"] = {e: float(onsets[d]) for d, e in matched}
        return original(matched, onsets, *rest, **kw)

    an.wrong_notes = listen
    trace: dict = {}
    try:
        result = an.analyze(audio, score, bpm, instrument=instrument, trace=trace, config=ab.config())
    finally:
        an.wrong_notes = original
    piece, part = name.split("/")
    scored = ab.score_result(
        # `summarise` reads instrument/variant/tempo/performance/room from it.
        f"{instrument}/real/{round(bpm)}/{piece}/{part}",
        result,
        trace,
        score,
        truth,
        bpm,
        unsure_bars=unsure_bars,
        unsure_notes=unsure_notes,
    )
    row = dict(vars(scored))
    row.update(
        {
            "name": name,
            "instrument": instrument,
            **stats,
            "card": scorecard(result, seen.get("placed", {}), truth, score, bpm),
            # Both sentences, so a verdict that is not true can be read.
            "said": result.verdict,
            "labels_say": ab.oracle(score, truth, bpm)["text"],
        }
    )
    return row


def _add(into: dict[str, list[int]], card: dict[str, list[int]]) -> None:
    for key, (ok, n) in card.items():
        into.setdefault(key, [0, 0])
        into[key][0] += ok
        into[key][1] += n


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Score the analysis on URMP's string and saxophone tracks."
    )
    parser.add_argument("data", type=Path, help="where urmp_yourmt3_16k.tar.gz was unpacked")
    parser.add_argument("--only", help="only tracks whose name contains this")
    parser.add_argument("--json", type=Path, help="write every row and the summary here")
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument(
        "--set", action="append", default=[], metavar="SECTION.FIELD=VALUE",
        help="override a config value, as accuracy_bench.py --set does",
    )
    args = parser.parse_args()
    for item in args.set:
        key, _, value = item.partition("=")
        ab.OVERRIDES[key] = float(value)
    todo = [t for t in tracks(args.data) if not args.only or args.only in t[0]]
    if not todo:
        print(f"no tracks under {args.data}: see this file's docstring", file=sys.stderr)
        return 2
    # Three workers, and not beside a test run: a three-minute take holds its
    # spectrogram, its pitch track and its envelope at once, and three of
    # those beside `pytest` exhausted a 16 GB machine (2026-11-13).
    with Pool(args.workers) as pool:
        rows = pool.map(run, todo, chunksize=1)
    errors = [r for r in rows if "error" in r]
    good = [r for r in rows if "error" not in r]
    print(f"{len(todo)} tracks, {len(good)} scored, {len(errors)} not")
    for r in errors:
        print("  not scored:", r["name"], r["error"])
    summary = ab.summarise(
        [
            ab.TakeScore(
                scenario=r["scenario"], status=r["status"], counts=r["counts"],
                errors_ms=r["errors_ms"], problems=r["problems"], attacks=r["attacks"],
            )
            for r in good
        ]
    )
    print("\nagainst the oracle (the app's rules on the labelled onsets):")
    for metric in ["status", "notes", "missed", "bars", "verdict", "wrong notes"]:
        t = summary["totals"].get(metric)
        if t:
            print(f"  {metric:<16}{t['ok']:>8}{t['n']:>8}{t['pct']:>10.2f}%")
    attacks = summary["attacks"]
    print(
        f"  first pass: {attacks['heard']} of {attacks['played']} labelled notes had an attack "
        f"({100 * attacks['heard'] / max(1, attacks['played']):.2f}%), "
        f"{attacks['extra']} attacks at no labelled note"
    )
    print("\nagainst the labels:")
    total: dict[str, list[int]] = {}
    by_instrument: dict[str, dict[str, list[int]]] = {}
    for r in good:
        _add(total, r["card"])
        _add(by_instrument.setdefault(r["instrument"], {}), r["card"])
    keys = list(total)
    print(f"  {'':<14}" + "".join(f"{k:>17}" for k in keys))
    for label, card in [*sorted(by_instrument.items()), ("all", total)]:
        cells = "".join(
            f"{100 * card.get(k, [0, 0])[0] / max(1, card.get(k, [0, 1])[1]):>16.2f}%" for k in keys
        )
        print(f"  {label:<14}{cells}")
    if args.json:
        args.json.write_text(
            json.dumps({"summary": summary, "labels": total, "rows": rows}, indent=1, default=str)
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())

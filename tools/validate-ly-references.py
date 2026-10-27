#!/usr/bin/env python3
"""Check the rebuilt references against the engraving they came from (JERA-577).

A reference that disagrees with its own source is worse than no reference: it
turns every pipeline error into an unexplained mismatch, which is how JERA-564
came to report "bar count never matches" for all eight pieces. So each rebuilt
file is checked here before it is allowed to be the thing other benches trust.

The check needs a written bar count that does not come from the conversion
being checked. LilyPond bar checks supply one: Mutopia's engravers put a ``|``
at every bar line, so counting them in the source gives the written bar count
independently of how any converter times the music. For a source with N
simultaneous voices the count is N times the bar count, since every voice
carries its own bar checks -- that factor is the ``voices`` field below, and it
is read off the source's ``<< a \\\\ b >>`` structure, not guessed.

Reported, per piece: written bars from the bar checks, bars in the rebuilt
file, bars in the old MIDI-derived file, the time and key signatures the
rebuilt file declares, and the note counts of the first and last four bars.
A piece is PASS when its bar count is within ``TOLERANCE`` of the written
count and its signatures match what the catalogue says, WARN when the bars are
close but outside tolerance, and FAIL otherwise. A FAIL means the file must
stay out of baseline numbers until it is fixed.

    tools/validate-ly-references.py --data-dir /path/to/intempo-eval-data
"""

from __future__ import annotations

import argparse
import logging
import re
import xml.etree.ElementTree as ET
import sys
from pathlib import Path

log = logging.getLogger("intempo.eval.lyref")

# python-ly does not honour \partial, so a pickup bar is folded into the bar
# after it; and a source whose final bar carries no closing bar check loses one.
# Both are off-by-small and neither moves a note, so a few bars of slack is
# correct here -- a reference that is 2 bars out is still usable, one that is
# 100 bars out is a different piece.
TOLERANCE = 6

# voices = how many simultaneous voices the source writes, i.e. the factor to
# divide the bar-check count by. Read from each score.ly.
PIECES = {
    "tUKPPRN-Y00": dict(source="score_notes.ly", voices=1, time="2/4", key="E major"),
    "G01Y2DRCkYE": dict(source="score_notes.ly", voices=1, time="6/8", key="D major"),
    "cEHZC_Y3pYY": dict(source="score_notes.ly", voices=1, time="4/4", key="G major"),
    "CivvhZ0FN4c": dict(source="score.ly", voices=1, time="6/8", key="E-flat major"),
    "uALsg4aWKB0": dict(source="score.ly", voices=1, time=None, key="A minor"),
    "VuoARsko2mU": dict(source="score.ly", voices=2, time="4/4", key="D minor"),
    "LMd1ooGqD6o": dict(source="score.ly", voices=4, time="3/4", key="D minor"),
    "ogbNqfvsyM8": dict(source="score_prelude.ly", voices=1, time="4/4", key="G major"),
}


def written_bars(source: Path, voices: int) -> int:
    """Written bar count from the source's LilyPond bar checks."""
    text = source.read_text(encoding="utf-8", errors="replace")
    stripped = "\n".join(re.sub(r"%.*$", "", line) for line in text.splitlines())
    return stripped.count("|") // voices


def measures_of(xml: str) -> list[str]:
    part = re.search(r"<part\b[^>]*>(.*)</part>", xml, re.S)
    return re.findall(r"<measure\b.*?</measure>", part.group(1), re.S) if part else []


def signatures(xml: str) -> tuple[str | None, str | None]:
    """The first time signature and key as the file declares them."""
    time = re.search(r"<beats>(\d+)</beats>\s*<beat-type>(\d+)</beat-type>", xml)
    fifths = re.search(r"<fifths>(-?\d+)</fifths>", xml)
    mode = re.search(r"<mode>(\w+)</mode>", xml)
    key = None
    if fifths:
        names = {
            0: "C", 1: "G", 2: "D", 3: "A", 4: "E", 5: "B", 6: "F-sharp", 7: "C-sharp",
            -1: "F", -2: "B-flat", -3: "E-flat", -4: "A-flat", -5: "D-flat",
            -6: "G-flat", -7: "C-flat",
        }
        minors = {
            0: "A", 1: "E", 2: "B", 3: "F-sharp", 4: "C-sharp", 5: "G-sharp",
            -1: "D", -2: "G", -3: "C", -4: "F", -5: "B-flat", -6: "E-flat",
            -7: "A-flat",
        }
        n = int(fifths.group(1))
        is_minor = bool(mode) and mode.group(1) == "minor"
        tonic = (minors if is_minor else names).get(n)
        key = f"{tonic} {'minor' if is_minor else 'major'}" if tonic else None
    return (f"{time.group(1)}/{time.group(2)}" if time else None), key


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data-dir", type=Path, required=True)
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    scores = args.data_dir / "scores"
    rows, worst = [], "PASS"
    for vid, spec in PIECES.items():
        d = scores / vid
        new = d / "reference.from-ly.musicxml"
        old = d / "reference.from-midi.musicxml"
        if not old.exists():
            old = d / "reference.musicxml"
        if not new.exists():
            rows.append((vid, "-", "-", "-", "-", "-", "-", "FAIL(missing)"))
            worst = "FAIL"
            continue

        want = written_bars(d / spec["source"], spec["voices"])
        nx = new.read_text(encoding="utf-8", errors="replace")

        # **Parse before measuring.** Every other check here is a regex over the
        # text, which happily counts `<measure>` elements in a document that is
        # not well-formed XML — so this script once reported Caprice 24 as WARN
        # (153 bars against 165 written) for a file the benchmark could not open
        # at all: the splice had dropped its `<part>` opening tag. A reference
        # that no parser accepts is not a close call, it is unusable, and the
        # check that says so must be the first one.
        try:
            ET.fromstring(nx)
        except ET.ParseError as exc:
            rows.append((vid, "-", "-", "-", "-", "-", "-", f"FAIL(unparseable: {exc})"))
            worst = "FAIL"
            continue

        bars = measures_of(nx)
        old_bars = len(measures_of(old.read_text(encoding="utf-8", errors="replace"))) if old.exists() else 0
        time, key = signatures(nx)

        delta = len(bars) - want
        sig_ok = (spec["time"] is None or time == spec["time"]) and (
            spec["key"] is None or key == spec["key"]
        )
        if abs(delta) <= TOLERANCE and sig_ok:
            verdict = "PASS"
        elif abs(delta) <= TOLERANCE * 4:
            verdict = "WARN"
        else:
            verdict = "FAIL"
        if not sig_ok and verdict == "PASS":
            verdict = "WARN"
        order = {"PASS": 0, "WARN": 1, "FAIL": 2}
        if order[verdict] > order[worst]:
            worst = verdict

        head = sum(b.count("<note") for b in bars[:4])
        tail = sum(b.count("<note") for b in bars[-4:])
        rows.append(
            (vid, want, len(bars), f"{delta:+d}", old_bars, f"{time}/{key}",
             f"{head}/{tail}", verdict)
        )

    hdr = ("piece", "written", "new", "d", "old", "time/key", "notes 1st/last 4", "")
    widths = (14, 8, 5, 5, 5, 22, 18, 6)
    log.info("".join(str(h).ljust(w) for h, w in zip(hdr, widths)))
    log.info("-" * sum(widths))
    for row in rows:
        log.info("".join(str(c).ljust(w) for c, w in zip(row, widths)))
    log.info("")
    log.info("worst verdict: %s", worst)
    return 0 if worst != "FAIL" else 1


if __name__ == "__main__":
    sys.exit(main())

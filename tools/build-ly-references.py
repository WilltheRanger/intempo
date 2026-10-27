#!/usr/bin/env python3
"""Rebuild the reference MusicXML for the score-reading benchmark from LilyPond source.

JERA-568 built these references by converting Mutopia's *MIDI* renderings with
music21. MIDI carries pitch and onset only: bar lines, time and key signatures,
tuplets, ties and chord spelling are all lost, so the references disagreed with
the engraving they claim to represent (JERA-577). This script converts the
Mutopia **.ly** source instead, via python-ly's `ly musicxml`.

python-ly parses LilyPond but does not run it, which constrains the input:

* it does not resolve `\\include` against anything but the literal path, and the
  cached Mutopia files were saved under different names than the source expects
  (`score_notes.ly` vs `Caprice_1_notes.ly`), so every include is rewritten to
  an absolute path here;
* it emits one MusicXML part per `\\score` block, so a source carrying a second
  `\\score` for `\\articulate`-ed MIDI yields a duplicate part that must be
  dropped, and a source that puts each variation in its own `\\score` block
  (Caprice 24) must have them concatenated into one;
* `\\repeat volta` is left folded. That is what we want: the benchmark compares
  OCR of a printed page against this reference, so the reference must hold
  *written* bars, not unfolded ones.

Each piece therefore gets an explicit wrapper rather than being fed its own
score.ly. The wrapper is written next to the output so a disagreement can be
traced back to exactly what was converted.

Usage:
    build-ly-references.py --data-dir /path/to/intempo-eval-data [--only VIDEO_ID]

The eval data is not in this repository (see CLAUDE.md on data rights); nothing
this script reads or writes is committed.
"""

from __future__ import annotations

import argparse
import logging
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field, replace
from pathlib import Path

log = logging.getLogger("intempo.eval.lyref")


@dataclass(frozen=True)
class Piece:
    """One reference to rebuild.

    ``music`` is the LilyPond expression the wrapper scores. ``includes`` are
    resolved to absolute paths because python-ly will not search for them.
    ``expect`` is the written bar count from the catalogue/engraving, used by
    the validation step -- not by the conversion, which never consults it.
    """

    video_id: str
    piece: str
    includes: tuple[str, ...]
    music: str
    # When set, each name is converted in its own \score and the results are
    # spliced by merge_sections(); see that docstring for why.
    sections: tuple[str, ...] = ()
    # When true, the piece's own score.ly is converted as-is instead of through
    # a wrapper. Needed where the music lives in a `\context Staff << ... >>`
    # that does not survive being re-scored (the polyphonic Bach movements).
    direct: str | None = None
    expect_measures: int | None = None
    expect_time: str | None = None
    expect_key: str | None = None
    notes: str = ""
    extra: dict = field(default_factory=dict)


# Paganini Caprice 24 is a theme plus eleven variations, each in its own
# \score block in the Mutopia source. python-ly would emit only the first.
CAPRICE_24_SECTIONS = (
    "music varI varII varIII varIV varV varVI varVII varVIII "
    "varVIIII varX varXI"
).split()
CAPRICE_24_MUSIC = " ".join("\\" + name for name in CAPRICE_24_SECTIONS)

PIECES: tuple[Piece, ...] = (
    Piece(
        video_id="tUKPPRN-Y00",
        piece="Paganini Caprice Op. 1 No. 1 in E major",
        includes=("score_notes.ly",),
        music=r"\capriceOne",
        expect_time="2/4",
        expect_key="E major",
        notes="score.ly includes Caprice_1_notes.ly, cached here as score_notes.ly.",
    ),
    Piece(
        video_id="G01Y2DRCkYE",
        piece="Paganini Caprice Op. 1 No. 2 in B minor",
        includes=("score_notes.ly",),
        music=r"\capriceTwo",
        expect_time="6/8",
        expect_key="D major",
        notes="Mutopia engraves this with a D-major signature (relative major).",
    ),
    Piece(
        video_id="cEHZC_Y3pYY",
        piece="Paganini Caprice Op. 1 No. 3 in E minor",
        includes=("score_notes.ly",),
        music=r"\capriceThree",
        expect_time="4/4",
        expect_key="G major",
        notes="Sostenuto in 4/4 (G major signature) framing a 3/8 Presto in E major.",
    ),
    Piece(
        video_id="CivvhZ0FN4c",
        piece="Paganini Caprice Op. 1 No. 23 in E-flat major",
        includes=("score.ly",),
        music=r"\global \music \minore",
        direct="score.ly",
        expect_time="6/8",
        expect_key="E-flat major",
        notes=(
            "Self-contained score.ly. Its second \\score block is an "
            "\\articulate/\\unfoldRepeats MIDI rendering and is not scored here."
        ),
    ),
    Piece(
        video_id="uALsg4aWKB0",
        piece="Paganini Caprice Op. 1 No. 24 in A minor",
        includes=("score.ly",),
        music=CAPRICE_24_MUSIC,
        sections=CAPRICE_24_SECTIONS,
        expect_key="A minor",
        notes=(
            "Theme and 11 variations, one \\score block each in the source; "
            "concatenated into a single part here."
        ),
    ),
    Piece(
        video_id="VuoARsko2mU",
        piece="J.S. Bach Allemande, Partita No. 2 BWV 1004",
        includes=("score.ly",),
        music=r"\clef treble \key d \minor \time 4/4 \melody",
        direct="score.ly",
        expect_time="4/4",
        expect_key="D minor",
        notes="Two written voices (<< melodyOne \\\\ melodyTwo >>); double stops.",
    ),
    Piece(
        video_id="LMd1ooGqD6o",
        piece="J.S. Bach Ciaccona, Partita No. 2 BWV 1004",
        includes=("score.ly",),
        music=r"\clef treble \key d \minor \time 3/4 \partial 2 \melody",
        direct="score.ly",
        expect_measures=257,
        expect_time="3/4",
        expect_key="D minor",
        notes="Four written voices; heavily polyphonic (see JERA-579).",
    ),
    Piece(
        video_id="ogbNqfvsyM8",
        piece="J.S. Bach Prelude, Cello Suite No. 1 BWV 1007",
        includes=("score_prelude.ly",),
        music=r"\prelude",
        expect_time="4/4",
        expect_key="G major",
        notes=(
            "The source defines the variable only, with no \\score block, so "
            "python-ly cannot parse it unwrapped."
        ),
    ),
)

WRAPPER = """\\version "2.18.2"
%% Generated by tools/build-ly-references.py for {video_id} ({piece}).
%% Do not edit; edit the piece's entry in that script instead.
{includes}
\\score {{
  \\new Staff {{ {music} }}
  \\layout {{ }}
}}
"""


def write_wrapper(piece: Piece, piece_dir: Path, dest: Path) -> Path:
    includes = "\n".join(
        '\\include "%s"' % (piece_dir / name).resolve() for name in piece.includes
    )
    dest.write_text(
        WRAPPER.format(
            video_id=piece.video_id,
            piece=piece.piece,
            includes=includes,
            music=piece.music,
        )
    )
    return dest


def convert(wrapper: Path, out: Path) -> subprocess.CompletedProcess:
    """Run `ly musicxml`. python-ly is noisy about unimplemented markup
    commands, which only affect titling, so stderr is logged at debug."""
    proc = subprocess.run(
        [sys.executable, "-m", "ly", "musicxml", "-o", str(out), str(wrapper)],
        capture_output=True,
        text=True,
    )
    for line in proc.stderr.splitlines():
        log.debug("ly: %s", line)
    return proc


def measures_of(xml: str) -> list[str]:
    """Return the raw <measure> elements of the first part, in order."""
    part = re.search(r"<part\b[^>]*>(.*)</part>", xml, re.S)
    if not part:
        return []
    return re.findall(r"<measure\b.*?</measure>", part.group(1), re.S)


def merge_sections(sections: list[tuple[str, str]]) -> str:
    """Splice per-section conversions into one single-part MusicXML document.

    python-ly converts each of Caprice 24's sections correctly on its own but
    loses most of the music when they are concatenated inside one ``\\score``
    (158 bars section-by-section against 45 concatenated, measured 2026-10-26).
    So each section is converted alone and its measures are spliced here, with
    bar numbers made continuous across the join. Attributes stay inside the
    measures that carry them, which is what keeps each variation's own time and
    key signature rather than inheriting the theme's.
    """
    head = sections[0][1]
    out, number = [], 0
    for name, xml in sections:
        bars = measures_of(xml)
        if not bars:
            raise ValueError(f"section {name!r} converted to no measures")
        for bar in bars:
            number += 1
            out.append(
                re.sub(r'<measure\b([^>]*?)number="[^"]*"', rf'<measure\1number="{number}"', bar, count=1)
            )
    body = "\n".join(out)
    return re.sub(
        r"(<part\b[^>]*>).*(</part>)",
        lambda m: m.group(1) + "\n" + body + "\n" + m.group(2),
        head,
        flags=re.S,
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data-dir", type=Path, required=True)
    ap.add_argument("--only", action="append", default=[])
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )

    scores = args.data_dir / "scores"
    if not scores.is_dir():
        log.error("no scores/ under %s", args.data_dir)
        return 2

    failures = 0
    for piece in PIECES:
        if args.only and piece.video_id not in args.only:
            continue
        piece_dir = scores / piece.video_id
        out = piece_dir / "reference.from-ly.musicxml"

        try:
            if piece.sections:
                converted = []
                for name in piece.sections:
                    part = write_wrapper(
                        replace(piece, music="\\" + name),
                        piece_dir,
                        piece_dir / f"_wrapper.{name}.ly",
                    )
                    tmp = piece_dir / f"_section.{name}.musicxml"
                    convert(part, tmp)
                    converted.append((name, tmp.read_text(errors="replace")))
                    tmp.unlink()
                out.write_text(merge_sections(converted))
            elif piece.direct:
                # Converted in its own directory so that any relative \include
                # inside the source resolves.
                convert((piece_dir / piece.direct).resolve(), out)
            else:
                convert(write_wrapper(piece, piece_dir, piece_dir / "_wrapper.ly"), out)
        except (OSError, ValueError) as exc:
            log.error("%s: %s", piece.video_id, exc)
            failures += 1
            continue

        if not out.exists() or out.stat().st_size < 1024:
            log.error("%s: conversion produced nothing usable", piece.video_id)
            failures += 1
            continue

        # Keep the MIDI-derived file for the old-vs-new comparison.
        old = piece_dir / "reference.musicxml"
        kept = piece_dir / "reference.from-midi.musicxml"
        if old.exists() and not kept.exists():
            shutil.copy2(old, kept)

        log.info("%s: wrote %s (%d bytes)", piece.video_id, out.name, out.stat().st_size)

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

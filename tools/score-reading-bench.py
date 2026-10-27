#!/usr/bin/env python3
"""How well the real pipeline reads real violin pages, against a verified reference.

    tools/score-reading-bench.py                 # every piece with a reference
    tools/score-reading-bench.py tUKPPRN-Y00      # just that piece

Every other bench in this directory asks whether a read *adds up*
(`musicxml-bench.py`, `homr-bench.py`) or whether the pipeline's stages fire in
the right order (`pipeline-check.py`). None of them can say whether the pitches
and rhythms the pipeline wrote down are the ones actually on the page, because
none of them had a second, independently-sourced transcription of the same
piece to check against. JERA-568 built eight: Mutopia-derived `reference.musicxml`
files for Paganini Caprices and Bach solo-violin movements, sitting next to the
IMSLP-sourced `score-a4.pdf` for the same piece in
`intempo-eval-data/scores/<id>/`. This is the first bench that reads the one
and checks it against the other.

**What it does.** For each piece: render every page of `score-a4.pdf` to an
image (cached — rendering is free but homr is not), run the real `homr`
provider on each page in order, concatenate what comes back into one
transcription, and align it against the reference note-for-note with
`difflib.SequenceMatcher` — the same tool a diff uses, applied to a stream of
`(pitch, duration)` tokens instead of lines of text. That gives a pitch match
rate and a rhythm match rate that are not the same number: a note can have the
right pitch on the wrong beat, or vice versa, and this is the only bench that
tells those apart.

**What it is not.** It is not a page-image OCR benchmark in the strict sense —
`score-a4.pdf` is Mutopia's clean modern engraving (JERA-568 built the
reference *from* that same PDF, via its bundled MIDI), not the IMSLP scan or
manuscript facsimile the performance video actually shows. Every piece here is
read at its best case: a clean, unskewed, high-resolution render. Numbers below
are a ceiling on real-world accuracy, not an estimate of it — see "Known gaps"
in the results writeup for what this cannot yet measure (a real phone photo, a
real handwritten manuscript, a real double-stop passage read and not just
labelled).

Needs the same virtualenv `homr-bench.py` and `pipeline-check.py` need, plus a
PDF renderer neither of them needs because they take page images directly:

    cd backend && .venv/bin/pip install homr==0.7.0 pymupdf

homr downloads its ~140 MB of ONNX weights to its own package directory on
first use (`homr.main.download_weights`, idempotent — this script calls it so
the first run does not look hung on page 1).
"""

from __future__ import annotations

import argparse
import contextlib
import csv
import difflib
import hashlib
import io
import os
import sys
import time
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from backend_python import use_backend_python  # noqa: E402

use_backend_python()

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

# Sibling of the checkout by default. $INTEMPO_EVAL_DATA overrides it, which a
# worktree needs: the program's workspace rule puts working copies under
# intempo-wt/<agent>-<JERA-n>/, whose parent is not where the eval data lives.
EVAL_DATA = Path(
    os.environ.get("INTEMPO_EVAL_DATA") or ROOT.parent / "intempo-eval-data"
)
SCORES_DIR = EVAL_DATA / "scores"
PAGE_CACHE_DIRNAME = ".bench-pages"
READ_CACHE_DIRNAME = ".bench-reads"

# **homr writes its working files under `tempfile.gettempdir()`, which reads
# `$TMPDIR`.** In a sandbox that hands out a run-scoped `$TMPDIR` and deletes
# it the moment the run's own wall-clock budget ends — not when this process
# exits — a multi-piece pass that outlives one run loses every page read after
# that boundary to `FileNotFoundError`, with no indication it was an
# environment hiccup rather than a bad page. Measured firsthand: an 8-piece
# run here lost its last 3 pieces exactly this way. Pin somewhere this
# process's own lifetime owns, before anything imports `homr`.
_STABLE_TMP = EVAL_DATA / ".bench-tmp"
_STABLE_TMP.mkdir(parents=True, exist_ok=True)
os.environ["TMPDIR"] = str(_STABLE_TMP)

#: Below this, a run is dense passagework by this bench's own convention —
#: thirty-seconds or finer, which is where homr's duration-rounding and the
#: importer's tuplet-naming both get tested hardest (`score_schema.py`'s
#: `Duration` docstring is the long version of why).
_DENSE_DURATIONS = frozenset(
    {
        "thirty_second", "dotted_thirty_second",
        "sixty_fourth", "dotted_sixty_fourth",
        "one_twenty_eighth",
    }
)


@dataclass
class PieceResult:
    piece_id: str
    piece: str
    pages: int
    seconds: float
    bars_ocr: int
    bars_ref: int
    notes_ocr: int
    notes_ref: int
    pitch_matches: int
    rhythm_matches: int
    joint_matches: int
    aligned: int
    time_sig_ocr: str | None
    time_sig_ref: str | None
    clef_ocr: str | None
    clef_ref: str | None
    double_stops_ref: int
    dense_notes_ref: int
    grace_notes_ref: int
    cached: bool = False
    failed: str | None = None
    page_failures: list[str] = field(default_factory=list)

    @property
    def pitch_accuracy(self) -> float:
        return self.pitch_matches / self.aligned if self.aligned else 0.0

    @property
    def rhythm_accuracy(self) -> float:
        return self.rhythm_matches / self.aligned if self.aligned else 0.0

    @property
    def joint_accuracy(self) -> float:
        return self.joint_matches / self.aligned if self.aligned else 0.0

    @property
    def bar_count_ok(self) -> bool:
        return self.bars_ocr == self.bars_ref

    @property
    def time_sig_ok(self) -> bool:
        return self.time_sig_ocr == self.time_sig_ref

    @property
    def clef_ok(self) -> bool:
        return self.clef_ocr == self.clef_ref


# JERA-568 wrote reference_method=converted for the MIDI-derived files; JERA-577
# rebuilt them from LilyPond source and writes converted-from-ly. Both are real
# references, so both are read.
REFERENCE_METHODS = {"converted", "converted-from-ly"}


def _load_pieces(
    filter_ids: list[str], reference_name: str, include_unverified: bool = False
) -> list[tuple[str, str]]:
    """(piece_id, piece title) for every INDEX.csv row with a usable reference.

    A row whose ``reference_verified`` is FAIL is skipped: JERA-577 found that
    python-ly times a polyphonic source's voices sequentially, so the Ciaccona's
    rebuilt file has twice its written bar count. Benchmarking against a
    reference known to be wrong produces a number that means nothing, so it
    stays out unless ``--include-unverified`` is passed to look at it
    deliberately.
    """
    rows: list[tuple[str, str]] = []
    with (SCORES_DIR / "INDEX.csv").open(newline="") as fh:
        for row in csv.DictReader(fh):
            if row.get("reference_method") not in REFERENCE_METHODS:
                continue
            piece_id = row["video_id"]
            if filter_ids and piece_id not in filter_ids:
                continue
            if not (SCORES_DIR / piece_id / reference_name).exists():
                continue
            if row.get("reference_verified") == "FAIL" and not include_unverified:
                print(
                    f"skipping {piece_id}: reference_verified=FAIL in INDEX.csv "
                    f"(--include-unverified to read it anyway)",
                    file=sys.stderr,
                )
                continue
            rows.append((piece_id, row["piece"]))
    return rows


def _render_pages(piece_id: str) -> list[Path]:
    import pymupdf  # noqa: PLC0415 — only this function needs it

    piece_dir = SCORES_DIR / piece_id
    pdf_path = piece_dir / "score-a4.pdf"
    cache_dir = piece_dir / PAGE_CACHE_DIRNAME
    doc = pymupdf.open(pdf_path)
    cache_dir.mkdir(exist_ok=True)
    pages = []
    for i, page in enumerate(doc):
        out = cache_dir / f"page-{i:02d}.png"
        if not out.exists():
            pix = page.get_pixmap(dpi=300)
            pix.save(out)
        pages.append(out)
    doc.close()
    return pages


def _read_pages(piece_id: str, pages: list[Path]) -> tuple[list, list[str], bool]:
    """Run homr on each page in order; return (ScoreJson per page, failures, cached).

    **The read is cached next to the page render, because it does not depend on
    the reference.** JERA-577 has to score one set of pages against two
    references — the MIDI-derived file and the LilyPond-derived one — and homr
    is by far the most expensive thing here (minutes a page on CPU, against
    milliseconds for the alignment). Re-running it for the second reference
    would not just cost twice the wall clock: it would make the comparison
    *inexact*, because any non-determinism in the read would show up as a
    difference the reference rebuild gets credited or blamed for. Caching the
    read is what makes "old reference vs new reference, same pages, same
    transcription" a true statement rather than an assumption.

    The cache key is the page file's own bytes, so a re-rendered page (a new
    `score-a4.pdf`, a different DPI) misses rather than silently serving a read
    of an image that no longer exists. Delete `.bench-reads/` to force a
    re-read after changing the provider or its weights — the provider version
    is not in the key, and `homr_provider` carries no version to put there.
    """
    from app.services.ocr.homr_provider import homr_provider
    from app.services.ocr.base import OCRProviderError
    from app.services.score_schema import ScoreJson

    cache_dir = SCORES_DIR / piece_id / READ_CACHE_DIRNAME
    cache_dir.mkdir(exist_ok=True)

    scores = []
    failures = []
    all_cached = True
    for page in pages:
        raw = page.read_bytes()
        cached = cache_dir / f"{page.stem}-{hashlib.sha256(raw).hexdigest()[:16]}.json"
        if cached.exists():
            scores.append(ScoreJson.model_validate_json(cached.read_text()))
            continue
        all_cached = False
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                response = homr_provider.parse(raw, mime_type="image/png")
        except OCRProviderError as exc:
            failures.append(f"{page.name}: {str(exc)[:80]}")
            continue
        except Exception as exc:  # noqa: BLE001 — a bench reports, it does not raise
            failures.append(f"{page.name}: {type(exc).__name__}: {str(exc)[:80]}")
            continue
        cached.write_text(response.score.model_dump_json())
        scores.append(response.score)
    return scores, failures, all_cached


def _tokens(measures) -> tuple[list[str], list[str]]:
    """Flatten a measure list into parallel (pitch, duration) token streams."""
    pitches, durations = [], []
    for m in measures:
        for n in m.notes or []:
            pitches.append(n.pitch)
            durations.append(n.duration)
    return pitches, durations


def _align_count(a: list[str], b: list[str]) -> tuple[int, int]:
    """(matching tokens, total aligned length) via the longer sequence's size.

    `SequenceMatcher` gives matching blocks against *both* sequences, which is
    exactly the shape a note stream needs: a dropped or inserted note should
    not cascade into every note after it reading as "wrong", the way a
    position-by-position zip would. The denominator is the reference length —
    accuracy is "of what was actually on the page", not "of what was read".
    """
    sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    matches = sum(block.size for block in sm.get_matching_blocks())
    return matches, len(a)


def measure(piece_id: str, piece: str, reference_name: str = "reference.musicxml") -> PieceResult:
    from app.services.ocr.musicxml import score_json_from_musicxml, MusicXMLError

    ref_xml = (SCORES_DIR / piece_id / reference_name).read_text()
    try:
        ref = score_json_from_musicxml(ref_xml)
    except MusicXMLError as exc:
        return PieceResult(
            piece_id=piece_id, piece=piece, pages=0, seconds=0.0,
            bars_ocr=0, bars_ref=0, notes_ocr=0, notes_ref=0,
            pitch_matches=0, rhythm_matches=0, joint_matches=0, aligned=0,
            time_sig_ocr=None, time_sig_ref=None, clef_ocr=None, clef_ref=None,
            double_stops_ref=0, dense_notes_ref=0, grace_notes_ref=0,
            failed=f"{reference_name}: {exc}",
        )

    pages = _render_pages(piece_id)
    started = time.perf_counter()
    page_scores, page_failures, cached = _read_pages(piece_id, pages)
    elapsed = time.perf_counter() - started

    ocr_measures = [m for s in page_scores for m in s.measures]
    ref_pitches, ref_durations = _tokens(ref.measures)
    ocr_pitches, ocr_durations = _tokens(ocr_measures)

    pitch_matches, aligned = _align_count(ref_pitches, ocr_pitches)
    rhythm_matches, _ = _align_count(ref_durations, ocr_durations)
    joint_matches, _ = _align_count(
        list(zip(ref_pitches, ref_durations)), list(zip(ocr_pitches, ocr_durations))
    )

    time_sigs_ocr = Counter(s.time_signature for s in page_scores if s.time_signature)
    clefs_ocr = Counter(s.clef for s in page_scores if s.clef)

    return PieceResult(
        piece_id=piece_id,
        piece=piece,
        pages=len(pages),
        seconds=elapsed,
        cached=cached,
        bars_ocr=len(ocr_measures),
        bars_ref=len(ref.measures),
        notes_ocr=len(ocr_pitches),
        notes_ref=len(ref_pitches),
        pitch_matches=pitch_matches,
        rhythm_matches=rhythm_matches,
        joint_matches=joint_matches,
        aligned=aligned,
        time_sig_ocr=time_sigs_ocr.most_common(1)[0][0] if time_sigs_ocr else None,
        time_sig_ref=ref.time_signature,
        clef_ocr=clefs_ocr.most_common(1)[0][0] if clefs_ocr else None,
        clef_ref=ref.clef,
        double_stops_ref=sum(1 for m in ref.measures for n in m.notes if n.chord_pitches),
        dense_notes_ref=sum(
            1 for m in ref.measures for n in m.notes if n.duration in _DENSE_DURATIONS
        ),
        grace_notes_ref=sum(n.grace_notes for m in ref.measures for n in m.notes),
        page_failures=page_failures,
    )


def _warm_up_homr() -> None:
    from homr.main import download_weights

    with contextlib.redirect_stdout(sys.stderr):
        download_weights(segnet_use_gpu=False, transformer_use_gpu=False, coreml_encoder=False)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pieces", nargs="*", metavar="VIDEO_ID")
    ap.add_argument(
        "--reference-name",
        default="reference.musicxml",
        help="which reference file to read, so the same pages can be scored "
             "against the old and the rebuilt reference and compared "
             "(reference.from-midi.musicxml vs reference.from-ly.musicxml)",
    )
    ap.add_argument("--include-unverified", action="store_true")
    args = ap.parse_args(argv)

    pieces = _load_pieces(args.pieces, args.reference_name, args.include_unverified)
    if not pieces:
        print(f"no piece in intempo-eval-data/scores has a {args.reference_name} "
              "(run tools/build-ly-references.py first)", file=sys.stderr)
        return 1

    _warm_up_homr()

    results = []
    for piece_id, piece in pieces:
        print(f"reading {piece_id} ({piece})...", file=sys.stderr)
        results.append(measure(piece_id, piece, args.reference_name))

    print(
        f"\n{'piece':<14} {'bars':>10} {'notes':>10} {'pitch':>6} {'rhythm':>6} "
        f"{'joint':>6}  {'sig':>4} {'clef':>4}  pages  s"
    )
    for r in results:
        if r.failed:
            print(f"{r.piece_id:<14} FAILED: {r.failed}")
            continue
        bars = f"{r.bars_ocr}/{r.bars_ref}"
        notes = f"{r.notes_ocr}/{r.notes_ref}"
        sig = "ok" if r.time_sig_ok else "!!"
        clef = "ok" if r.clef_ok else "!!"
        print(
            f"{r.piece_id:<14} {bars:>10} {notes:>10} {r.pitch_accuracy:>6.0%} "
            f"{r.rhythm_accuracy:>6.0%} {r.joint_accuracy:>6.0%}  {sig:>4} {clef:>4}"
            f"  {r.pages:>5}  {'cache' if r.cached else format(r.seconds, '.0f')}"
        )
        for f in r.page_failures:
            print(f"{'':<14}   page failed: {f}")

    ok = [r for r in results if not r.failed]
    if ok:
        mean_pitch = sum(r.pitch_accuracy for r in ok) / len(ok)
        mean_rhythm = sum(r.rhythm_accuracy for r in ok) / len(ok)
        mean_joint = sum(r.joint_accuracy for r in ok) / len(ok)
        bars_wrong = sum(1 for r in ok if not r.bar_count_ok)
        sig_wrong = sum(1 for r in ok if not r.time_sig_ok)
        clef_wrong = sum(1 for r in ok if not r.clef_ok)
        print(
            f"\n{len(ok)} pieces read.  mean pitch {mean_pitch:.0%}  "
            f"mean rhythm {mean_rhythm:.0%}  mean joint {mean_joint:.0%}"
        )
        print(
            f"bar count wrong: {bars_wrong}/{len(ok)}   "
            f"time signature wrong: {sig_wrong}/{len(ok)}   "
            f"clef wrong: {clef_wrong}/{len(ok)}"
        )
        worst = min(ok, key=lambda r: r.joint_accuracy)
        print(f"worst piece: {worst.piece_id} ({worst.piece}) at {worst.joint_accuracy:.0%} joint")
        print(
            "\nreference-side failure-mode signals (not an OCR measurement — "
            "counts of what the page actually contains, for ranking which "
            "pieces are hardest):"
        )
        for r in ok:
            print(
                f"  {r.piece_id:<14} double-stops={r.double_stops_ref:<4} "
                f"dense(<=32nd)={r.dense_notes_ref:<5} grace/ornament={r.grace_notes_ref}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

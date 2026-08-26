#!/usr/bin/env python3
"""The real entry point on real pages, not the provider on its own.

    tools/pipeline-check.py fixtures/scores/*.jpg page.jpg

`homr-bench.py` calls `homr_provider.parse` and reports what came back.
Production calls `parse_sheet_music`, which is a different thing: it routes a
whole-page reader past the crops, applies `CONFIDENCE_THRESHOLD`, re-reads the
bars that do not add up, checks `_read_any_music`, and reports the stages a
musician watches. A change measured only by the bench has not been through any
of that.

It prints the stage sequence as well as the reading, because the sequence is a
contract with the app (`fixtures/stages/parity.json`) and running a real page
is the only way to see the order the pipeline actually produces.

Needs a virtualenv with homr in it — see EDIT_LOG 2026-08-26.
"""
import contextlib
import io
import sys
from collections import Counter
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.services.ocr import parse_sheet_music, OCRError
from app.services.ocr.pipeline import get_provider
from app.services.page_image import prepare_for_model, too_small_to_read
from app.services.ocr.validate import validate_measures

homr = [get_provider("homr")]
for arg in sys.argv[1:]:
    page = Path(arg)
    raw = page.read_bytes()
    small = too_small_to_read(raw)
    if small:
        print(f"{page.name:24} REFUSED: {small[:60]}")
        continue
    prepared, media = prepare_for_model(raw)
    stages = []
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            score = parse_sheet_music(prepared, media_type=media,
                                      providers=homr, source=raw,
                                      on_stage=stages.append)
    except OCRError as exc:
        print(f"{page.name:24} FAILED: {str(exc)[:70]}")
        continue
    v = Counter(x.verdict for x in validate_measures(score))
    pitched = sum(1 for m in score.measures for n in m.notes if n.pitch != "rest")
    print(f"{page.name:24} bars={len(score.measures):3} pitched={pitched:3} "
          f"conf={score.ocr_confidence:.2f} clef={score.clef} {dict(v)}")
    print(f"{'':24} stages: {stages}")
    # The duration mix, reported here as well as in `homr-bench.py`, so the two
    # can be compared rather than assumed to agree. They look at different
    # images: the bench reads the photograph, the pipeline reads the copy
    # `prepare_for_model` makes. Twice this session a claim measured on one has
    # turned out not to hold on the other.
    mix = Counter(n.duration for m in score.measures for n in m.notes)
    order = ("thirty_second", "sixteenth", "eighth", "quarter", "half", "whole")
    known = [f"{n}x{mix[n]}" for n in order if mix.get(n)]
    rest = [f"{k}x{v}" for k, v in mix.items() if k not in order]
    print(f"{'':24} durations: {' '.join(known + rest) or '-'}")

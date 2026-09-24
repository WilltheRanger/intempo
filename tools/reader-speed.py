#!/usr/bin/env python3
"""How long homr takes to read a page, stage by stage — cold, then warm.

    tools/reader-speed.py page.jpg [more.jpg ...]
    tools/reader-speed.py --as-homr-ships page.jpg [more.jpg ...]

**Read the first row apart from the rest.** The first page in a run pays for
the imports, the model loads and onnxruntime's first pass — what a cold Modal
container pays on every scan. Every later page is what a warm container pays,
which is why `transcribe_score` keeps one for a while after a read. Pass the
same page twice to see the difference on one page.

**`--as-homr-ships`** leaves homr to build its own title reader, the way every
page was read before `homr_provider` sized one (`_TITLE_READER_PARAMS`). Run a
page both ways: the times should differ and the `score` digest must not. If it
does, the title reader is changing what a musician is told is on their page,
and the sizing has to go.

Each page goes through `prepare_for_model` first, exactly as the worker hands
it over, then `homr_provider.parse` — so these are the reader's times on the
page the reader is actually given. The stage columns are homr's own functions,
timed from outside: `find` segments the page and finds its staves, `read` runs
the transformer over each of them, and `title` runs on a thread beside `read`,
which is why the columns add up to more than the total. homr is installed only
in the Modal container, so this needs a virtualenv with it, as `homr-bench.py`
does.

**The times are this machine's.** A container with fewer cores turns CPU into
waiting, so the `cpu` column says more about Modal than the `total` does.
"""

from __future__ import annotations

import time

_STARTED = time.perf_counter()

import contextlib  # noqa: E402
import hashlib  # noqa: E402
import io  # noqa: E402
import logging  # noqa: E402
import sys  # noqa: E402
import threading  # noqa: E402
import warnings  # noqa: E402
from collections import defaultdict  # noqa: E402
from pathlib import Path  # noqa: E402

# See `homr-bench.py`: started with the wrong interpreter this dies on
# `import pydantic`, so it re-execs under `backend/.venv`.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from backend_python import use_backend_python  # noqa: E402

use_backend_python()

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

_lock = threading.Lock()
#: Per stage, for the page being read: [calls, seconds].
_stages: dict[str, list] = defaultdict(lambda: [0, 0.0])


def _time(owner, attr: str, stage: str) -> None:
    """Wrap `owner.attr` so every call adds its wall time to `stage`."""
    original = getattr(owner, attr)

    def timed(*args, **kwargs):
        started = time.perf_counter()
        try:
            return original(*args, **kwargs)
        finally:
            with _lock:
                _stages[stage][0] += 1
                _stages[stage][1] += time.perf_counter() - started

    setattr(owner, attr, timed)


def main(argv: list[str]) -> int:
    as_shipped = "--as-homr-ships" in argv
    pages = [Path(a) for a in argv[1:] if not a.startswith("--")]
    if not pages:
        print(__doc__)
        return 2

    imports = time.perf_counter()
    # The `musicxml` package homr depends on warns about its own regexes while
    # compiling; that is noise here, and an import that fails still raises.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", SyntaxWarning)
        try:
            import homr.main
            import homr.title_detection
            import homr.transformer.staff2score
        except ImportError:
            print("homr is not installed in this virtualenv; see the docstring")
            return 2
        import app.services.ocr.homr_provider as provider
        from app.services.ocr.base import OCRProviderError
        from app.services.page_image import prepare_for_model
    imported = time.perf_counter() - imports

    # RapidOCR logs to a handler it bound to the real stderr, and resets its
    # level each time a reader is built — so it is switched off, not turned down.
    logging.getLogger("RapidOCR").disabled = True

    _time(homr.main, "detect_staffs_in_image", "find")
    _time(homr.main, "parse_staffs", "read")
    _time(homr.transformer.staff2score.Staff2Score, "predict", "staves")
    _time(homr.title_detection, "_detect_title_task", "title")

    if as_shipped:
        provider._size_the_title_reader = lambda: None

    print(
        f"imports {imported:.1f} s, before the first page"
        f" ({'homr builds its own title reader' if as_shipped else 'title reader sized here'})"
    )
    print(
        f"{'page':<28} {'run':<4} {'total':>6} {'cpu':>6} {'find':>5} {'read':>5}"
        f" {'staves':>6} {'title':>5} {'bars':>5} {'notes':>5}  score"
    )
    for number, path in enumerate(pages):
        _stages.clear()
        page, media_type = prepare_for_model(path.read_bytes())
        wall, cpu = time.perf_counter(), time.process_time()
        failed = None
        # homr narrates every staff; the table is the output here.
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(
            io.StringIO()
        ):
            try:
                score = provider.homr_provider.parse(page, mime_type=media_type).score
            except OCRProviderError as exc:
                failed = str(exc)
        total, used = time.perf_counter() - wall, time.process_time() - cpu

        run = "cold" if number == 0 else "warm"
        seconds = {name: value[1] for name, value in _stages.items()}
        stages = (
            f"{seconds.get('find', 0):>5.1f} {seconds.get('read', 0):>5.1f}"
            f" {_stages['staves'][0]:>6} {seconds.get('title', 0):>5.1f}"
        )
        if failed:
            print(f"{path.name:<28} {run:<4} {total:>6.1f} {used:>6.1f} {stages}  {failed[:60]}")
            continue
        # What the app is given, not homr's MusicXML — which carries the title,
        # and the title is allowed to differ between the two ways of reading.
        digest = hashlib.sha256(score.model_dump_json().encode()).hexdigest()[:12]
        notes = sum(len(m.notes) for m in score.measures)
        print(
            f"{path.name:<28} {run:<4} {total:>6.1f} {used:>6.1f} {stages}"
            f" {len(score.measures):>5} {notes:>5}  {digest}"
        )

    print(f"\n{time.perf_counter() - _STARTED:.1f} s in all")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

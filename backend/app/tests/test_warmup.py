"""The compile cache an image is built with is the one its container reads.

`workers/warmup.py` has the whole account. In short: the first take in every
fresh process spent two minutes compiling librosa's inner loops, because the
cache numba wrote went with the container that wrote it. The fix has three
parts, and each can break without the others noticing:

1. **the warm-up has to reach every compiled path**, or the take that needs
   the missing one compiles it anyway;
2. **what the build writes has to be what the container reads**, or every
   entry misses and the take compiles everything — silently, with the same
   verdict at the end, which is why a test has to say so;
3. **both images have to actually do it.**

(1) and (2) are one test, because they are one question — does a take in a
fresh process compile anything — asked in the only way that can answer it: a
process that plays the build, and a second, clean one that plays the
container.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from app.tests.test_corpus_regression import MANIFEST, _audio_for

BACKEND = Path(__file__).resolve().parents[2]

#: The container: warm up, note what is compiled, then analyse every corpus
#: clip whole and cut in half, and note it again.
_CONTAINER = """
import json, sys
from numba.core.dispatcher import Dispatcher

def compiled():
    found = {}
    for name, module in list(sys.modules.items()):
        if module is None or not name.startswith("librosa"):
            continue
        for attribute, value in vars(module).items():
            if isinstance(value, Dispatcher):
                found[f"{name}.{attribute}"] = sorted(str(s) for s in value.signatures)
    return found

from app.workers import warmup
warmup.warm_up()
after_warmup = compiled()

from app.services import audio as audio_svc
from app.services.analysis import analyze
from app.services.score_schema import ScoreJson

for clip, path in json.loads(sys.argv[1]):
    with open(path, "rb") as fh:
        y, sr = audio_svc.load_audio_bytes(fh.read())
    score = ScoreJson.model_validate(clip["score"])
    for take in (y, y[: y.size // 2]):
        analyze((take, sr), score, clip["target_bpm"], double_bass=clip.get("double_bass", False))

print(json.dumps({"after_warmup": after_warmup, "after_corpus": compiled()}))
"""


def _cache_files(directory: Path) -> dict[str, tuple[int, int]]:
    return {
        str(path.relative_to(directory)): (path.stat().st_size, path.stat().st_mtime_ns)
        for path in directory.rglob("*")
        if path.is_file()
    }


def test_a_fresh_process_compiles_nothing_the_build_did_not(tmp_path: Path) -> None:
    """The build, then the container, sharing nothing but the cache directory.

    Slow by the standard of this suite — the build compiles from nothing, which
    is the ~16 s this whole change is about — and deliberately so: it is the
    one test that measures the thing a musician waits for.
    """
    env = {
        **os.environ,
        "NUMBA_CACHE_DIR": str(tmp_path),
        "NUMBA_CPU_NAME": "generic",
    }

    build = subprocess.run(
        [sys.executable, "-m", "app.workers.warmup"],
        cwd=BACKEND,
        env=env,
        capture_output=True,
        text=True,
    )
    assert build.returncode == 0, build.stderr
    baked = _cache_files(tmp_path)
    assert baked, "the warm-up compiled nothing into NUMBA_CACHE_DIR"

    clips = [[clip, str(_audio_for(clip["id"]))] for clip in MANIFEST["clips"]]
    container = subprocess.run(
        [sys.executable, "-c", _CONTAINER, json.dumps(clips)],
        cwd=BACKEND,
        env=env,
        capture_output=True,
        text=True,
    )
    assert container.returncode == 0, container.stderr
    seen = json.loads(container.stdout.strip().splitlines()[-1])

    missed = {
        name: sorted(set(signatures) - set(seen["after_warmup"].get(name, [])))
        for name, signatures in seen["after_corpus"].items()
        if set(signatures) - set(seen["after_warmup"].get(name, []))
    }
    assert not missed, (
        "the corpus compiled something the warm-up did not, so a take that "
        "reaches it pays the compile in production. Add a take to "
        f"`warm_up` that goes down that path: {missed}"
    )

    written = {
        name: stat for name, stat in _cache_files(tmp_path).items() if baked.get(name) != stat
    }
    assert not written, (
        "a fresh process wrote to the cache, which numba does only when an entry "
        f"misses — so what the build baked is not what the container reads: "
        f"{len(written)} files, among them {sorted(written)[:3]}"
    )


def test_the_warm_up_takes_are_what_they_say() -> None:
    """Three takes: whole, half, and a single note. If the synthesis drifts so
    that the detector no longer hears them as that, the paths they exist to
    reach are no longer reached — and the test above would say so only as a
    missed signature, a long way from the cause."""
    from app.services import audio as audio_svc
    from app.services.analysis import prepare_for_alignment
    from app.services.audio_config import load_audio_config
    from app.services.score_schema import ScoreJson
    from app.workers import warmup

    score = ScoreJson.model_validate(warmup._SCORE)
    for notes in (warmup._NOTES, warmup._NOTES // 2, 1):
        audio = audio_svc.load_audio_bytes(warmup.synthetic_take(notes))
        heard = prepare_for_alignment(audio, score, warmup._BPM, config=load_audio_config())
        assert heard.onsets.size == notes, (notes, heard.onsets)


# ---------------------------------------------------------------------------
# Both images
# ---------------------------------------------------------------------------


def test_the_api_image_bakes_the_cache_after_it_has_the_code() -> None:
    """The API image, which is where every take runs today.

    Order matters three ways: the cache settings before the step that writes
    the cache, and the code and its config before the step that runs them —
    the warm-up reads `config.toml` like any analysis does.
    """
    lines = [line.strip() for line in (BACKEND / "Dockerfile").read_text().splitlines()]
    text = "\n".join(lines)

    assert "NUMBA_CPU_NAME=generic" in text
    assert "NUMBA_CACHE_DIR=" in text
    run = next(i for i, line in enumerate(lines) if "app.workers.warmup" in line)
    assert lines[run].startswith("RUN ")
    env = next(i for i, line in enumerate(lines) if "NUMBA_CACHE_DIR=" in line)
    code = next(i for i, line in enumerate(lines) if line.startswith("COPY app"))
    config = next(i for i, line in enumerate(lines) if line.startswith("COPY config.toml"))
    assert env < run and code < run and config < run


def test_the_modal_image_bakes_the_cache_after_it_has_the_code() -> None:
    """The same, for the container `ANALYSIS_RUNTIME=modal` hands takes to —
    where every take is a fresh process, not only the first after a deploy.

    Modal mounts `add_local_*` files when a container starts unless they are
    copied in, and a mounted file does not exist at build time. So the code
    has to be copied, and the warm-up has to come after it.
    """
    import modal_app

    source = (BACKEND / "modal_app.py").read_text()
    block = source[source.index("image = (") : source.index("transcription_image = (")]

    assert '"NUMBA_CPU_NAME": "generic"' in block
    assert '"NUMBA_CACHE_DIR":' in block
    warm = block.index("app.workers.warmup")
    assert block.index("NUMBA_CACHE_DIR") < warm
    for step in ('add_local_dir(\n        "app"', 'add_local_file("config.toml"'):
        at = block.index(step)
        assert at < warm, f"{step} comes after the warm-up"
        assert "copy=True" in block[at : block.index(")", at)], (
            f"{step} is mounted at start rather than copied, so the build cannot see it"
        )

    assert modal_app.run_analysis.spec.cpu >= 1, (
        "Modal's default is an eighth of a core, and a cold container spends it "
        "reading the cache and importing numpy before it hears a note"
    )


# ---------------------------------------------------------------------------
# The API's boot
# ---------------------------------------------------------------------------


def test_the_api_warms_up_when_takes_run_in_it(monkeypatch) -> None:
    import asyncio

    from app import main
    from app.workers import dispatch

    calls: list[str] = []
    monkeypatch.setattr(main, "sweep_stuck_analyses", lambda: None)
    monkeypatch.setattr(main, "sweep_stuck_transcriptions", lambda: None)
    monkeypatch.setattr(main.warmup, "warm_in_background", lambda: calls.append("warm"))
    monkeypatch.setattr(main.settings, "ANALYSIS_WARMUP", True)

    async def boot() -> None:
        context = main.lifespan(main.app)
        await context.__aenter__()
        await context.__aexit__(None, None, None)

    monkeypatch.setattr(dispatch, "ANALYSIS_RUNTIME", "inprocess")
    asyncio.run(boot())
    assert calls == ["warm"]

    # On Modal the API never analyses, so loading the pipeline here would be
    # memory and CPU spent on a take that runs somewhere else.
    calls.clear()
    monkeypatch.setattr(dispatch, "ANALYSIS_RUNTIME", "modal")
    asyncio.run(boot())
    assert calls == []


def test_a_failed_warm_up_is_logged_not_raised(monkeypatch, caplog) -> None:
    import threading

    from app.workers import warmup

    def broken() -> float:
        raise RuntimeError("no config")

    monkeypatch.setattr(warmup, "warm_up", broken)
    monkeypatch.setattr(warmup, "_started", False)
    before = set(threading.enumerate())

    warmup.warm_in_background()
    warmup.warm_in_background()  # once per process, however often it is asked

    started = [t for t in threading.enumerate() if t not in before]
    assert len(started) <= 1
    for thread in started:
        thread.join(timeout=5)
    assert "analysis warm-up failed" in caplog.text


def test_the_warm_up_takes_do_not_read_as_a_musician_s(caplog) -> None:
    """The one-note take is refused on purpose, and the pipeline logs a refusal
    at WARNING. At every boot, in the API's logs, that would read as somebody's
    take failing. A real take on another thread is unaffected."""
    import logging
    import threading

    from app.workers import warmup

    caplog.set_level(logging.INFO, logger="intempo.analysis")
    warmup.warm_up()
    assert not [r for r in caplog.records if r.levelno >= logging.WARNING], caplog.text

    caplog.clear()
    warmup._warming.active = True
    try:
        other = threading.Thread(
            target=lambda: logging.getLogger("intempo.analysis").warning("analysis: refused")
        )
        other.start()
        other.join()
    finally:
        warmup._warming.active = False
    assert "analysis: refused" in caplog.text

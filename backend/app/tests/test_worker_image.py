"""What the analysis worker is allowed to need.

`modal_app.py` ships `app/` **minus `routers/` and `tests/`** — deliberately,
because a container that never serves a request has no business carrying
FastAPI, and because that container is the second place the service-role key
lives, so the smaller it is the better.

The cost of that decision is a failure mode with terrible timing: an import the
worker reaches for that is not in the image fails **inside a container, on a
deploy**, long after the change that caused it looked fine. Every test here
runs green locally in that situation, because locally the file is right there.

So the constraint is enforced rather than remembered.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]


def _import_with_routers_hidden(module: str) -> subprocess.CompletedProcess:
    """Import `module` in a fresh interpreter where `app.routers` does not exist.

    A subprocess rather than a fixture: the import graph is process-wide, and
    this test suite has already imported the routers by the time it runs. Only
    a clean interpreter can answer the question honestly.
    """
    script = f"""
import sys, importlib.abc, importlib.machinery

class Absent(importlib.abc.MetaPathFinder):
    def find_spec(self, name, path=None, target=None):
        if name == "app.routers" or name.startswith("app.routers."):
            raise ModuleNotFoundError(
                f"{{name}} is not in the Modal image (see modal_app.py `ignore`)"
            )
        return None

sys.meta_path.insert(0, Absent())
import {module}
print("ok")
"""
    return subprocess.run(
        [sys.executable, "-c", script],
        cwd=BACKEND,
        capture_output=True,
        text=True,
    )


def test_the_worker_imports_without_the_routers() -> None:
    result = _import_with_routers_hidden("app.workers.analysis_runner")

    assert result.returncode == 0, (
        "the analysis worker reached for something the Modal image does not "
        f"ship, which would fail on deploy rather than here:\n{result.stderr}"
    )


def test_the_analysis_itself_imports_without_the_routers() -> None:
    """Belt and braces: `analyze()` is what Modal is really there to run, and
    it is also what the tuning CLI and the corpus regression run locally."""
    result = _import_with_routers_hidden("app.services.analysis")

    assert result.returncode == 0, result.stderr


def test_the_dispatcher_imports_without_modal_installed() -> None:
    """The API box does not have `modal` and must not need it.

    `dispatch` is imported by the router on every startup. If it imported
    `modal` at module level, an API without the package would refuse to boot —
    which is exactly the machine that has to keep working when the remote
    runtime is off.
    """
    script = """
import sys, importlib.abc

class Absent(importlib.abc.MetaPathFinder):
    def find_spec(self, name, path=None, target=None):
        if name == "modal" or name.startswith("modal."):
            raise ModuleNotFoundError("modal is not installed on the API box")
        return None

sys.meta_path.insert(0, Absent())
import app.workers.dispatch
print("ok")
"""
    result = subprocess.run(
        [sys.executable, "-c", script], cwd=BACKEND, capture_output=True, text=True
    )

    assert result.returncode == 0, result.stderr


def test_the_image_still_excludes_what_this_assumes_it_does() -> None:
    """If `modal_app.py` starts shipping the routers, these tests are guarding
    a rule that no longer exists — which is worse than not guarding, because
    they still pass."""
    source = (BACKEND / "modal_app.py").read_text()

    assert '"**/routers/**"' in source
    assert '"**/tests/**"' in source
    assert 'add_local_dir(\n        "app"' in source


def test_the_tuning_config_lands_where_the_loader_looks() -> None:
    """Two paths that have to agree, written in two files.

    `audio_config.CONFIG_PATH` is `parents[2] / "config.toml"` relative to
    `app/services/audio_config.py`. In the container that module is at
    `/root/app/services/`, so it will look at `/root/config.toml` — and the
    image has to put it exactly there. `add_local_dir("app", "/root/app")` and
    `add_local_file("config.toml", "/root/config.toml")` satisfy that, and
    nothing but this test says so.

    Getting it wrong is not subtle — the first analysis on Modal raises
    `FileNotFoundError` — but it is invisible until then, and "the deploy
    worked and the first take failed" is an expensive way to find out.
    """
    from app.services import audio_config

    module = Path(audio_config.__file__).resolve()
    assert audio_config.CONFIG_PATH == module.parents[2] / "config.toml", (
        "the loader's layout rule changed; the image has to change with it"
    )

    source = (BACKEND / "modal_app.py").read_text()
    assert 'remote_path="/root/app"' in source
    assert 'add_local_file("config.toml", remote_path="/root/config.toml")' in source


def test_a_missing_tuning_config_is_loud() -> None:
    """The alternative would be worse than a crash.

    Falling back to built-in defaults would let a container analyse with
    *different thresholds from the ones every test and the whole corpus
    regression were run against* — and say nothing. Two musicians, two
    verdicts, one recording. It raises instead.
    """
    import pytest

    from app.services.audio_config import load_audio_config_from

    with pytest.raises(OSError):
        load_audio_config_from(Path("/nowhere/at/all/config.toml"))


def _pins_in_the_image() -> dict[str, str]:
    """Every `name==version` the image installs, keyed by distribution name.

    Read out of the source rather than by importing `modal_app`, because
    importing it needs the `modal` package, which no box running these tests
    has. The image definition is a literal list of strings; a literal list of
    strings can be read.
    """
    import re

    found: dict[str, str] = {}
    for block in _pip_install_blocks():
        for name, version in re.findall(
            r'"([A-Za-z0-9._-]+)(?:\[[^\]]*\])?==([^"]+)"', block
        ):
            found[name.lower().replace("_", "-")] = version
    return found


#: Pinned in an image and deliberately absent from `uv.lock`.
#:
#: `homr` is the OMR engine, and it runs **only** on Modal: 1350 MB peak on a
#: real page against the API host's 512 MB, and 150 MB of ONNX weights. Making
#: it a backend dependency would put all of that into every developer's
#: environment and into the Render image, to be imported by nothing.
#:
#: A set rather than a blanket exemption, because the point of the check is that
#: a version nothing has run cannot reach a container by accident.
_ONLY_ON_MODAL = {"homr"}


def _pip_install_blocks() -> list[str]:
    """Every `.pip_install(...)` in the file, not the first.

    There are two images now — one for analysing a take, one for reading a page
    — and this read `split(".pip_install(", 1)` and checked the first. The
    second image was pinned entirely unchecked, which is the same failure this
    file exists to prevent, in the file that exists to prevent it.
    """
    source = (BACKEND / "modal_app.py").read_text()
    blocks = []
    for chunk in source.split(".pip_install(")[1:]:
        blocks.append(chunk.split(")", 1)[0])
    return blocks


def _locked_versions() -> dict[str, str]:
    import tomllib

    lock = tomllib.loads((BACKEND / "uv.lock").read_text())
    return {
        package["name"].lower().replace("_", "-"): package["version"]
        for package in lock["package"]
    }


def test_the_image_installs_the_versions_the_tests_were_run_against() -> None:
    """The fence this file's docstring claims, actually built.

    `modal_app.py` used to say `>=` and assert, in the comment directly above
    it, that "a version that changes an onset by a frame cannot arrive here
    without arriving in the tests too". Lower bounds do not pin anything. The
    tests, the six-clip corpus regression and Render all run what `uv.lock`
    resolved; a `>=` image resolves to whatever PyPI holds on the morning it is
    built.

    The two agreed only because the lock had not yet moved off the bounds. The
    first librosa point release would have given a musician a verdict from an
    onset detector no test in this repository had ever run — and nothing,
    anywhere, would have said so.
    """
    pins = _pins_in_the_image()
    locked = _locked_versions()

    assert pins, "the image no longer pins anything"

    wrong = {
        name: (version, locked.get(name))
        for name, version in pins.items()
        if name not in _ONLY_ON_MODAL and locked.get(name) != version
    }
    assert not wrong, (
        "modal_app.py pins versions the lock does not hold, so the container "
        "would analyse with something no test has run: "
        + ", ".join(
            f"{name} pinned {pinned}, locked {held or 'absent'}"
            for name, (pinned, held) in sorted(wrong.items())
        )
    )


def test_everything_the_arithmetic_runs_through_is_pinned() -> None:
    """Not just the direct dependencies.

    `soxr` resamples every take to 22.05 kHz, `soundfile` decodes it and
    `numba` compiles the paths that find the onsets — none of them named in
    `pyproject.toml`, all of them able to move a note. Pinning librosa while
    letting its resampler float would be a fence with the gate open.
    """
    pins = _pins_in_the_image()

    for name in ("librosa", "numpy", "scipy", "numba", "soundfile", "soxr"):
        assert name in pins, f"{name} can change an onset time and is not pinned"


def test_both_images_are_checked_not_just_the_first() -> None:
    """There are two images, and this file used to read one.

    `_pins_in_the_image` split on the first `.pip_install(` and stopped, so the
    page-reading container could pin anything at all and nothing would say so —
    the same failure this file was written to prevent, in the file that prevents
    it. Named as a test rather than left to the others to imply, because a third
    image would slip past an implication.
    """
    blocks = _pip_install_blocks()
    assert len(blocks) >= 2, "an image lost its pins, or this stopped finding them"

    pins = _pins_in_the_image()
    # One from each: librosa only exists in the analysis image, homr only in the
    # transcription one.
    assert "librosa" in pins
    assert "homr" in pins


def test_the_engine_that_only_runs_on_modal_is_still_pinned() -> None:
    """`homr` is exempt from `uv.lock` and not from pinning.

    It is the one thing here whose version can change what a musician is told is
    on their page, and it is installed by a container nobody watches build.
    """
    assert _pins_in_the_image()["homr"], "homr is not pinned"
    for name in _ONLY_ON_MODAL:
        assert name in _pins_in_the_image(), f"{name} is exempt but no longer pinned"
        assert name not in _locked_versions(), (
            f"{name} is in uv.lock now, so it should be checked against it "
            "rather than exempted"
        )


def test_nothing_is_installed_by_a_lower_bound() -> None:
    """A single `>=` in the list is the whole hole back, in either image."""
    block = "".join(_pip_install_blocks())

    assert ">=" not in block, (
        "a lower bound in the image resolves to whatever PyPI has that day; "
        "pin it to the version in uv.lock instead"
    )


# ---------------------------------------------------------------------------
# The *other* image
#
# Everything above is about the Modal container. `backend/Dockerfile` builds
# the API — the image that has been in production since Batch 1 — and it had no
# test at all, which is how it went to Render without `config.toml` in it.
#
# The failure was silent in the worst way. The API booted, passed its health
# check, signed people in and read photographed pages; the tuning config is
# read lazily, inside the pipeline, so nothing touched it until a musician
# finished playing. Then `FileNotFoundError`, caught by the runner's catch-all,
# and `internal_error` on the verdict screen. Every take. Calibration too.
#
# A test asserting exactly this placement existed for the container that has
# never run a real analysis, and nothing for the one serving requests.
# ---------------------------------------------------------------------------


def _image_layout(dockerfile: str) -> dict[str, str]:
    """Absolute path inside the image -> the source it was copied from.

    Reads the `COPY` instructions rather than matching a string, so a change to
    `WORKDIR`, or to where `app/` lands, is followed rather than missed. Only
    the forms this Dockerfile uses are handled; anything else would be a change
    worth noticing here anyway.
    """
    import posixpath

    workdir = "/"
    placed: dict[str, str] = {}
    for raw in dockerfile.splitlines():
        line = raw.strip()
        if line.startswith("WORKDIR "):
            workdir = line.split(None, 1)[1].strip()
        elif line.startswith("COPY ") and "--from=" not in line:
            *sources, destination = line.split()[1:]
            for source in sources:
                # `uv.lock*` is a glob for an optional file; the name is the
                # part before the star.
                name = posixpath.basename(source.rstrip("*"))
                if destination.endswith("/") or len(sources) > 1:
                    target = posixpath.join(workdir, destination, name)
                else:
                    target = posixpath.join(workdir, destination)
                placed[posixpath.normpath(target)] = source
    return placed


def test_the_api_image_carries_the_tuning_config() -> None:
    """Derived from where the loader actually looks, not from a literal path.

    `CONFIG_PATH` is `parents[2]` of `app/services/audio_config.py`. Wherever
    the Dockerfile puts `app/`, the config has to sit two levels above the
    services directory — so this computes the answer from the image's own
    layout and the loader's own rule, and fails if either moves without the
    other.
    """
    import posixpath

    from app.services import audio_config

    dockerfile = (BACKEND / "Dockerfile").read_text()
    placed = _image_layout(dockerfile)

    app_root = next(
        (path for path, source in placed.items() if source.rstrip("/") == "app"),
        None,
    )
    assert app_root, "the Dockerfile no longer copies app/; this test is guessing"

    # `<app_root>/services/audio_config.py`.parents[2] — the same arithmetic
    # the loader does, spelled in the image's paths.
    levels_up = (
        Path(audio_config.__file__).resolve().parents[2],
        Path(audio_config.__file__).resolve(),
    )
    depth = len(levels_up[1].parts) - len(levels_up[0].parts)
    module_in_image = posixpath.join(app_root, "services", "audio_config.py")
    expected = posixpath.normpath(
        posixpath.join(module_in_image, *([".."] * depth), "config.toml")
    )

    assert expected in placed, (
        f"the loader will read {expected} in this image and nothing copies a "
        "config.toml there. The API boots, passes its health check and fails "
        f"every analysis with internal_error. Copied paths: {sorted(placed)}"
    )


def test_neither_image_ships_without_a_config() -> None:
    """One loader, one rule, two images.

    The placement is checked properly above and in
    `test_the_tuning_config_lands_where_the_loader_looks`. This is the blunter
    question those two cannot ask together: does each image carry a config at
    all. They have only ever disagreed by omission — the Modal one was written
    with this in mind, the API one was not — and omission is what this catches.
    """
    dockerfile_sources = set(_image_layout((BACKEND / "Dockerfile").read_text()).values())
    modal_source = (BACKEND / "modal_app.py").read_text()

    assert "config.toml" in dockerfile_sources, (
        f"the API image copies {sorted(dockerfile_sources)} and no config.toml"
    )
    assert 'add_local_file("config.toml"' in modal_source, (
        "the Modal image does not add config.toml at all"
    )


# ---------------------------------------------------------------------------
# Every file the running app reads, in both images
#
# The `config.toml` omission was found by reading one Dockerfile carefully.
# That does not scale and did not work the first time. What follows finds the
# files automatically: any module-level `Path` constant that points at a
# checked-in file is something the app opens at runtime, and anything the app
# opens at runtime has to be in the image or it is a crash waiting for the
# first person who triggers that code path.
#
# Today that is `config.toml` and the OCR prompt. The point is the next one.
# ---------------------------------------------------------------------------


def _modules_that_resolve_paths() -> list[str]:
    """Dotted names of modules under `app/` that build a path from `__file__`."""
    import re

    names = []
    for path in sorted((BACKEND / "app").rglob("*.py")):
        if "tests" in path.parts:
            continue
        if re.search(r"Path\(__file__\)", path.read_text()):
            relative = path.relative_to(BACKEND).with_suffix("")
            names.append(".".join(relative.parts))
    return names


def _runtime_data_files() -> dict[str, str]:
    """Repo-relative path of each checked-in file the app opens -> who reads it.

    Discovered, not listed. A constant that points at a file which exists in
    the checkout is a file the running process expects to find; one that points
    at a path which does not exist is an output or a test hook and is not this
    test's business.
    """
    import importlib

    found: dict[str, str] = {}
    for name in _modules_that_resolve_paths():
        module = importlib.import_module(name)
        for attribute, value in vars(module).items():
            if not isinstance(value, Path) or not value.is_file():
                continue
            try:
                relative = value.resolve().relative_to(BACKEND)
            except ValueError:
                continue  # outside the build context; not shipped from here
            found[relative.as_posix()] = f"{name}.{attribute}"
    return found


def test_the_api_image_carries_every_file_the_app_opens() -> None:
    """`COPY app ./app` covers anything under `app/`. Anything outside it needs
    a line of its own, and `config.toml` did not have one — which is how the
    API went to production unable to analyse a single take."""
    layout = _image_layout((BACKEND / "Dockerfile").read_text())
    copied = {source.rstrip("/") for source in layout.values()}

    files = _runtime_data_files()
    assert files, "no runtime data files found; the discovery above has broken"

    for relative, reader in sorted(files.items()):
        covered = any(
            relative == source or relative.startswith(f"{source}/") for source in copied
        )
        assert covered, (
            f"{reader} opens {relative} at runtime and the API image does not "
            f"copy it. The container starts, and the first request that reaches "
            f"that code path fails. Copied: {sorted(copied)}"
        )


def test_the_modal_image_carries_every_file_the_worker_opens() -> None:
    """The same question of the other image.

    Narrower on purpose — the Modal image ships `app/` *minus* the routers, so
    a data file living under `app/routers/` would be copied into the API and
    silently dropped here. Nothing does today. The check is what makes that
    still true tomorrow.
    """
    source = (BACKEND / "modal_app.py").read_text()

    for relative, reader in sorted(_runtime_data_files().items()):
        if relative.startswith("app/routers/"):
            raise AssertionError(
                f"{reader} opens {relative}, which the Modal image ignores — "
                "the worker would crash on it"
            )
        if relative.startswith("app/"):
            continue  # covered by add_local_dir("app", ...)
        assert f'add_local_file("{relative}"' in source, (
            f"{reader} opens {relative} at runtime and the Modal image does "
            "not add it"
        )


def test_the_modal_app_is_valid_for_the_installed_client() -> None:
    """Build the image spec for real, against the real `modal` package.

    Everything else in this file reads `modal_app.py` as text, because for most
    of its life no box running these tests had `modal` on it. That changed when
    the API gained it as a dependency — the dispatcher imports it to spawn — so
    the definition can now be *executed* rather than pattern-matched, and a
    deploy that would fail on somebody clicking "Run workflow" fails here
    instead.

    **What this catches**: a parameter modal has renamed or removed. That is
    the realistic failure and it has a precedent in this very file — `keep_warm`
    became `min_containers`, and a checkout written against the old name raises
    `DeprecationError` the moment the decorator runs. Verified by mutation:
    `min_containers` → `keep_warm` and `ignore=` → `exclude=` both fail here.

    **What it does not catch**: wrong *values*. `memory="two gigs"`,
    `timeout="ten minutes"` and `Secret.from_name(None)` all import happily —
    modal validates those server-side at deploy. Also verified, and stated so
    nobody reads this test as more than it is.

    No network: `App`, `Image` and `Secret.from_name` are all local until
    something is actually run.
    """
    import modal_app

    assert modal_app.app.name == modal_app.APP_NAME
    assert "run_analysis" in modal_app.app.registered_functions, (
        "the dispatcher looks this function up by name; if it is not registered "
        "here, analyses are enqueued and never run"
    )


def test_the_engraver_coverage_tool_still_runs() -> None:
    """The measurement behind the engraver decision, kept runnable.

    `tools/engraver-coverage.py` answers "how much of a real page can the app
    put on a stave", and its answer is the reason the engraver's range is a
    known limitation rather than an assumption. A tool that stops working is a
    measurement that quietly becomes a memory.
    """
    import subprocess
    import sys

    result = subprocess.run(
        [sys.executable, str(BACKEND.parent / "tools" / "engraver-coverage.py")],
        capture_output=True,
        text=True,
        cwd=BACKEND.parent,
    )

    assert result.returncode == 0, result.stderr
    assert "no glyph" in result.stdout
    assert "worst page" in result.stdout, (
        "the tool stopped reporting the worst page, which is the number that "
        "matters — the average hid this problem until a musician found it"
    )

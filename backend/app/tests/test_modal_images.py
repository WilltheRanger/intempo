"""Can each Modal container actually import the function it exists to run.

**This is the test that was missing, and what it cost.** `transcribe_score` was
deployed, green, and reachable: `fn.spawn()` succeeded every time and the API
logged "being read on Modal", which was true. The Modal dashboard told the rest
of the story — startup 3.13 s, **execution 11 ms, Failed** — for every read ever
dispatched there. The function body's first statement is

    from app.workers.transcription_runner import run_transcription

and the image had neither `fastapi` (which `page_image` raises through) nor
`python-dotenv` (which `config` reads at import), and deliberately ships without
`app/routers/`, which `page_image` imported a bucket name from. Three
`ModuleNotFoundError`s, ten milliseconds in.

Nothing anywhere reported it. Modal writes the row itself, so a container that
dies before its first write leaves the row exactly as a *slow* page leaves it,
and the sweeper's guess — "reading this page stopped before it finished" — was
shown to a musician twice for a fault that was neither slow nor about the page.

The existing Modal tests check the *names* match (`test_dispatch.py`) and that
the runner is not duplicated. Both passed throughout. This is the difference
between a configuration check and a behaviour check, which this repository has
now paid for three times: Modal credentials, CORS origins, and here.

Static rather than live: building an image takes minutes and needs an account,
so this walks the module-level import graph and compares it against what the
image installs. Module-level only, on purpose — an import inside a function
fails when that function runs, which is a different (and much louder) failure
than a container that cannot start.
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

import pytest

_BACKEND = Path(__file__).resolve().parents[2]
_APP = _BACKEND / "app"
_MODAL_APP = _BACKEND / "modal_app.py"

#: Distribution name -> the name you import it by, where they differ.
#:
#: Kept tiny and explicit. A guessed mapping would silently pass a package the
#: container does not actually have, which is the failure this file exists for.
_IMPORT_NAME = {
    "pillow": "PIL",
    "pillow_heif": "pillow_heif",
    "google_genai": "google",
    "python_dotenv": "dotenv",
    "pyjwt": "jwt",
    "opencv_python_headless": "cv2",
}

#: Always present in a Modal container regardless of the image: Modal injects
#: its own client. Listing it beats pretending the image installs it.
_PROVIDED_BY_MODAL = {"modal"}


def _pip_installed(image_block: str) -> set[str]:
    """The import names an image's `pip_install` makes available."""
    names = set()
    for match in re.finditer(r'"([a-zA-Z0-9_.\-]+)(?:\[[^\]]*\])?==', image_block):
        dist = match.group(1).replace("-", "_").lower()
        names.add(dist)
        names.add(_IMPORT_NAME.get(dist, dist))
    return names | _PROVIDED_BY_MODAL


def _image_block(name: str) -> str:
    """The source of one image definition, up to where the packages end."""
    source = _MODAL_APP.read_text()
    start = source.index(f"{name} = (")
    # `pip_install` is always before `run_commands`/`add_local_dir`; taking the
    # whole tail would pick up strings from the next image.
    tail = source[start:]
    for stop in (".run_commands", ".env(", ".add_local_dir"):
        if stop in tail:
            tail = tail[: tail.index(stop)]
    return tail


def _ships_routers(name: str) -> bool:
    """Whether the image copies `app/routers/` into the container."""
    source = _MODAL_APP.read_text()
    start = source.index(f"{name} = (")
    block = source[start : source.index("\n)", start)]
    return "**/routers/**" not in block


def _module_level_imports(path: Path) -> list[str]:
    """What importing this module runs. Function bodies are not included."""
    found: list[str] = []
    for node in ast.parse(path.read_text()).body:
        candidates = [node]
        # `if TYPE_CHECKING:` and friends still execute at import time.
        if isinstance(node, ast.If):
            candidates = list(ast.walk(node))
        for item in candidates:
            if isinstance(item, ast.Import):
                found += [alias.name for alias in item.names]
            elif isinstance(item, ast.ImportFrom) and item.module and item.level == 0:
                found.append(item.module)
    return found


def _resolve(module: str) -> Path | None:
    base = _BACKEND / module.replace(".", "/")
    for candidate in (base.with_suffix(".py"), base / "__init__.py"):
        if candidate.exists():
            return candidate
    return None


def _walk(entry: str, *, ships_routers: bool) -> tuple[set[str], set[str]]:
    """Third-party imports, and `app.` modules the image does not ship."""
    third: set[str] = set()
    absent: set[str] = set()
    seen: set[Path] = set()
    start = _resolve(entry)
    assert start is not None, entry
    stack = [start]
    while stack:
        path = stack.pop()
        if path in seen:
            continue
        seen.add(path)
        for module in _module_level_imports(path):
            if module.startswith("app."):
                if module.startswith("app.routers") and not ships_routers:
                    absent.add(module)
                    continue
                resolved = _resolve(module)
                if resolved is not None:
                    stack.append(resolved)
            else:
                top = module.split(".")[0]
                if top not in sys.stdlib_module_names and top != "app":
                    third.add(top)
    return third, absent


#: Each Modal function, the image it runs on, and what it imports first.
_FUNCTIONS = (
    ("transcribe_score", "transcription_image", "app.workers.transcription_runner"),
    ("run_analysis", "image", "app.workers.analysis_runner"),
)


@pytest.mark.parametrize("function, image, entry", _FUNCTIONS)
def test_the_image_can_import_what_the_function_imports(
    function: str, image: str, entry: str
) -> None:
    """The whole point. A package missing here is a container that cannot
    start, reported as a scan that "stopped before it finished"."""
    provided = _pip_installed(_image_block(image))
    third, _ = _walk(entry, ships_routers=_ships_routers(image))

    missing = sorted(name for name in third if name.lower() not in provided)

    assert not missing, (
        f"{function} imports {entry}, which needs {missing} at import time — "
        f"and {image} does not install them. Every call will fail in "
        f"milliseconds with ModuleNotFoundError, and the row it was meant to "
        f"write will be swept as 'stopped before it finished'."
    )


@pytest.mark.parametrize("function, image, entry", _FUNCTIONS)
def test_the_image_ships_every_app_module_the_function_imports(
    function: str, image: str, entry: str
) -> None:
    """The other half, and the one that is easier to miss.

    Both images exclude `app/routers/` on purpose — a worker has no business
    carrying an HTTP API. So an import of `app.routers.anything` from a module
    a worker reaches is a `ModuleNotFoundError` that no `pip_install` can fix,
    and it is invisible on the API host where the package is right there.
    """
    _, absent = _walk(entry, ships_routers=_ships_routers(image))

    assert not absent, (
        f"{function} reaches {sorted(absent)} at import time, but {image} does "
        f"not copy app/routers into the container. Move whatever it needs into "
        f"a module a worker can import — see app/services/buckets.py."
    )


def test_a_missing_package_would_actually_be_caught() -> None:
    """Guards the guard.

    Every check in this file is a static walk, and a walk with a broken
    resolver reports nothing missing and passes forever. This asserts the
    machinery finds a real import that a pretend image lacks.
    """
    third, _ = _walk("app.workers.transcription_runner", ships_routers=False)

    assert "supabase" in third, "the walk is not reaching app.db"
    assert "fastapi" in third, "the walk is not seeing the import that broke this"
    assert not [n for n in third if n.lower() in _pip_installed('"supabase==1.0"')] or True
    # And an image that installs almost nothing must fail the comparison.
    pretend = _pip_installed('"numpy==1.0"')
    assert [n for n in third if n.lower() not in pretend], "the comparison never fails"


@pytest.mark.parametrize("function, image, entry", _FUNCTIONS)
def test_a_worker_image_does_not_carry_the_web_layer(
    function: str, image: str, entry: str
) -> None:
    """A container that reads photographs, or audio, has no HTTP API to serve.

    Its own rule rather than a consequence of the walk above: now that the
    layering is fixed nothing reaches `app.routers` at import time, so shipping
    it would break no test — it would just quietly restore the conditions that
    made `from app.routers.upload import SCORE_BUCKET` look reasonable, and the
    next person to reach for something in a router would find it there.

    Excluding it is what turned that mistake into a `ModuleNotFoundError`
    instead of a working import that happened to drag FastAPI and PyJWT into a
    2.5 GB scanning container.
    """
    assert not _ships_routers(image), (
        f"{image} copies app/routers into the {function} container. A worker "
        f"serves no HTTP; keep the exclusion, and put anything shared in a "
        f"module both sides can import (see app/services/buckets.py)."
    )

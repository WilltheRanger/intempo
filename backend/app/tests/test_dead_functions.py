"""A module-level function nothing anywhere calls.

This is `tools/check-dead-exports.py`'s half of the tree. Built, documented and
never wired up is this project's most-repeated defect, and it is invisible by
construction: the code compiles, the tests pass, it reads as finished work, and
the only symptom is a check that never runs or a feature that quietly does not
exist. `test_client_reachability.py` holds the *routes*; this holds everything
else the package defines at module level.

It found three the day it was written:

* `_fit_line` in `alignment.py`, whose docstring said *"One home for the fit,
  because two callers need exactly the same line"* — it had none, and the
  surviving inline fit in `_residuals` computes something different, so the
  sentence was false twice over. Deleted.
* `_residual_cost` beside it, a mean with no caller. Deleted.
* `repeat_balance` in `ocr/validate.py`, a real check on repeat brackets that
  nothing runs. Kept, and `test_ocr_validate.py` now measures which of its
  three rules are sound on a page and which is not.

**There is no allowlist, deliberately** — an exclusion list is the thing that
rots. A function that must stay unwired escapes this by having a test that
*names it and says why*, which is what `pickup_complement` has had all along
and what `repeat_balance` has now. That is a better artefact than a line in a
list, because it is a claim someone can check.

What it cannot see, stated plainly: a name common enough to appear in an
unrelated docstring is matched by that prose and passes. Its failures are false
*negatives*, which is the direction a check must fail in if people are going to
keep running it.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
REPO = APP.parents[1]

#: Also searched for *references*, never for definitions: the repository's
#: benches import from `app`, and missing one would be the single kind of false
#: alarm this check must not produce.
ALSO_REFERENCED_BY = (REPO / "tools",)

#: Decorators that mean "a framework calls this, never a name in this repo".
#:
#: Matched on the attribute or plain name, so `@router.get(...)`,
#: `@app.exception_handler(...)`, `@stub.function()` and `@pytest.fixture` are
#: all covered without listing the object each hangs off.
_FRAMEWORK_CALLED = frozenset(
    {
        "get",
        "post",
        "put",
        "patch",
        "delete",
        "head",
        "options",
        "websocket",
        "on_event",
        "middleware",
        "exception_handler",
        "function",
        "local_entrypoint",
        "fixture",
        "hookimpl",
        "validator",
        "field_validator",
        "model_validator",
    }
)

#: A floor, so a broken glob reports a tidy package instead of nothing.
_MIN_FUNCTIONS = 150


def _decorator_names(node: ast.FunctionDef | ast.AsyncFunctionDef) -> set[str]:
    names: set[str] = set()
    for decorator in node.decorator_list:
        target = decorator.func if isinstance(decorator, ast.Call) else decorator
        if isinstance(target, ast.Attribute):
            names.add(target.attr)
        elif isinstance(target, ast.Name):
            names.add(target.id)
    return names


def _python_files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*.py") if "__pycache__" not in p.parts)


def test_every_function_this_package_defines_is_referenced_somewhere() -> None:
    defining = [p for p in _python_files(APP) if "tests" not in p.parts]
    corpus = _python_files(APP) + [
        p for root in ALSO_REFERENCED_BY if root.is_dir() for p in _python_files(root)
    ]
    text = {p: p.read_text(encoding="utf-8") for p in corpus}

    defined: dict[str, Path] = {}
    for path in defining:
        for node in ast.parse(text[path]).body:
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if _decorator_names(node) & _FRAMEWORK_CALLED:
                continue
            # A name defined twice is a name with a caller somewhere by
            # construction; the interesting case is the single definition.
            defined[node.name] = path if node.name not in defined else defined[node.name]

    assert len(defined) >= _MIN_FUNCTIONS, (
        f"only {len(defined)} module-level functions found under {APP} — the "
        "scan is looking in the wrong place, not at a tidy package"
    )

    dead: list[str] = []
    for name, path in sorted(defined.items()):
        word = re.compile(r"\b" + re.escape(name) + r"\b")
        # Every occurrence in the corpus, less the one in the `def` itself.
        hits = sum(len(word.findall(body)) for body in text.values()) - 1
        if hits == 0:
            dead.append(f"{name} ({path.relative_to(REPO)})")

    assert not dead, (
        "these are defined and referenced nowhere at all:\n  "
        + "\n  ".join(dead)
        + "\n\nEach is either something that was never wired up — which is what "
        "this test is for — or something that should not exist. Wire it, delete "
        "it, or write a test that names it and says why it stays unwired, the "
        "way `pickup_complement` and `repeat_balance` are handled. There is no "
        "allowlist."
    )

#!/usr/bin/env python3
"""Every URL this service fetches, and what stands between it and an SSRF.

    tools/check-outbound-fetch.py

**Two functions fetched a URL and only one of them was safe.** `download_image`
grew a final-origin check and a streaming size limit after a review;
`download_audio` — its twin, doing the same job for recordings — got neither,
and its caller validated a URL's *path* while never checking the host. Measured
on 2026-09-09: any signed-in account could make the API GET
`http://169.254.169.254/`, and the upstream status came back in the error body.
See `EDIT_LOG.md` and `DECISIONS.md` for that day.

Nothing was wrong with either function's *reasoning*. The image path's docstring
is explicit about why redirects must be bounded. The failure was **drift**: one
path learned a lesson and the other never heard about it, and no test could see
the difference because the audio path's tests stub the HTTP client and therefore
assert how it is *constructed* rather than where it can end up.

So this is an inventory, in the shape `check-brand-assets.py` uses. It does not
try to prove a fetch is safe — a static check cannot. It fails when the set of
places this service reaches the network **changes**, so that adding a third one
is a decision somebody makes on purpose rather than by copying the wrong twin.

Two ways to fail it, and both are the point:

- **A fetch site appeared that is not listed below.** Add it, and while you are
  writing the entry, answer the question the entry asks: can a caller influence
  the URL? If yes, `expected_origin` is not optional.
- **A site listed as caller-influenced stopped passing `expected_origin`.**
  That is the protection being removed, which is how it was missing in the first
  place.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend" / "app"

#: The constructors and helpers that open an outbound connection.
FETCH_CALLS = {
    ("httpx", "Client"),
    ("httpx", "AsyncClient"),
    ("httpx", "get"),
    ("httpx", "post"),
    ("httpx", "stream"),
    ("requests", "get"),
    ("requests", "post"),
    ("urllib.request", "urlopen"),
}

#: Every place this service fetches a URL.
#:
#: `caller_influenced` is the only field that matters for safety: True means some
#: part of the URL came from a request body, a stored row a request wrote, or
#: anything else a stranger can steer. Those sites must hand the fetch an
#: `expected_origin`, because validating the URL says nothing about where a
#: redirect can take it.
KNOWN: dict[tuple[str, str], dict] = {
    ("services/page_image.py", "download_image"): {
        "caller_influenced": True,
        "why": (
            "A score page, from `source_image_urls` on a row the caller wrote. "
            "Re-signed from the object key before the GET, so the key is the "
            "trustworthy part and the URL around it is not."
        ),
    },
    ("workers/analysis_runner.py", "download_audio"): {
        "caller_influenced": True,
        "why": (
            "A recording. `POST /v1/calibration` passes a URL straight from the "
            "request body — this is the site the 2026-09-09 SSRF was on — and "
            "the analysis worker passes one it signed itself."
        ),
    },
}

#: `expected_origin` is the parameter that carries the answer. A site marked
#: caller-influenced has to mention it; that is a weak check on purpose, since
#: proving it is *used* correctly is what the tests are for.
ORIGIN_PARAM = "expected_origin"


def _dotted(node: ast.AST) -> str | None:
    """`httpx.Client` from the call's func node, or None if it is not a name."""
    if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
        return f"{node.value.id}.{node.attr}"
    if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Attribute):
        inner = _dotted(node.value)
        return f"{inner}.{node.attr}" if inner else None
    return None


def _enclosing_functions(tree: ast.Module) -> list[ast.FunctionDef | ast.AsyncFunctionDef]:
    out: list = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            out.append(node)
    return out


def main() -> int:
    problems: list[str] = []
    found: dict[tuple[str, str], list[int]] = {}

    for path in sorted(BACKEND.rglob("*.py")):
        if "/tests/" in path.as_posix():
            continue
        rel = path.relative_to(BACKEND).as_posix()
        try:
            tree = ast.parse(path.read_text())
        except SyntaxError as exc:  # a file that will not parse is a bigger problem
            problems.append(f"{rel}: could not parse ({exc})")
            continue

        functions = _enclosing_functions(tree)
        for call in (n for n in ast.walk(tree) if isinstance(n, ast.Call)):
            dotted = _dotted(call.func)
            if dotted is None:
                continue
            module, _, attr = dotted.rpartition(".")
            if (module, attr) not in FETCH_CALLS:
                continue
            # The innermost function whose body spans this call.
            owner = None
            for fn in functions:
                if fn.lineno <= call.lineno <= (fn.end_lineno or fn.lineno):
                    if owner is None or fn.lineno > owner.lineno:
                        owner = fn
            name = owner.name if owner else "<module level>"
            found.setdefault((rel, name), []).append(call.lineno)

    for key, lines in sorted(found.items()):
        rel, name = key
        entry = KNOWN.get(key)
        if entry is None:
            problems.append(
                f"{rel}:{lines[0]} — `{name}` fetches a URL and is not in KNOWN.\n"
                f"      Add it, and answer the question the entry asks: can a "
                f"caller influence the URL? If so it must pass `{ORIGIN_PARAM}`."
            )
            continue
        if entry["caller_influenced"]:
            source = ast.get_source_segment(
                (BACKEND / rel).read_text(),
                next(
                    fn
                    for fn in _enclosing_functions(ast.parse((BACKEND / rel).read_text()))
                    if fn.name == name
                ),
            )
            if source and ORIGIN_PARAM not in source:
                problems.append(
                    f"{rel}:{lines[0]} — `{name}` is listed as fetching a "
                    f"caller-influenced URL and no longer mentions "
                    f"`{ORIGIN_PARAM}`. Validating the URL does not bound where "
                    f"a redirect ends up; that is the 2026-09-09 SSRF."
                )

    for key, entry in sorted(KNOWN.items()):
        if key not in found:
            rel, name = key
            problems.append(
                f"{rel} — KNOWN lists `{name}` and no fetch was found there. "
                f"If it moved or went, update KNOWN so this list stays the "
                f"inventory it claims to be."
            )

    if problems:
        print("outbound fetch sites: the inventory does not match the code\n")
        for p in problems:
            print(f"  {p}")
        print(
            f"\n{len(problems)} problem(s). The list is in "
            f"tools/check-outbound-fetch.py; read its docstring before editing it."
        )
        return 1

    print(f"outbound fetch: {len(found)} site(s), all listed and all origin-checked")
    for (rel, name) in sorted(found):
        print(f"  ok    {rel}::{name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

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

Three ways to fail it, and all three are the point:

- **A fetch site appeared that is not listed below.** Add it, and while you are
  writing the entry, answer the question the entry asks: can a caller influence
  the URL? If yes, `expected_origin` is not optional.
- **A site listed as caller-influenced stopped mentioning `expected_origin`.**
  That is the protection being removed, which is how it was missing in the first
  place.
- **A caller of one of those sites passes no `expected_origin`.** Added after
  the second bullet turned out to be a claim this file did not keep: it said
  "stopped passing" and only checked *mentioning*, which a fetch function
  always does — the parameter is in its own signature. `download_image`
  mentioned it, defaulted it to None, and no caller in the application handed
  it one, so the final-origin check it grew after a review had never run in
  production while this file reported it `ok`. A deliberate omission goes in
  `PASSES_NO_ORIGIN` with the reason, so it is written down rather than
  implied.
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
#: caller-influenced has to mention it, **and every caller has to pass it** —
#: see `PASSES_NO_ORIGIN` for why the second half had to be added.
ORIGIN_PARAM = "expected_origin"


#: Call sites that hand a caller-influenced fetch no origin, and the reason.
#:
#: **This exists because the docstring above promised a check that was not
#: here.** Its second failure mode reads "a site listed as caller-influenced
#: stopped *passing* `expected_origin`" — and the code only asked whether the
#: fetch function *mentions* the parameter, which it always does, because it is
#: in its own signature. `download_image` mentioned it, defaulted it to None,
#: and **no caller in the application passed one**, so the final-origin check it
#: grew after a review had never executed in production. This file reported
#: "all origin-checked" throughout.
#:
#: So the call sites are checked now, and the one deliberate omission is written
#: down rather than left to a docstring. An entry here is a claim that a
#: stranger cannot steer that particular URL — not that the fetch is harmless.
PASSES_NO_ORIGIN: dict[tuple[str, str], str] = {
    ("workers/analysis_runner.py", "download_audio"): (
        "The analysis worker signs its own URL from a stored object key, and "
        "`readable_audio_url` falls back to the reference already on the row "
        "for historical takes. Pinning an origin here would refuse exactly the "
        "rows that fallback exists to keep working through a rolling deploy. "
        "`POST /v1/calibration`, which takes a URL from a request body, is the "
        "caller that must pass one — and does."
    ),
}


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

    # **Every caller of a caller-influenced fetch, not just the fetch itself.**
    # The loop above asks whether the function mentions `expected_origin`, which
    # it always does — it is its own parameter. What was never asked is whether
    # anybody hands it one, and that is where the protection actually lives.
    guarded = {name for (_, name), entry in KNOWN.items() if entry["caller_influenced"]}
    for path in sorted(BACKEND.rglob("*.py")):
        if "/tests/" in path.as_posix():
            continue
        rel = path.relative_to(BACKEND).as_posix()
        try:
            tree = ast.parse(path.read_text())
        except SyntaxError:
            continue  # already reported above
        for call in (n for n in ast.walk(tree) if isinstance(n, ast.Call)):
            callee = getattr(call.func, "id", None) or getattr(call.func, "attr", None)
            if callee not in guarded:
                continue
            # The definition is not a call site; skip the file that owns it only
            # when this really is the definition rather than a recursive call.
            if any(kw.arg == ORIGIN_PARAM for kw in call.keywords):
                continue
            excuse = PASSES_NO_ORIGIN.get((rel, callee))
            if excuse is None:
                problems.append(
                    f"{rel}:{call.lineno} — calls `{callee}` without "
                    f"`{ORIGIN_PARAM}`, so the final-origin check does not run "
                    f"for this fetch. Pass one, or record the site in "
                    f"PASSES_NO_ORIGIN with the reason a stranger cannot steer "
                    f"that URL."
                )

    for key, entry in sorted(PASSES_NO_ORIGIN.items()):
        rel, callee = key
        source = (BACKEND / rel).read_text() if (BACKEND / rel).exists() else ""
        if f"{callee}(" not in source:
            problems.append(
                f"{rel} — PASSES_NO_ORIGIN excuses `{callee}` here and there is "
                f"no such call. Remove the entry so the exception list stays as "
                f"short as it claims to be."
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

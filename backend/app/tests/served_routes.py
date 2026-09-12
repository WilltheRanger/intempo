"""What the running app actually serves, for the tests that ask.

**FastAPI 0.141 changed where the answer lives.** `include_router` used to
flatten a sub-router's endpoints into `app.routes` as `APIRoute` objects, so
three test files read them straight off it. It now inserts one private
`_IncludedRouter` per included router instead, and the endpoints hang off that
— so `[r for r in app.routes if isinstance(r, APIRoute)]` went from 27 routes
to **one**, silently, on a dependency upgrade that fixed 21 security
advisories.

Three tests caught it, and one of them caught it *by design*:
`test_there_are_routes_to_check` exists to fail when this file's kind of
reflection finds nothing, because every other assertion in it would otherwise
pass vacuously. It earned its place.

The lesson is the one this repository keeps relearning: read a public API, or
say plainly that you are reading a private one.
"""

from __future__ import annotations

from fastapi.routing import APIRoute

from app.main import app

#: What OpenAPI calls an operation, as opposed to a `parameters` or `summary`
#: key sitting beside them on the same path item.
_METHODS = {"get", "put", "post", "delete", "options", "head", "patch", "trace"}


def served_paths() -> dict[str, set[str]]:
    """Full path template → the HTTP methods served on it, uppercased.

    From `app.openapi()`, which is public, stable across these versions, and
    the only place the **prefixed** path appears at all: since 0.141 a
    sub-route's own `.path` is `/analyses`, and the `/v1` is applied by the
    router wrapper when it matches rather than baked in.
    """
    paths = app.openapi()["paths"]
    return {
        path: {method.upper() for method in item if method.lower() in _METHODS}
        for path, item in paths.items()
    }


def served_routes() -> list[APIRoute]:
    """Every `APIRoute` object, for callers that need the endpoint *function*.

    The schema cannot answer this — it describes the interface, not what
    implements it — so this walks the route tree instead, and
    `_IncludedRouter.original_router` is a private attribute with no public
    equivalent. Named here rather than spread across three test files, so when
    FastAPI moves it again there is one place to fix.

    The paths on these are **unprefixed**. Anything comparing against a real
    URL wants `served_paths()`.
    """
    found: list[APIRoute] = []

    def walk(routes) -> None:
        for route in routes:
            if isinstance(route, APIRoute):
                found.append(route)
                continue
            inner = getattr(route, "routes", None)
            if inner is None:
                included = getattr(route, "original_router", None)
                inner = getattr(included, "routes", None)
            if inner:
                walk(inner)

    walk(app.routes)
    return found

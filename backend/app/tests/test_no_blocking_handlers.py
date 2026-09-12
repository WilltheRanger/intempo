"""No request handler may run on the event loop.

**The bug this exists to prevent has already happened once, to every route in
the API at the same time.** Every handler was declared `async def` and not one
of them contained an `await`; all of them called Supabase through its
synchronous client. Starlette runs an `async def` endpoint on the event loop, so
each of those blocking socket reads stopped the entire server for its duration
and the API served one request at a time — including `/v1/health`, which the app
blocks every screen on while it wakes this host.

Nothing about that is visible in development. One person clicking through the
app never has two requests in flight, so a server with no concurrency behaves
identically to a fast one. It surfaces only under real use, as the app taking
tens of seconds to show a screen and then appearing to hang, which is a symptom
with a hundred plausible causes and this cause is not among the obvious ones.

So it is asserted rather than remembered. Writing `async def` in front of a
handler is a one-word change that silently gives back the whole server's
concurrency, and a reviewer has no way to see it in a diff.

The rule is not "never write async" — it is that a coroutine handler must not
contain blocking work. An endpoint that genuinely awaits async I/O is welcome,
and can be added to `_ASYNC_BY_DESIGN` with the reason it is safe.
"""

from __future__ import annotations

import inspect

from fastapi.routing import APIRoute

from app.tests.served_routes import served_routes

#: Coroutine handlers that have been checked and do not block.
#:
#: Empty, and that is the honest state: every endpoint here reaches Supabase
#: through a synchronous client, so there is nothing this could correctly hold.
#: An entry belongs here only with a note saying which async I/O it awaits.
_ASYNC_BY_DESIGN: set[str] = set()


def _routes() -> list[APIRoute]:
    """Every route's `APIRoute`, whatever shape FastAPI is holding them in."""
    return served_routes()


def test_there_are_routes_to_check() -> None:
    """A guard against this whole file passing because it found nothing.

    An import that quietly yielded an empty app would make every assertion
    below vacuously true, which is the failure mode of exactly this kind of
    reflective test.
    """
    assert len(_routes()) > 10


def test_no_handler_runs_on_the_event_loop() -> None:
    offenders = sorted(
        f"{sorted(route.methods)} {route.path} -> {route.endpoint.__name__}"
        for route in _routes()
        if inspect.iscoroutinefunction(route.endpoint)
        and route.endpoint.__name__ not in _ASYNC_BY_DESIGN
    )
    assert not offenders, (
        "These handlers are `async def`, so Starlette runs them on the event "
        "loop. Every one of them blocks it on a synchronous Supabase call, "
        "which means the API serves one request at a time. Drop the `async` "
        "unless the handler genuinely awaits — see the note in app/main.py:\n  "
        + "\n  ".join(offenders)
    )


def test_no_dependency_runs_on_the_event_loop() -> None:
    """The auth dependencies block too, and they run on *every* request.

    `current_user_id_provisioned` writes a row and `_decode_token` can fetch
    the JWKS over the network. As coroutines those ran on the loop ahead of the
    handler, so fixing only the handlers would have left the cheapest possible
    request still capable of stalling the server.
    """
    offenders = set()
    for route in _routes():
        for dependency in route.dependant.dependencies:
            call = dependency.call
            if call is None or not inspect.iscoroutinefunction(call):
                continue
            # Starlette's own security helpers are async and do no I/O — they
            # read a header off the request and return.
            if call.__module__.startswith("fastapi."):
                continue
            offenders.add(f"{call.__module__}.{getattr(call, '__name__', call)}")

    assert not offenders, (
        "These dependencies are `async def` and do blocking work, so they "
        "stall the event loop before the handler even starts:\n  "
        + "\n  ".join(sorted(offenders))
    )

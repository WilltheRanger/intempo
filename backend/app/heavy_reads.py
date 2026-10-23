"""At most a few heavy reads at once; every other request carries on.

**What this is for, measured on the day it was written (2026-10-23).** The API
runs on an instance with 512 MB and a tenth of a CPU. A library listing that
carries notation, or a page of takes that carries their results, holds tens of
megabytes while it is decoded, validated and encoded. Forty musicians opening
the app at the same moment put forty of those in flight — Starlette runs as
many plain-`def` handlers at once as its thread pool has threads, which is
forty — and the instance was killed for exceeding its memory, every request
failing with it. Replayed under those limits (`docs/subsystems.md`), the same
burst peaked at 518 MB without this, a few megabytes from the kill.

Running them all at once bought nothing. A tenth of a CPU does the same work
however many requests share it, so forty listings in parallel finish no sooner
than forty in a queue — they only all hold their memory for the whole time,
and the first finishes as late as the last. In a queue, memory is bounded by
the number allowed in, and the first of them finishes first.

**The wait happens here, in the event loop, not in a worker thread.** A request
queued inside its handler would hold one of the pool's threads while it waited,
and with enough of them waiting `/v1/health` would queue behind them — the
check the host uses to decide whether to restart this instance. Here, a
waiting request holds nothing but its own scope.

**A request whose caller has gone is not computed.** The app gives a request
forty-five seconds and then retries it once; work done for a request nobody is
waiting for is pure cost exactly when there is least to spare. While a request
waits for a slot this listens for the disconnect, and leaves if it comes.

Which requests are heavy is decided by path and query alone, before any work:
the two listings, unless the caller asked for the light form —
`include_score=false` or `include_result=false` — or for a handful of rows.
Today's three most recent takes are fifteen kilobytes; queueing them behind
somebody's two-hundred-row library would delay the first screen for no memory
saved at all.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any
from urllib.parse import parse_qs

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

#: Each heavy path, and the query flag that asks for its light form.
HEAVY_LISTINGS = {
    "/v1/scores": "include_score",
    "/v1/analyses": "include_result",
}

#: A page of at most this many rows is light, whatever it carries. Both
#: listings default to fifty when `limit` is absent.
SMALL_PAGE = 20


def is_heavy(scope: Scope) -> bool:
    """Whether this request is one of the reads that holds real memory."""
    if scope.get("type") != "http" or scope.get("method") != "GET":
        return False
    light_flag = HEAVY_LISTINGS.get(scope.get("path", "").rstrip("/") or "/")
    if light_flag is None:
        return False
    query = parse_qs(scope.get("query_string", b"").decode("latin-1"))
    asked = query.get(light_flag, [""])[-1].strip().lower()
    # FastAPI's own reading of a bool: these are the spellings of false.
    if asked in ("false", "0", "off", "no", "f", "n"):
        return False
    try:
        return int(query.get("limit", ["50"])[-1]) > SMALL_PAGE
    except ValueError:
        # Not a number: FastAPI refuses it before any work, so it is not heavy.
        return False


class HeavyReadGate:
    """ASGI middleware: a bounded number of heavy reads in flight at once."""

    def __init__(self, app: ASGIApp, *, at_once: int) -> None:
        if at_once < 1:
            raise ValueError("at least one heavy read must be allowed at a time")
        self.app = app
        self.at_once = at_once
        self._slots: asyncio.Semaphore | None = None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if not is_heavy(scope):
            await self.app(scope, receive, send)
            return
        if self._slots is None:
            # Made here rather than in `__init__`, inside the loop that serves.
            self._slots = asyncio.Semaphore(self.at_once)

        # The request's own messages first: a GET's body is empty, but it is
        # still a message the app may ask for, so it is kept to hand on.
        held: list[Message] = []
        while True:
            message = await receive()
            held.append(message)
            if message["type"] != "http.request" or not message.get("more_body"):
                break
        if held[-1]["type"] == "http.disconnect":
            return

        slot = asyncio.ensure_future(self._slots.acquire())
        gone = asyncio.ensure_future(receive())
        done, _ = await asyncio.wait({slot, gone}, return_when=asyncio.FIRST_COMPLETED)
        if slot not in done:
            # The caller left while queued. Nothing was read for them.
            slot.cancel()
            try:
                await slot
            except asyncio.CancelledError:
                pass
            else:
                self._slots.release()
            return

        async def replayed() -> Message:
            if held:
                return held.pop(0)
            # The one `receive` already in flight is the app's to finish; a
            # second concurrent call on the same connection is not allowed.
            return await gone

        try:
            await self.app(scope, replayed, send)
        finally:
            self._slots.release()
            if not gone.done():
                gone.cancel()

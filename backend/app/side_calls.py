"""Database calls a request makes side by side rather than one after another.

**Every call to the database crosses the country, and a request made its calls
one at a time.** Measured on the live project's edge logs, 2026-10-23: the API's
calls took a median 274 ms each, of which the database's own work was 21 ms —
the rest is the trip from this API's region to the database's, often over a
connection opened for that one call. A request whose calls do not depend on
each other was paying that trip once per call, in a row: three of the requests
the app makes on opening paid it three times.

`together` runs such calls at once and hands back their results in order, so a
request pays the trip once per *dependency*, not once per call.
"""

from __future__ import annotations

import contextvars
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

#: Threads waiting on the database for requests, beside Starlette's own pool.
#:
#: They hold a socket and almost no CPU, so the bound is not about the instance
#: — it is about not opening an unbounded number of connections to the
#: database in a burst. A request whose side calls find every thread busy waits
#: for one, which is the old one-call-at-a-time cost and no worse.
_THREADS = 16

_PREFIX = "side-call"
_POOL = ThreadPoolExecutor(max_workers=_THREADS, thread_name_prefix=_PREFIX)


def together(*calls: Callable[[], Any]) -> list[Any]:
    """Run `calls` at the same time; return their results in the order given.

    The first runs in the calling thread and the rest on the shared pool, each
    in a copy of the caller's context, so logging and request-scoped state go
    with it. An exception from any call is raised here, the first in argument
    order winning — the same exception a one-at-a-time caller would have seen
    first.

    **Called from one of the pool's own threads, the calls run in turn.** A side
    call that waited on further side calls could otherwise hold every thread
    while the work it waits for queues behind it. Nothing does that today; this
    makes it harmless if something ever does.
    """
    if len(calls) <= 1 or threading.current_thread().name.startswith(_PREFIX):
        return [call() for call in calls]
    futures = [
        _POOL.submit(contextvars.copy_context().run, call) for call in calls[1:]
    ]
    first = calls[0]()
    return [first, *(future.result() for future in futures)]

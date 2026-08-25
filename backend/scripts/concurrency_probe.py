"""Does this API serve more than one request at a time?

Boots the real app with a deliberately slow database, fires several requests
at once, and asks `/v1/health` a question while they are in flight.

    uv run python scripts/concurrency_probe.py

**Why it exists.** Every handler in this API was once `async def` with no
`await` in it, calling Supabase through its synchronous client — so each one
blocked the event loop and the server served one request at a time. That is
invisible in development, because one person clicking around never has two
requests in flight, and it is invisible in the test suite, because `TestClient`
does not exercise concurrency at all. It is visible here, and it was visible to
musicians as the app being slow and then appearing to hang.

`test_no_blocking_handlers.py` is what *guards* the fix, statically and in CI.
This is what **measured** it, and what to reach for when the shape of the
question changes — a new middleware, a dependency that turns out to block, a
different server. The numbers on 2026-08-25, six requests at 1s each:

    async def (as shipped)   wall 6.02s   health 5.86s
    def                      wall 1.01s   health 0.002s

The health figure is the one that matters, because the app blocks every screen
on `/v1/health` while it wakes the host.

Expect a `ProxyError` traceback on the way up and ignore it: the startup sweeps
run against the *real* service client, which is pointed at a hostname that does
not exist. `lifespan` catches it, which is the behaviour it is supposed to have.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
import urllib.request
from pathlib import Path
from uuid import UUID

#: How long each fake database call takes.
DELAY_SECONDS = 1.0
#: How many requests to have in flight at once.
CONCURRENT = 6
PORT = 8111

# Enough for the settings object to build a client; nothing here is contacted.
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "x" * 40)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class _SlowClient:
    """A Supabase client whose every query blocks for `DELAY_SECONDS`.

    Blocking rather than sleeping asynchronously, because that is the point:
    the real client blocks a thread on a socket, and what is being measured is
    whether that thread is the event loop.
    """

    def table(self, _name):
        return self

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a):
        return self

    def order(self, *_a, **_k):
        return self

    def range(self, *_a):
        return self

    def limit(self, *_a):
        return self

    def execute(self):
        time.sleep(DELAY_SECONDS)
        return type("Result", (), {"data": []})()


def main() -> int:
    import app.auth as auth
    import app.routers.scores as scores

    scores._service_client = lambda: _SlowClient()
    scores._sign_downloads = lambda _keys: {}

    from app.main import app

    # Auth is not what is under test, and a real token would need a project.
    app.dependency_overrides[auth.current_user_id] = lambda: UUID(int=1)

    import uvicorn

    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=PORT, log_level="error")
    )
    threading.Thread(target=server.run, daemon=True).start()

    def get(path: str) -> float:
        started = time.perf_counter()
        urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=120).read()
        return time.perf_counter() - started

    for _ in range(100):
        try:
            get("/v1/health")
            break
        except Exception:  # noqa: BLE001 — still booting
            time.sleep(0.1)
    else:
        print("the server never came up", file=sys.stderr)
        return 1

    threads = [
        threading.Thread(target=lambda: get("/v1/scores")) for _ in range(CONCURRENT)
    ]
    overall = time.perf_counter()
    for thread in threads:
        thread.start()
    # Long enough for all of them to be in flight, short enough to be well
    # inside the first one's delay.
    time.sleep(DELAY_SECONDS * 0.15)
    health = get("/v1/health")
    for thread in threads:
        thread.join()
    overall = time.perf_counter() - overall

    serialized = CONCURRENT * DELAY_SECONDS
    print(
        json.dumps(
            {
                "concurrent_requests": CONCURRENT,
                "each_blocks_for_s": DELAY_SECONDS,
                "wall_clock_s": round(overall, 2),
                "serialized_would_be_s": round(serialized, 2),
                "health_check_s_while_busy": round(health, 3),
            },
            indent=2,
        )
    )
    server.should_exit = True

    # A server that serialises takes about `serialized`; one that does not takes
    # about one delay. Half way between them is a wide margin either way.
    if overall > serialized / 2:
        print("\nSERIALISED: requests are queueing behind one another.", file=sys.stderr)
        return 1
    print("\nConcurrent.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

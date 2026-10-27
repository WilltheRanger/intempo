"""The heavy-read gate: a burst queues instead of killing the instance.

Pure ASGI, driven with hand-built messages, because what is under test is the
waiting — how many get through at once, who is not made to wait, and what
happens to a caller who leaves while queued — and none of that needs a server.
"""

from __future__ import annotations

import asyncio

import pytest

from app.heavy_reads import HeavyReadGate, is_heavy


def _scope(path: str, query: str = "", method: str = "GET") -> dict:
    return {"type": "http", "method": method, "path": path, "query_string": query.encode()}


@pytest.mark.parametrize(
    "path, query, method, heavy",
    [
        ("/v1/scores", "limit=200&offset=0", "GET", True),
        ("/v1/scores/", "", "GET", True),
        ("/v1/scores", "include_score=false", "GET", False),
        ("/v1/scores", "include_score=False", "GET", False),
        ("/v1/scores", "include_score=true", "GET", True),
        ("/v1/analyses", "status=done&per_note=false", "GET", True),
        ("/v1/analyses", "include_result=false", "GET", False),
        ("/v1/analyses", "include_result=0", "GET", False),
        # Today's three most recent takes: results, but a handful of them.
        ("/v1/analyses", "limit=3&offset=0&status=done&per_note=false", "GET", False),
        ("/v1/analyses", "limit=20", "GET", False),
        ("/v1/analyses", "limit=21", "GET", True),
        ("/v1/scores", "limit=200&offset=0", "GET", True),
        ("/v1/scores", "limit=lots", "GET", False),
        ("/v1/scores", "", "POST", False),
        ("/v1/scores/current", "", "GET", False),
        ("/v1/scores/2b1f0c55-0000-4000-8000-000000000000", "", "GET", False),
        ("/v1/health", "", "GET", False),
        ("/v1/me", "", "GET", False),
    ],
)
def test_which_requests_queue(path: str, query: str, method: str, heavy: bool) -> None:
    """The two listings, unless the caller asked for the light form."""
    assert is_heavy(_scope(path, query, method)) is heavy


class _Connection:
    """One client: its request body, then silence until it hangs up."""

    def __init__(self) -> None:
        self.hung_up = asyncio.Event()
        self.sent: list[dict] = []
        self._body_sent = False

    async def receive(self) -> dict:
        if not self._body_sent:
            self._body_sent = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await self.hung_up.wait()
        return {"type": "http.disconnect"}

    async def send(self, message: dict) -> None:
        self.sent.append(message)


class _App:
    """Answers after `release` is set, and counts who is inside at once."""

    def __init__(self) -> None:
        self.inside = 0
        self.most_inside = 0
        self.served: list[str] = []
        self.release = asyncio.Event()
        self.bodies: list[dict] = []

    async def __call__(self, scope, receive, send) -> None:
        self.bodies.append(await receive())
        self.inside += 1
        self.most_inside = max(self.most_inside, self.inside)
        try:
            if is_heavy(scope):
                await self.release.wait()
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"ok"})
            self.served.append(scope["path"])
        finally:
            self.inside -= 1


def _run(coro):
    return asyncio.run(asyncio.wait_for(coro, timeout=5))


def test_no_more_than_the_limit_are_worked_on_at_once() -> None:
    """Forty at once was the instance's death; the limit is the most in flight."""

    async def scenario() -> None:
        app = _App()
        gate = HeavyReadGate(app, at_once=2)
        connections = [_Connection() for _ in range(10)]
        tasks = [
            asyncio.create_task(gate(_scope("/v1/scores"), c.receive, c.send))
            for c in connections
        ]
        await asyncio.sleep(0.05)
        assert app.inside == 2, "two in, eight waiting"
        app.release.set()
        await asyncio.gather(*tasks)
        assert app.most_inside == 2
        assert len(app.served) == 10, "every queued request is answered"

    _run(scenario())


def test_a_light_request_does_not_wait_behind_heavy_ones() -> None:
    """`/v1/health` and the rest must never queue: the host restarts an
    instance whose health check stops answering."""

    async def scenario() -> None:
        app = _App()
        gate = HeavyReadGate(app, at_once=1)
        heavy = [_Connection() for _ in range(3)]
        queued = [
            asyncio.create_task(gate(_scope("/v1/analyses"), c.receive, c.send)) for c in heavy
        ]
        await asyncio.sleep(0.05)
        for path, query in (("/v1/health", ""), ("/v1/me", ""), ("/v1/scores", "include_score=false")):
            light = _Connection()
            await gate(_scope(path, query), light.receive, light.send)
            assert light.sent[-1]["body"] == b"ok", path
        app.release.set()
        await asyncio.gather(*queued)

    _run(scenario())


def test_a_caller_who_leaves_while_queued_costs_nothing() -> None:
    """The app retries a request after forty-five seconds. The abandoned one
    must not then be computed for nobody, at the moment there is least to
    spare."""

    async def scenario() -> None:
        app = _App()
        gate = HeavyReadGate(app, at_once=1)
        first, second, third = _Connection(), _Connection(), _Connection()
        holding = asyncio.create_task(gate(_scope("/v1/scores"), first.receive, first.send))
        await asyncio.sleep(0.02)
        waiting = asyncio.create_task(gate(_scope("/v1/scores"), second.receive, second.send))
        await asyncio.sleep(0.02)

        second.hung_up.set()
        await waiting
        assert second.sent == [], "nothing is sent to a caller who has gone"

        app.release.set()
        await holding
        # And the slot it never took is not lost: the next one gets in.
        await gate(_scope("/v1/scores"), third.receive, third.send)
        assert app.served == ["/v1/scores", "/v1/scores"]

    _run(scenario())


def test_the_app_still_receives_the_request_it_was_sent() -> None:
    """The gate reads the request's messages while it waits; the app must still
    be handed them, or a handler that reads its body would hang."""

    async def scenario() -> None:
        app = _App()
        app.release.set()
        gate = HeavyReadGate(app, at_once=1)
        connection = _Connection()
        await gate(_scope("/v1/scores"), connection.receive, connection.send)
        assert app.bodies == [{"type": "http.request", "body": b"", "more_body": False}]

    _run(scenario())


def test_a_limit_below_one_is_refused() -> None:
    with pytest.raises(ValueError):
        HeavyReadGate(_App(), at_once=0)

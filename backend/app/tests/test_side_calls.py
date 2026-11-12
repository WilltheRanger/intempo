"""`side_calls.together`: results in order, really at once, and never stuck."""

from __future__ import annotations

import contextvars
import threading

import pytest

from app import side_calls
from app.side_calls import together


def test_results_come_back_in_the_order_the_calls_were_given() -> None:
    assert together(lambda: 1, lambda: "two", lambda: [3]) == [1, "two", [3]]


def test_no_calls_and_one_call_need_no_pool() -> None:
    assert together() == []
    assert together(lambda: threading.current_thread().name) == [
        threading.current_thread().name
    ]


def test_the_calls_run_at_the_same_time() -> None:
    """Each waits for the other to have started, so one at a time never ends.

    The wait has a deadline, so a version that ran them in turn fails here in a
    second rather than hanging the suite.
    """
    first_started, second_started = threading.Event(), threading.Event()

    def first() -> bool:
        first_started.set()
        return second_started.wait(timeout=1)

    def second() -> bool:
        second_started.set()
        return first_started.wait(timeout=1)

    assert together(first, second) == [True, True]


def test_an_exception_in_a_side_call_reaches_the_caller() -> None:
    def broken() -> None:
        raise LookupError("the database said no")

    with pytest.raises(LookupError, match="said no"):
        together(lambda: 1, broken)


def test_the_first_call_in_argument_order_wins_when_both_fail() -> None:
    """What a caller making them one at a time would have seen first."""

    def first() -> None:
        raise KeyError("first")

    def second() -> None:
        raise ValueError("second")

    with pytest.raises(KeyError):
        together(first, second)


def test_side_calls_see_the_callers_context() -> None:
    """Logging and request-scoped state travel with the call."""
    request = contextvars.ContextVar("request", default="none")
    request.set("this request")
    assert together(lambda: request.get(), lambda: request.get()) == [
        "this request",
        "this request",
    ]


def test_a_side_call_that_asks_for_more_side_calls_cannot_deadlock(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With every pool thread inside a call that waits on further side calls,
    a pool that queued those would never finish. Run in turn instead."""
    monkeypatch.setattr(
        side_calls, "_POOL", side_calls.ThreadPoolExecutor(max_workers=1, thread_name_prefix=side_calls._PREFIX)
    )

    def nested() -> list[str]:
        return together(
            lambda: threading.current_thread().name,
            lambda: threading.current_thread().name,
        )

    caller, inner = together(lambda: "caller", nested)
    assert caller == "caller"
    # Both ran in the one pool thread, one after the other.
    assert len(set(inner)) == 1 and inner[0].startswith(side_calls._PREFIX)

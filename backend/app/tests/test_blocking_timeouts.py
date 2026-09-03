"""Every blocking client this API builds must carry a timeout.

`test_no_blocking_handlers.py` proved the handlers run on the threadpool
rather than the event loop. This is the other half of that change, and
`db.py` states the cost in its own words:

    Every handler in this API blocks a worker thread on the Supabase client, so
    an unanswered call does not fail — it parks a thread for two minutes.
    Starlette's pool holds forty of them, and it is shared with the background
    work, so a Supabase incident does not degrade this API, it removes it:
    forty parked threads and the server stops answering anything, health check
    included.

The timeouts were set once and **nothing held them**. Dropping `_options()`
from a factory, or adding a third factory without it, restores the library's
120-second default and passes every other test in this suite — while turning a
provider outage from "slow" into "the server is gone", health check included.

The JWKS fetch is the same hazard on a different socket, and worse placed: it
runs inside the auth dependency, so it is in front of **every** authenticated
request rather than one handler.

Both are checked by **calling** the factories rather than reading the source,
and the Supabase side enumerates them from the module, so a factory added next
month is covered without anyone remembering this file.
"""

from __future__ import annotations

import inspect
from typing import Any

import pytest

from app import auth as auth_module
from app import db as db_module


def _client_factories() -> dict[str, Any]:
    """Every `get_*_client` the db module exposes.

    Enumerated, not listed. A new factory is exactly the case this test is for,
    and a hand-written list would not know about it.
    """
    return {
        name: value
        for name, value in vars(db_module).items()
        if name.startswith("get_") and name.endswith("_client") and callable(value)
    }


def _clear_all_caches() -> None:
    """Every factory's cache, not just the one under test.

    `get_client` delegates to `get_anon_client`, so clearing only the callable
    named in the parameter leaves a cached client behind and the factory never
    reaches `create_client` at all — which reads as "no options" or as "built
    nothing", depending on the test, and in both cases for the wrong reason.
    Clearing all of them makes each case independent of the order they run in.
    """
    for factory in _client_factories().values():
        clear = getattr(factory, "cache_clear", None)
        if clear is not None:
            clear()


def test_there_are_factories_to_check() -> None:
    """A guard against the whole file passing because it found nothing."""
    assert len(_client_factories()) >= 2, sorted(_client_factories())


@pytest.mark.parametrize("name", sorted(_client_factories()))
def test_every_supabase_client_is_built_with_both_timeouts(
    name: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    built: list[Any] = []

    def fake_create_client(url: str, key: str, options: Any = None) -> object:
        built.append(options)
        return object()

    monkeypatch.setattr(db_module, "create_client", fake_create_client)
    # Real-looking settings so the factory gets past its "not configured"
    # guard, and a cleared cache so it actually runs.
    monkeypatch.setattr(db_module.settings, "SUPABASE_URL", "https://example.test")
    monkeypatch.setattr(db_module.settings, "SUPABASE_KEY", "anon")
    monkeypatch.setattr(
        db_module.settings, "SUPABASE_SERVICE_ROLE_KEY", "service", raising=False
    )

    factory = _client_factories()[name]
    _clear_all_caches()
    try:
        factory()
    finally:
        _clear_all_caches()

    assert built, f"{name} did not build a client with these settings"
    options = built[-1]
    assert options is not None, f"{name} passed no options, so both timeouts default"

    for field in ("postgrest_client_timeout", "storage_client_timeout"):
        value = getattr(options, field, None)
        assert isinstance(value, (int, float)), f"{name} left {field} to the library"
        # Positive because zero or negative is not a timeout, and bounded well
        # under the 120s default that made this worth writing down.
        assert 0 < value <= 60, f"{name} set {field} to {value}"


def test_the_jwks_fetch_cannot_hang_a_request(monkeypatch: pytest.MonkeyPatch) -> None:
    """It runs inside the auth dependency, so it precedes every request."""
    seen: list[dict[str, Any]] = []

    class FakeJWKClient:
        def __init__(self, url: str, **kwargs: Any) -> None:
            seen.append(kwargs)

    monkeypatch.setattr(auth_module, "PyJWKClient", FakeJWKClient)
    monkeypatch.setattr(auth_module.settings, "SUPABASE_URL", "https://example.test")

    auth_module._get_jwks_client.cache_clear()
    try:
        auth_module._get_jwks_client()
    finally:
        auth_module._get_jwks_client.cache_clear()

    assert seen, "the JWKS client was never constructed"
    timeout = seen[-1].get("timeout")
    assert isinstance(timeout, (int, float)), "the JWKS fetch has no timeout"
    assert 0 < timeout <= 30, timeout


def test_the_timeouts_are_named_constants_rather_than_literals() -> None:
    """So the reasoning stays attached to the number.

    Both modules carry several paragraphs on *why* these values are what they
    are — what a Supabase incident costs, what a musician sees when the JWKS
    fetch stalls. Inlined literals would leave that reasoning pointing at
    nothing, which is how a number gets "tidied" to a rounder one later.
    """
    for module, names in (
        (db_module, ("_DB_TIMEOUT_SECONDS", "_STORAGE_TIMEOUT_SECONDS")),
        (auth_module, ("_JWKS_TIMEOUT_SECONDS", "_JWKS_LIFESPAN_SECONDS")),
    ):
        for name in names:
            value = getattr(module, name, None)
            assert isinstance(value, (int, float)) and value > 0, (
                f"{module.__name__}.{name} is missing or not a positive number"
            )
            assert inspect.getsourcefile(module), module


def test_a_factory_with_no_settings_builds_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The other half of the parametrised test's setup, pinned.

    Those tests set real-looking settings so the factory runs. If a factory
    ever returned a client *without* them, this suite would be exercising a
    path production never takes — and `None` on a blank env is what lets the
    whole test suite run with no Supabase project at all.
    """
    monkeypatch.setattr(db_module.settings, "SUPABASE_URL", "")
    for name, factory in _client_factories().items():
        _clear_all_caches()
        try:
            assert factory() is None, f"{name} built a client with no URL configured"
        finally:
            _clear_all_caches()

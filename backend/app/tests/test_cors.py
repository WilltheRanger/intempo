"""CORS: whether a browser is allowed to make the request at all.

Nothing here tests business logic. It tests the layer *before* the handler —
the one that decides whether the request is sent, and whose failure mode is a
console message ("Failed to fetch") that names neither the cause nor the fix.

This was missing entirely. It never showed up because the API tests use
`TestClient` in-process, where there is no browser and no preflight, and the
browser suites talk to a stub that happens to send the headers. The first time
the real backend met the real frontend it would have failed on every
authenticated request while `/v1/health` kept working — which reads as an auth
bug and is not one.
"""

from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient


def _app_with_origins(monkeypatch: pytest.MonkeyPatch, origins: str):
    """Rebuild the app with a given origin list.

    The middleware reads the setting once at import, so this reimports rather
    than patching — which is also a fair reflection of production, where the
    origins are fixed for the life of the process.
    """
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", origins)
    import app.config

    importlib.reload(app.config)
    import app.main

    importlib.reload(app.main)
    return app.main.app


@pytest.fixture()
def pages_client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    return TestClient(_app_with_origins(monkeypatch, "https://intempo.pages.dev"))


ORIGIN = "https://intempo.pages.dev"


def test_preflight_for_an_authenticated_get_is_allowed(pages_client: TestClient) -> None:
    """The request that actually fails without this.

    `Authorization` is not a CORS-safelisted header, so every authenticated
    call is preceded by an OPTIONS the browser will not proceed past unless
    the header is named in the response.
    """
    res = pages_client.options(
        "/v1/scores",
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert res.status_code == 200
    assert res.headers["access-control-allow-origin"] == ORIGIN
    assert "authorization" in res.headers["access-control-allow-headers"].lower()


def test_preflight_names_every_method_the_client_uses(pages_client: TestClient) -> None:
    """PATCH and DELETE are the ones that get forgotten.

    Not hypothetical: the stub API in `mobile/scripts/` shipped without PUT in
    its allow-list, and the score-image upload failed with an opaque "Failed to
    fetch" until it was found. The client sends all four.
    """
    for method in ("GET", "POST", "PATCH", "DELETE"):
        res = pages_client.options(
            "/v1/scores/00000000-0000-0000-0000-000000000000",
            headers={
                "Origin": ORIGIN,
                "Access-Control-Request-Method": method,
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
        assert res.status_code == 200, method
        allowed = res.headers.get("access-control-allow-methods", "")
        assert method in allowed, f"{method} missing from {allowed!r}"


def test_an_actual_request_carries_the_header(pages_client: TestClient) -> None:
    """The preflight passing is not enough — the real response needs it too."""
    res = pages_client.get("/v1/health", headers={"Origin": ORIGIN})
    assert res.status_code == 200
    assert res.headers["access-control-allow-origin"] == ORIGIN


def test_an_unlisted_origin_is_not_granted_access(pages_client: TestClient) -> None:
    """A site that was not named does not get the header.

    The request still reaches the handler — CORS is enforced by the browser,
    not the server — so what is asserted is the absence of the grant, which is
    the whole of what the server controls.
    """
    res = pages_client.get("/v1/health", headers={"Origin": "https://not-ours.example"})
    assert "access-control-allow-origin" not in res.headers


def test_a_second_origin_can_be_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    """A preview deployment and production both need to work at once."""
    client = TestClient(
        _app_with_origins(
            monkeypatch, "https://intempo.pages.dev,https://preview.intempo.pages.dev"
        )
    )
    for origin in ("https://intempo.pages.dev", "https://preview.intempo.pages.dev"):
        res = client.get("/v1/health", headers={"Origin": origin})
        assert res.headers["access-control-allow-origin"] == origin


def test_localhost_works_out_of_the_box(monkeypatch: pytest.MonkeyPatch) -> None:
    """Development must not require configuration to make a request at all.

    The web build runs on 8081 and this on 8000, so even a laptop is
    cross-origin. A default that covered nothing would mean every new checkout
    started broken in a way that looks like the app being broken.
    """
    monkeypatch.delenv("CORS_ALLOWED_ORIGINS", raising=False)
    import app.config

    importlib.reload(app.config)
    import app.main

    importlib.reload(app.main)
    client = TestClient(app.main.app)
    res = client.get("/v1/health", headers={"Origin": "http://localhost:8081"})
    assert res.headers["access-control-allow-origin"] == "http://localhost:8081"


def test_credentials_are_not_requested(pages_client: TestClient) -> None:
    """Auth here is a bearer token, not a cookie.

    Asking the browser to attach ambient credentials would buy nothing and
    would rule out ever widening the origin list, since `*` and credentials
    cannot be combined.
    """
    res = pages_client.get("/v1/health", headers={"Origin": ORIGIN})
    assert "access-control-allow-credentials" not in res.headers

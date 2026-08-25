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


@pytest.fixture(autouse=True)
def _restore_module_state():
    """Put `app.config` and `app.main` back the way they were found.

    Every test in this file rebuilds the CORS middleware by reloading those two
    modules, which **replaces the `settings` object** — and every other module
    in the process is still holding the old one. Nothing here noticed, because
    the reload happens to leave this file's own view consistent; other files
    then patched a settings object nothing read, and passed alone while failing
    in the suite. Three tests in `test_readiness.py` did exactly that.

    Reloading once more on the way out costs a few milliseconds and removes a
    whole class of order-dependent failure.
    """
    yield
    import importlib

    import app.config
    import app.main

    importlib.reload(app.config)
    importlib.reload(app.main)


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


class TestASubdomainWildcard:
    """Cloudflare Pages gives a project more than one hostname.

    There is the production alias, `https://project.pages.dev` — and a distinct
    one for every deployment, `https://a16c6845.project.pages.dev`, plus a
    branch alias. The dashboard shows the deployment-specific URL most
    prominently after a build, so it is the one you are most likely to open,
    and an exact list does not cover it. The request is refused before it is
    sent and the browser can only say "Failed to fetch", which looks exactly
    like the API being down.

    Listing them one by one is not an option: a new one exists after every push.
    """

    @staticmethod
    def _allowed(monkeypatch: pytest.MonkeyPatch, configured: str, origin: str) -> bool:
        client = TestClient(_app_with_origins(monkeypatch, configured))
        res = client.get("/v1/health", headers={"Origin": origin})
        return res.headers.get("access-control-allow-origin") == origin

    def test_it_covers_every_deployment_of_that_project(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        configured = "https://proj.pages.dev,https://*.proj.pages.dev"
        assert self._allowed(monkeypatch, configured, "https://proj.pages.dev")
        assert self._allowed(monkeypatch, configured, "https://a16c6845.proj.pages.dev")
        assert self._allowed(monkeypatch, configured, "https://main.proj.pages.dev")

    def test_the_star_stands_for_one_label_and_cannot_cross_a_dot(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Otherwise a wildcard for one project quietly covers things under it."""
        assert not self._allowed(
            monkeypatch, "https://*.proj.pages.dev", "https://a.b.proj.pages.dev"
        )

    def test_a_host_that_merely_starts_the_same_is_refused(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`proj.pages.dev.evil.com` is a domain anyone can register, and a
        pattern anchored only at the front would hand it a musician's token."""
        assert not self._allowed(
            monkeypatch, "https://*.proj.pages.dev", "https://proj.pages.dev.evil.com"
        )
        assert not self._allowed(
            monkeypatch, "https://*.proj.pages.dev", "https://x.proj.pages.dev.evil.com"
        )

    def test_the_scheme_has_to_match(self, monkeypatch: pytest.MonkeyPatch) -> None:
        assert not self._allowed(
            monkeypatch, "https://*.proj.pages.dev", "http://x.proj.pages.dev"
        )

    @pytest.mark.parametrize(
        "entry", ["https://*", "*", "https://*.*.dev", "*.proj.pages.dev"]
    )
    def test_a_wildcard_it_cannot_make_safe_is_dropped(
        self, monkeypatch: pytest.MonkeyPatch, entry: str
    ) -> None:
        """`https://*` would let every site on the internet read this API with a
        musician's token. Dropped rather than guessed at."""
        assert not self._allowed(monkeypatch, entry, "https://anything.example.com")
        assert not self._allowed(monkeypatch, entry, "https://proj.pages.dev")

    def test_an_exact_list_is_unaffected(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """No pattern is built when nothing asks for one."""
        assert self._allowed(
            monkeypatch, "https://proj.pages.dev", "https://proj.pages.dev"
        )
        assert not self._allowed(
            monkeypatch, "https://proj.pages.dev", "https://a16c.proj.pages.dev"
        )


# ---------------------------------------------------------------------------
# /v1/ready?origin= — the behaviour check beside the configuration one
# ---------------------------------------------------------------------------
#
# `cors_allowed_origins` asks whether the variable is set. Every value passes
# that, including one naming an origin the deployed site does not have — and
# the browser's report of the difference is a thrown fetch with no status,
# which reads as the API being down. On 2026-08-25 that cost an afternoon:
# Supabase logs showed sign-in returning 200 and the API process happily
# querying the database, while the app said "Could not reach the server".


def _probe(monkeypatch: pytest.MonkeyPatch, origins: str, asked: str) -> dict:
    client = TestClient(_app_with_origins(monkeypatch, origins))
    body = client.get("/v1/ready", params={"origin": asked}).json()
    return next(c for c in body["checks"] if c["name"] == "cors_probe")


def test_the_probe_confirms_an_origin_that_is_listed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert _probe(monkeypatch, ORIGIN, ORIGIN)["ok"] is True


def test_the_probe_refuses_an_origin_that_is_not(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The whole point. A set variable naming the wrong site passes
    `cors_allowed_origins` and fails here."""
    check = _probe(monkeypatch, ORIGIN, "https://idk-41z.pages.dev")

    assert check["ok"] is False
    # And it says what to do about it, naming the Pages shape that is almost
    # always the answer.
    assert "CORS_ALLOWED_ORIGINS" in check["detail"]


def test_a_configured_variable_is_not_evidence_the_site_can_reach_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The two checks disagreeing is the entire feature.

    If a future change makes the probe read presence too, this fails — which is
    the only thing standing between this endpoint and the Modal lesson, where
    every readiness check passed while every spawn raised.
    """
    client = TestClient(_app_with_origins(monkeypatch, ORIGIN))
    body = client.get("/v1/ready", params={"origin": "https://elsewhere.test"}).json()

    checks = {c["name"]: c["ok"] for c in body["checks"]}
    assert checks["cors_allowed_origins"] is True
    assert checks["cors_probe"] is False


def test_the_probe_understands_the_wildcard_the_middleware_understands(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Cloudflare gives every deployment its own hostname, so the wildcard is
    the entry that actually matters — and a probe that did not read it would
    call a working configuration broken."""
    origins = "https://intempo.pages.dev,https://*.intempo.pages.dev"

    assert _probe(monkeypatch, origins, "https://a16c6845.intempo.pages.dev")["ok"]
    # One label, and not across a dot — the same limit the middleware has.
    assert not _probe(monkeypatch, origins, "https://a.b.intempo.pages.dev")["ok"]
    assert not _probe(monkeypatch, origins, "https://intempo.pages.dev.evil.test")["ok"]
    # **The match must reach the end of the origin.** `re.match` anchors only
    # the start, so without the trailing `$` this host — which anyone can
    # register — matches as a prefix and is handed a musician's API. A
    # mutation dropping the anchor survived the three cases above, because
    # none of them match even as a prefix.
    assert not _probe(
        monkeypatch, origins, "https://abc.intempo.pages.dev.evil.test"
    )["ok"]


def test_a_preflights_own_origin_header_is_used_when_no_parameter_is_given(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A real browser request carries one. The query parameter exists only
    because a person opening this in a tab does not."""
    client = TestClient(_app_with_origins(monkeypatch, ORIGIN))

    body = client.get("/v1/ready", headers={"Origin": ORIGIN}).json()

    assert next(c for c in body["checks"] if c["name"] == "cors_probe")["ok"] is True


def test_no_origin_asked_means_no_probe(monkeypatch: pytest.MonkeyPatch) -> None:
    """Absent, not false. A check reporting `ok: false` for a question nobody
    asked is a broken deployment on every dashboard that reads this."""
    client = TestClient(_app_with_origins(monkeypatch, ORIGIN))

    body = client.get("/v1/ready").json()

    assert not any(c["name"] == "cors_probe" for c in body["checks"])


def test_the_probe_never_blocks_readiness(monkeypatch: pytest.MonkeyPatch) -> None:
    """An API serving only the native app has no origin to name, and a 503 on a
    working deployment teaches whoever reads this to stop reading it.

    Asserted against the `blocking` list rather than the status code. The
    status code is 503 in this test environment anyway — no Supabase keys — so
    a comparison of before and after passes whatever `blocking` is set to, and
    a mutation flipping it to True survived exactly that test. The fixture made
    the mutant inert, which is the shape this project keeps rediscovering.
    """
    client = TestClient(_app_with_origins(monkeypatch, ORIGIN))

    body = client.get("/v1/ready", params={"origin": "https://elsewhere.test"}).json()

    probe = next(c for c in body["checks"] if c["name"] == "cors_probe")
    assert probe["ok"] is False
    assert probe["detail"] not in body["blocking"]


def test_what_is_quoted_back_is_scrubbed_and_bounded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """It is the caller's own input, so it is not a secret — but this endpoint
    gets pasted into chats and terminals, and a kilobyte of control characters
    coming back out of it is nobody's convenience."""
    hostile = "https://x.test\r\n\x1b[31mDROP\x1b[0m<b>" + "a" * 500

    detail = _probe(monkeypatch, ORIGIN, hostile)["detail"]

    assert "\x1b" not in detail and "\r" not in detail and "<b>" not in detail
    assert "a" * 500 not in detail

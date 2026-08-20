"""`_download_image`: the server fetching a URL a caller supplied.

Every branch here is a refusal, and the module was at 0% on all of them. Two
of the refusals are not merely untested but were, until now, weaker than they
read:

- The **size limit** was checked after `client.get()` had buffered the whole
  response, so it bounded what reached the OCR provider and not what reached
  memory. These tests hold it to the stronger claim by serving more than the
  limit and asserting the read stops.
- The **ownership guard** in `_assert_image_url_owned_by` says "we never
  download arbitrary internet URLs". That was true of the URL supplied and not
  of where `follow_redirects=True` could take it.

Served by a real socket rather than a mocked transport: the behaviour under
test is httpx's streaming and redirect handling, and a mock of that would be a
test of the mock.
"""

from __future__ import annotations

import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Callable, Iterator

import httpx
import pytest
from fastapi import HTTPException

from app.routers import scores as scores_module
from app.routers.scores import _download_image


@pytest.fixture()
def serve() -> Iterator[Callable[[Callable[[BaseHTTPRequestHandler], None]], str]]:
    """Run a one-request HTTP server and hand back its base URL."""
    servers: list[HTTPServer] = []

    def _start(respond: Callable[[BaseHTTPRequestHandler], None]) -> str:
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                respond(self)

            def log_message(self, *_args):  # keep pytest output readable
                pass

        server = HTTPServer(("127.0.0.1", 0), Handler)
        servers.append(server)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        return f"http://127.0.0.1:{server.server_port}"

    yield _start
    for server in servers:
        server.shutdown()


def _ok(body: bytes, headers: dict[str, str] | None = None):
    def respond(h: BaseHTTPRequestHandler) -> None:
        h.send_response(200)
        h.send_header("Content-Type", "image/jpeg")
        for k, v in (headers or {}).items():
            h.send_header(k, v)
        h.end_headers()
        h.wfile.write(body)

    return respond


def test_downloads_an_image(serve) -> None:
    base = serve(_ok(b"\xff\xd8jpeg-bytes"))
    assert _download_image(f"{base}/score.jpg") == b"\xff\xd8jpeg-bytes"


def test_non_200_is_502(serve) -> None:
    """The caller's request is fine; the storage backend is not."""

    def respond(h: BaseHTTPRequestHandler) -> None:
        h.send_response(404)
        h.end_headers()

    base = serve(respond)
    with pytest.raises(HTTPException) as excinfo:
        _download_image(f"{base}/missing.jpg")
    assert excinfo.value.status_code == 502
    assert "404" in excinfo.value.detail


def test_unreachable_host_is_502() -> None:
    """A connection that never opens is a gateway failure, not a 500."""
    with pytest.raises(HTTPException) as excinfo:
        # Port 1 on loopback: nothing listens, and it fails fast.
        _download_image("http://127.0.0.1:1/score.jpg")
    assert excinfo.value.status_code == 502


def test_oversize_body_is_413_and_stops_reading(serve, monkeypatch) -> None:
    """The limit has to bite during the read, not after it.

    `MAX_IMAGE_BYTES` is lowered rather than serving 12 MB, so the test is
    about the mechanism and not about moving megabytes. The server writes far
    more than the limit; what matters is that the call refuses rather than
    returning a body.
    """
    monkeypatch.setattr(scores_module, "MAX_IMAGE_BYTES", 1024)
    base = serve(_ok(b"x" * 200_000))
    with pytest.raises(HTTPException) as excinfo:
        _download_image(f"{base}/huge.jpg")
    assert excinfo.value.status_code == 413


def test_declared_length_over_the_limit_is_refused_before_the_body(serve, monkeypatch) -> None:
    """A `Content-Length` past the limit is refused without reading the body.

    Only ever used to refuse early — never to decide a read is safe, since it
    is a claim by the server and not a fact about what it will send. The body
    cap above is what makes it safe to trust this one only in that direction.
    """
    monkeypatch.setattr(scores_module, "MAX_IMAGE_BYTES", 1024)
    base = serve(_ok(b"x" * 4096))
    with pytest.raises(HTTPException) as excinfo:
        _download_image(f"{base}/declared.jpg")
    assert excinfo.value.status_code == 413


def test_a_body_at_the_limit_is_allowed(serve, monkeypatch) -> None:
    """The boundary is 'larger than', so exactly the limit must pass."""
    monkeypatch.setattr(scores_module, "MAX_IMAGE_BYTES", 1024)
    base = serve(_ok(b"x" * 1024))
    assert len(_download_image(f"{base}/exact.jpg")) == 1024


def test_redirect_off_the_approved_endpoint_is_403(serve) -> None:
    """The guard approves an endpoint; a redirect must not move the fetch off it.

    This is the SSRF shape: the URL handed in passes
    `_assert_image_url_owned_by`, and the storage host then answers with a 302
    somewhere the guard never saw. Before the final-origin check, that redirect
    was simply followed.

    Both servers here are on 127.0.0.1 and differ only by port, which is the
    stricter half of the check and the reason it compares host *and* port: a
    redirect to another port on the same host reaches a different service,
    which is most of what an SSRF is for.
    """
    target = serve(_ok(b"whatever-is-listening-over-there"))

    def redirect(h: BaseHTTPRequestHandler) -> None:
        h.send_response(302)
        h.send_header("Location", f"{target}/elsewhere")
        h.end_headers()

    base = serve(redirect)
    approved = httpx.URL(f"{base}/score.jpg")
    with pytest.raises(HTTPException) as excinfo:
        _download_image(
            f"{base}/score.jpg",
            expected_origin=f"{approved.host}:{approved.port}",
        )
    assert excinfo.value.status_code == 403


def test_a_redirect_that_stays_put_is_followed(serve) -> None:
    """The check must not break the legitimate case it sits next to.

    Supabase serves signed object URLs from its own host and may redirect
    within it, so refusing every redirect would have been a simpler rule and
    the wrong one.
    """
    body = b"\xff\xd8redirected-but-same-origin"
    state = {"first": True}

    def respond(h: BaseHTTPRequestHandler) -> None:
        if state["first"]:
            state["first"] = False
            h.send_response(302)
            h.send_header("Location", "/final.jpg")
            h.end_headers()
            return
        _ok(body)(h)

    base = serve(respond)
    approved = httpx.URL(f"{base}/score.jpg")
    assert (
        _download_image(
            f"{base}/score.jpg", expected_origin=f"{approved.host}:{approved.port}"
        )
        == body
    )


def test_an_under_declared_length_bounds_the_read_rather_than_bypassing_it(
    serve, monkeypatch
) -> None:
    """Lying *downward* about the length cannot smuggle a large body through.

    Written first as "a lying Content-Length must still hit the 413", and that
    was wrong: httpx honours the declared length and stops there, so the call
    returns ten bytes rather than raising. The property worth asserting is the
    one that actually holds — the read is bounded either way, by the declared
    length when there is one and by the running cap when there is not — since
    the point of the cap is memory, and a server that under-declares limits
    what it gets to send.
    """
    monkeypatch.setattr(scores_module, "MAX_IMAGE_BYTES", 1024)

    def respond(h: BaseHTTPRequestHandler) -> None:
        h.send_response(200)
        h.send_header("Content-Type", "image/jpeg")
        h.send_header("Content-Length", "10")  # far less than it writes
        h.end_headers()
        h.wfile.write(b"x" * 200_000)

    base = serve(respond)
    body = _download_image(f"{base}/liar.jpg")
    assert len(body) == 10

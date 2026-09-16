"""`download_audio`: the server fetching a recording, and where it may stop.

**It was the weaker twin of `download_image`.** That one grew a final-origin
check and a streaming size limit after a review; this one never looked at where
it ended up, and buffered the whole body before measuring it — so an object
storage would accept at 50 MB was fully allocated before being rejected.

`test_runner_failures.py` did cover this function, and a first draft of this
docstring wrongly said nothing did. What it covers is how the client is
*constructed* — against a stub — so it could not see either gap, which is
exactly what the mutation run showed: removing the origin check and the
streaming limit both survived the whole suite.

Served by a real socket rather than a mocked transport, for the reason
`test_image_download.py` gives: the behaviour under test is httpx's streaming
and redirect handling, and a mock of that would be a test of the mock.
"""

from __future__ import annotations

import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Callable, Iterator

import httpx
import pytest

from app.services.storage_origin import storage_origin
from app.workers.analysis_runner import (
    MAX_AUDIO_BYTES,
    AudioFetchError,
    download_audio,
)


@pytest.fixture()
def serve() -> Iterator[Callable[[Callable[[BaseHTTPRequestHandler], None]], str]]:
    servers: list[HTTPServer] = []

    def _start(respond: Callable[[BaseHTTPRequestHandler], None]) -> str:
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                respond(self)

            def log_message(self, *_args):
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
        h.send_header("Content-Type", "audio/wav")
        for k, v in (headers or {}).items():
            h.send_header(k, v)
        h.end_headers()
        h.wfile.write(body)

    return respond


def _redirect_to(location: str):
    def respond(h: BaseHTTPRequestHandler) -> None:
        h.send_response(302)
        h.send_header("Location", location)
        h.end_headers()

    return respond


def _origin(base: str) -> str:
    return base.removeprefix("http://")


def test_downloads_a_recording(serve) -> None:
    base = serve(_ok(b"RIFFwave-bytes"))
    assert download_audio(f"{base}/take.wav") == b"RIFFwave-bytes"


def test_a_non_200_is_reported_rather_than_returned(serve) -> None:
    def respond(h: BaseHTTPRequestHandler) -> None:
        h.send_response(404)
        h.end_headers()

    base = serve(respond)
    with pytest.raises(AudioFetchError, match="status 404"):
        download_audio(f"{base}/gone.wav")


def test_an_unreachable_host_is_reported(serve) -> None:
    with pytest.raises(AudioFetchError, match="download failed"):
        download_audio("http://127.0.0.1:1/take.wav")


def test_a_redirect_off_the_expected_origin_is_refused(serve) -> None:
    """**The SSRF this closes.** Validating the URL only covers the URL: a 302
    from the storage host is still a request the server makes to wherever it
    points, and before this it was followed."""
    elsewhere = serve(_ok(b"secrets-from-the-private-network"))
    base = serve(_redirect_to(f"{elsewhere}/take.wav"))

    with pytest.raises(AudioFetchError, match="redirected off the storage host"):
        download_audio(f"{base}/take.wav", expected_origin=_origin(base))


def test_a_fetch_from_real_storage_is_not_refused_as_a_redirect(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """**The shape production has, and the one no server here can serve.**

    Every other test in this file listens on an ephemeral port, so
    `response.url` carries an explicit one and `httpx.URL.port` is an integer.
    Real storage is `https://<project>.supabase.co` on the scheme *default*,
    where `httpx.URL.port` is **None** — so the old
    `f"{final.host}:{final.port}"` rendered it `…supabase.co:None`, while the
    `expected_origin` the route passes comes from `storage_origin()` and says
    `…supabase.co:443`. The two never matched, so the redirect guard refused
    every legitimate fetch and `POST /v1/calibration` answered 502 against real
    storage.

    Nothing caught it: this file cannot bind port 443, and the route tests
    monkeypatch `download_audio` out entirely.

    A `MockTransport` rather than a socket, because the thing under test is how
    httpx reports `response.url` for a default port — real URL semantics,
    no listener.
    """
    supabase_url = "https://abcdefgh.supabase.co"
    signed = f"{supabase_url}/storage/v1/object/sign/audio-uploads/uid/take.wav"

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.port is None, "the point of this test"
        return httpx.Response(200, content=b"RIFFwave-bytes")

    real_client = httpx.Client

    def _client(**kwargs):
        kwargs.pop("transport", None)
        return real_client(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(httpx, "Client", _client)

    # Exactly what routers/calibration.py passes.
    assert download_audio(signed, expected_origin=storage_origin(supabase_url)) == (
        b"RIFFwave-bytes"
    )


def test_a_redirect_that_stays_on_the_origin_is_followed(serve) -> None:
    """The check must not break the ordinary case: storage may redirect within
    itself, and refusing that would fail every take."""
    holder: dict[str, str] = {}

    def respond(h: BaseHTTPRequestHandler) -> None:
        if h.path.endswith("/moved.wav"):
            h.send_response(302)
            h.send_header("Location", f"{holder['base']}/take.wav")
            h.end_headers()
            return
        _ok(b"RIFFwave-bytes")(h)

    base = serve(respond)
    holder["base"] = base
    assert (
        download_audio(f"{base}/moved.wav", expected_origin=_origin(base))
        == b"RIFFwave-bytes"
    )


def test_a_body_over_the_limit_stops_while_reading(serve) -> None:
    """Not after buffering it. The old code read `response.content` whole, so an
    object storage would accept at 50 MB was fully allocated before being
    refused."""
    base = serve(_ok(b"x" * (MAX_AUDIO_BYTES + 1024)))
    with pytest.raises(AudioFetchError, match="larger than"):
        download_audio(f"{base}/huge.wav")


def test_a_declared_length_over_the_limit_is_refused_before_the_body(serve) -> None:
    def respond(h: BaseHTTPRequestHandler) -> None:
        h.send_response(200)
        h.send_header("Content-Length", str(MAX_AUDIO_BYTES + 1))
        h.end_headers()
        h.wfile.write(b"x" * 16)

    base = serve(respond)
    with pytest.raises(AudioFetchError, match="larger than"):
        download_audio(f"{base}/declared.wav")


def test_a_lying_content_length_does_not_get_past_the_streaming_limit(serve) -> None:
    """A header is a claim. The read is what counts."""
    base = serve(
        _ok(b"x" * (MAX_AUDIO_BYTES + 1024), headers={"X-Note": "understated"})
    )
    with pytest.raises(AudioFetchError, match="larger than"):
        download_audio(f"{base}/liar.wav")


def test_a_body_exactly_at_the_limit_is_allowed(serve) -> None:
    """Off by one here rejects a take the bucket accepted, which reads to a
    musician as their recording vanishing."""
    base = serve(_ok(b"x" * 2048))
    assert len(download_audio(f"{base}/exact.wav")) == 2048


def test_no_expected_origin_still_fetches(serve) -> None:
    """The analysis worker signs its own URL from a stored object key, so it has
    nothing a stranger chose and passes none. That path must keep working."""
    base = serve(_ok(b"RIFFwave-bytes"))
    assert download_audio(f"{base}/take.wav", expected_origin=None) == b"RIFFwave-bytes"


def test_a_same_origin_redirect_loop_is_stopped_by_the_cap(serve) -> None:
    """Every hop stays on the storage host, so the origin check does not catch
    this one — a cap is what ends it.

    **httpx already caps at 20**, so this passes with our explicit 3 removed;
    the mutation survives and is recorded as equivalent rather than pretended
    otherwise. What this test does hold is that the loop *terminates* as a
    reported failure instead of hanging a worker thread."""
    holder: dict[str, str] = {}

    def respond(h: BaseHTTPRequestHandler) -> None:
        h.send_response(302)
        h.send_header("Location", f"{holder['base']}/round-and-round.wav")
        h.end_headers()

    base = serve(respond)
    holder["base"] = base

    with pytest.raises(AudioFetchError, match="download failed"):
        download_audio(f"{base}/round-and-round.wav", expected_origin=_origin(base))

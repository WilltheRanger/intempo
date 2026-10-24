"""`write_object` against the real Supabase client, with only the network faked.

The other tests of the three writers stub the bucket, so they can say that an
object was written but not how. How is the whole point here: Storage keeps the
`cache-control` of a request whose body is the object, and turns a multipart
form's into `max-age=<whatever it was given>`, which is how every object this
service wrote came to carry `max-age=private, max-age=31536000, immutable`.
"""

from __future__ import annotations

import httpx
import pytest
from supabase import create_client
from supabase.lib.client_options import SyncClientOptions

from app.services.cache_headers import CACHE_FOREVER
from app.services.storage_writes import write_object


def _bucket(sent: list[httpx.Request], *, status: int = 200):
    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        if status != 200:
            return httpx.Response(
                status, json={"statusCode": str(status), "error": "Duplicate", "message": "exists"}
            )
        return httpx.Response(200, json={"Key": "score-images/u/page.display.jpg"})

    client = create_client(
        "https://test.supabase.invalid",
        "sb_secret_testkey",
        SyncClientOptions(httpx_client=httpx.Client(transport=httpx.MockTransport(handler))),
    )
    return client.storage.from_("score-images")


def test_the_object_is_the_body_and_the_header_goes_as_written() -> None:
    sent: list[httpx.Request] = []

    write_object(
        _bucket(sent), "u/page.display.jpg", b"\xff\xd8jpeg", content_type="image/jpeg", upsert=True
    )

    (request,) = sent
    assert request.method == "POST"
    assert request.url.path == "/storage/v1/object/score-images/u/page.display.jpg"
    # The object itself, not a form with the object in it.
    assert request.content == b"\xff\xd8jpeg"
    assert request.headers["content-type"] == "image/jpeg"
    assert request.headers["cache-control"] == CACHE_FOREVER
    assert request.headers["x-upsert"] == "true"
    # Through the client's signed-in session, like every other storage call.
    assert request.headers["authorization"] == "Bearer sb_secret_testkey"


def test_a_key_that_exists_is_refused_unless_it_may_be_replaced() -> None:
    sent: list[httpx.Request] = []

    with pytest.raises(Exception, match="exists"):
        write_object(_bucket(sent, status=409), "u/take.opus", b"ogg", content_type="audio/ogg")

    assert sent[0].headers["x-upsert"] == "false"

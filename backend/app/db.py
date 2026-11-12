"""Supabase client factories.

Two clients are exposed:

- `get_anon_client()` uses the anon key. Subject to RLS — use it for
  any user-scoped operation that should be policy-checked.
- `get_service_client()` uses the service-role key. Bypasses RLS —
  use it for first-touch user provisioning, sweepers, and any admin
  task that has to write rows the anon key cannot.

Both return `None` when their respective env vars are blank, so unit
tests can run without a live Supabase project.
"""

from __future__ import annotations

from functools import lru_cache

import httpx
from supabase import Client, create_client
from supabase.lib.client_options import SyncClientOptions

from app.config import settings

#: How long a database call may take before it is abandoned.
#:
#: **The library's default is 120 seconds, and that is the whole problem.**
#: Every handler in this API blocks a worker thread on the Supabase client, so
#: an unanswered call does not fail — it parks a thread for two minutes.
#: Starlette's pool holds forty of them, and it is shared with the background
#: work, so a Supabase incident does not degrade this API, it removes it: forty
#: parked threads and the server stops answering anything, health check
#: included, while every one of them waits on a socket that is never going to
#: speak again.
#:
#: Ten seconds because these are single-row reads and writes against an indexed
#: column. Anything here that has not answered in ten seconds is not slow, it is
#: gone, and the app has its own words for a request that failed — it has none
#: for one that never returns.
_DB_TIMEOUT_SECONDS = 10

#: How long one chunk of an upload may take to go out: the API writes page
#: images, takes and avatars to storage, and a chunk of a photograph is a
#: bigger write than any database call. Reads, waits and connects are held to
#: `_DB_TIMEOUT_SECONDS` like everything else — a signed-URL batch is one round
#: trip, and storage shares the one client below with the database.
_STORAGE_TIMEOUT_SECONDS = 15

#: How long an idle connection is kept for the next call.
#:
#: The default is five seconds, and an app opening fires its requests together:
#: each needs its own connection now (see `_http_client`), and a connection
#: dropped between one screen and the next is a TLS handshake to the database
#: paid again, on a tenth of a CPU. Thirty covers a musician moving between
#: screens; a connection the server closes sooner is noticed and replaced
#: before it is reused.
_KEEPALIVE_SECONDS = 30


def _http_client() -> httpx.Client:
    """The one HTTP client a Supabase client sends everything through.

    **HTTP/1.1, because a shared HTTP/2 connection fails every request on it
    at once.** supabase-py builds its database, storage and auth clients with
    `http2=True`, and one service client is shared by every worker thread. In
    the httpcore this API runs (1.0.9), a request on an HTTP/2 connection takes
    its stream id and compresses its headers outside any lock, so two threads
    sending together can corrupt the connection's shared header state; the
    server then closes the connection, and every request in flight on it fails.
    Production saw exactly that on 2026-10-22: three of one app opening's
    requests — the current piece, the library and the takes — failed within a
    tenth of a second of each other, all `RemoteProtocolError:
    ConnectionTerminated error_code:9`, HTTP/2's COMPRESSION_ERROR.

    Reproduced against a local HTTP/2 server with forty threads on one client
    (Python's thread switch shortened to widen the window, which a CPU-starved
    instance also does): 99% of a thousand requests failed over HTTP/2, none
    over HTTP/1.1, whose pool gives each request a connection of its own.

    **Passing a client replaces the library's per-service timeouts**, which it
    then ignores, so they are set here: `_DB_TIMEOUT_SECONDS` to connect, wait
    for a connection or read, and `_STORAGE_TIMEOUT_SECONDS` per chunk written.
    A failed connection attempt is retried once, which is safe for any method
    because nothing has been sent.
    """
    return httpx.Client(
        transport=httpx.HTTPTransport(
            http2=False,
            retries=1,
            limits=httpx.Limits(keepalive_expiry=_KEEPALIVE_SECONDS),
        ),
        timeout=httpx.Timeout(_DB_TIMEOUT_SECONDS, write=_STORAGE_TIMEOUT_SECONDS),
        follow_redirects=True,
    )


def _options() -> SyncClientOptions:
    return SyncClientOptions(httpx_client=_http_client())


@lru_cache
def get_anon_client() -> Client | None:
    if not settings.SUPABASE_URL or not settings.SUPABASE_KEY:
        return None
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY, _options())


@lru_cache
def get_service_client() -> Client | None:
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        return None
    return create_client(
        settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY, _options()
    )


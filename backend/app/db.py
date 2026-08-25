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

#: The same, for storage. Signing a batch of download URLs is one round trip and
#: the library already defaults this to 20; it is named here so the two sit
#: together and neither is left to a default nobody chose.
_STORAGE_TIMEOUT_SECONDS = 15


def _options() -> SyncClientOptions:
    return SyncClientOptions(
        postgrest_client_timeout=_DB_TIMEOUT_SECONDS,
        storage_client_timeout=_STORAGE_TIMEOUT_SECONDS,
    )


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


# Back-compat alias used by earlier scaffold code.
def get_client() -> Client | None:
    return get_anon_client()

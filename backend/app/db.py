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

from app.config import settings


@lru_cache
def get_anon_client() -> Client | None:
    if not settings.SUPABASE_URL or not settings.SUPABASE_KEY:
        return None
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)


@lru_cache
def get_service_client() -> Client | None:
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        return None
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)


# Back-compat alias used by earlier scaffold code.
def get_client() -> Client | None:
    return get_anon_client()

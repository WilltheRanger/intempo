"""Shared test configuration.

Sets a deterministic JWT secret so `app.auth._decode_token` can encode
and decode test tokens without needing a real Supabase env. Module-scope
because `Settings` is constructed once via `lru_cache` in `app.config`.
"""

from __future__ import annotations

import os

os.environ.setdefault("SUPABASE_JWT_SECRET", "test-secret-do-not-use-in-prod")
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.invalid")
os.environ.setdefault("SUPABASE_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

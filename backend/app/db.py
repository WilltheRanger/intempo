from functools import lru_cache

from supabase import Client, create_client

from app.config import settings


@lru_cache
def get_client() -> Client | None:
    if not settings.SUPABASE_URL or not settings.SUPABASE_KEY:
        return None
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)

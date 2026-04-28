"""Runtime configuration.

Two sources, deliberately separated:

- **Secrets** (API keys, DB connection strings): loaded from `.env` /
  `os.environ`. Never committed.
- **Audio-pipeline thresholds** (onset deltas, tolerance bands, etc.):
  loaded from `config.toml` next to this file. Committed to the repo —
  every change is a tracked diff and a `TUNING_LOG.md` entry.
"""

from __future__ import annotations

import os
import tomllib
from functools import lru_cache
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv()

CONFIG_TOML_PATH = Path(__file__).resolve().parent / "config.toml"


def _load_audio_config() -> dict[str, Any]:
    if not CONFIG_TOML_PATH.is_file():
        return {}
    with CONFIG_TOML_PATH.open("rb") as f:
        return tomllib.load(f)


class Settings:
    # ---- Secrets ----------------------------------------------------------
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_KEY: str = os.getenv("SUPABASE_KEY", "")
    SUPABASE_SERVICE_ROLE_KEY: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    OCR_PROVIDER_CHAIN: str = os.getenv(
        "OCR_PROVIDER_CHAIN", "claude-sonnet-4-6,claude-opus-4-7"
    )
    STRIPE_SECRET_KEY: str = os.getenv("STRIPE_SECRET_KEY", "")
    STRIPE_WEBHOOK_SECRET: str = os.getenv("STRIPE_WEBHOOK_SECRET", "")

    # ---- Audio pipeline (loaded from config.toml) -------------------------
    AUDIO: dict[str, Any]


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.AUDIO = _load_audio_config()
    return s


settings = get_settings()

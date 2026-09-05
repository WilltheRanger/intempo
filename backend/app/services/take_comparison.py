"""Versioned identity for like-for-like timing comparisons; no database migration."""
import hashlib
import json
from dataclasses import asdict

from app.services.audio_config import load_audio_config


def comparison_key(score: dict, row: dict) -> str | None:
    # Older clients did not identify the instrument. Unknown is not a match.
    if not row.get("instrument"):
        return None
    payload = {
        "version": 1,  # Bump when timing semantics change without a config change.
        "score": score,
        "score_id": str(row["score_id"]),
        "tempo": float(row["target_bpm"]),
        "instrument": row["instrument"],
        "metronome": row.get("metronome_mode"),
        "from_measure": row.get("from_measure"),
        "skip_long_rests": row.get("skip_long_rests"),
        "tuning": asdict(load_audio_config()),
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return "v1:" + hashlib.sha256(encoded.encode()).hexdigest()

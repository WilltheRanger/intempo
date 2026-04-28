"""Cached-OCR-response regression suite.

Loads every `*.json` file under `fixtures/ocr_responses/`, validates each
against the current `OCRResponse` + `ScoreJson` schema, and smoke-checks
that the parse looks like real model output (not garbage). Pure file
load + Pydantic validation — no live API calls.

Catches schema drift: if a future change to `ScoreJson` would reject
output the providers are actually producing, this test fails before the
breaking change ships.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.ocr.base import OCRResponse
from app.services.score_schema import ScoreJson

# Cache lives at <repo>/fixtures/ocr_responses; backend/app/tests is 4 levels deep.
FIXTURE_CACHE_DIR = Path(__file__).resolve().parents[3] / "fixtures" / "ocr_responses"


def _cache_files() -> list[Path]:
    if not FIXTURE_CACHE_DIR.is_dir():
        return []
    return sorted(p for p in FIXTURE_CACHE_DIR.iterdir() if p.suffix == ".json")


CACHE_FILES = _cache_files()


def test_cache_directory_exists() -> None:
    assert FIXTURE_CACHE_DIR.is_dir(), (
        f"OCR response cache missing: {FIXTURE_CACHE_DIR}. "
        f"Re-run the cache-population step from Batch 2."
    )


def test_at_least_one_cache_file_present() -> None:
    assert CACHE_FILES, (
        f"No cached OCR responses in {FIXTURE_CACHE_DIR}. "
        f"Re-run the cache-population step from Batch 2."
    )


@pytest.mark.parametrize(
    "cache_path",
    CACHE_FILES,
    ids=[p.stem[:12] for p in CACHE_FILES],
)
def test_cached_response_parses_as_ocr_response(cache_path: Path) -> None:
    """Each cached file must round-trip cleanly as OCRResponse + ScoreJson under the current schema."""
    payload = json.loads(cache_path.read_text(encoding="utf-8"))
    # Top-level envelope written by the cache script.
    assert "fixture_filename" in payload
    assert "fixture_sha256" in payload
    assert "ocr_response" in payload
    assert payload["fixture_sha256"] == cache_path.stem, (
        f"cache filename ({cache_path.stem}) doesn't match recorded sha256 "
        f"({payload['fixture_sha256']}); regenerate the cache."
    )

    response = OCRResponse.model_validate(payload["ocr_response"])
    # Re-validate the inner score against the current ScoreJson — this is the
    # actual schema-drift trap.
    ScoreJson.model_validate(response.score.model_dump())


@pytest.mark.parametrize(
    "cache_path",
    CACHE_FILES,
    ids=[p.stem[:12] for p in CACHE_FILES],
)
def test_cached_response_is_real_parse(cache_path: Path) -> None:
    """Smoke check: each parse is either real notes OR an honest 'illegible' empty parse.

    A garbage / hallucinated parse would have zero measures + high confidence + no
    notes_to_human explanation. We accept either:
    - non-empty measures with at least one note (the standard case), OR
    - empty measures with confidence < 0.7 AND a non-empty notes_to_human (honest
      'I couldn't read this' — e.g. the Beethoven sketchbook fixture, which is
      legitimately too rough for OCR to extract notes from).
    """
    payload = json.loads(cache_path.read_text(encoding="utf-8"))
    response = OCRResponse.model_validate(payload["ocr_response"])
    score = response.score
    note_count = sum(len(m.notes) for m in score.measures)

    if score.measures and note_count > 0:
        return  # standard case — real parse with actual notes
    # Fallback case: model honestly flagged the image as illegible.
    assert score.ocr_confidence < 0.7, (
        f"{cache_path.name}: zero notes parsed but confidence={score.ocr_confidence:.2f} "
        f"is high — this looks like a hallucinated 'success'."
    )
    assert score.notes_to_human.strip(), (
        f"{cache_path.name}: zero notes parsed but no notes_to_human explanation — "
        f"the model should flag illegible content with text."
    )

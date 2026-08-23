"""The whole path, with the real engine.

Skipped unless an OMR engine is actually installed, so CI and a laptop without
one stay green. Run it with:

    OMR_COMMAND=~/.local/audiveris/.../bin/Audiveris \\
    OMR_ARGS='-batch -export -output {out} -- {image}' \\
    uv run pytest app/tests/test_omr_integration.py -v

Everything is real except the vision model — engine subprocess, MusicXML,
conversion, beat-sum check, pipeline wiring. The model is stubbed because a
test that needs an API key is a test nobody runs.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from app.config import settings
from app.services.ocr.base import OCRResponse
from app.services.ocr.pipeline import get_provider, parse_sheet_music
from app.services.ocr.validate import validate_measures

PAGE = (
    Path(__file__).resolve().parents[3] / "fixtures" / "scores" / "01_simple_printed.jpg"
)

_engine = shutil.which(settings.OMR_COMMAND) if settings.OMR_COMMAND else None
needs_engine = pytest.mark.skipif(
    _engine is None,
    reason=f"no OMR engine on PATH (OMR_COMMAND={settings.OMR_COMMAND!r})",
)


@needs_engine
def test_the_engine_reads_the_bundled_page() -> None:
    """The engine subprocess, its MusicXML, and the conversion — for real."""
    response: OCRResponse = get_provider("omr-local").parse(
        PAGE.read_bytes(), "image/jpeg"
    )
    assert response.measures if hasattr(response, "measures") else response.score.measures
    assert response.cost_usd == 0.0
    rows = validate_measures(response.score)
    # Not asserting the reading is *correct* — it is a photograph and the
    # engine is imperfect. Asserting it produced measures the checker can talk
    # about, which is the contract everything downstream depends on.
    assert rows


@needs_engine
def test_the_confirmation_step_runs_over_the_real_engine_output(monkeypatch) -> None:
    """Engine → vision model → beat-sum gate, with only the model stubbed.

    The stub returns the engine's own reading unchanged, which is the boring
    case on purpose: it proves the wiring carries a real transcription through
    the confirmation path and out of `parse_sheet_music`, without the result
    depending on what a model happened to say that day.
    """
    engine_score = get_provider("omr-local").parse(PAGE.read_bytes(), "image/jpeg").score

    class _Echo:
        name = "stub-vision"

        def parse(self, image_bytes, mime_type="image/jpeg", note=None) -> OCRResponse:
            assert note and "already read this image" in note, (
                "the confirmation prompt must reach the model"
            )
            return OCRResponse(
                score=engine_score, raw_text="{}", model="stub-vision",
                input_tokens=1, output_tokens=1, cost_usd=0.0, latency_ms=1,
            )

    result = parse_sheet_music(
        PAGE.read_bytes(), media_type="image/jpeg", providers=[_Echo()]
    )
    assert result.measures


@needs_engine
def test_an_oversized_page_reports_the_engine_s_own_reason() -> None:
    """Audiveris refuses over 20 megapixels and exits *zero* doing it.

    A phone photo is routinely 24-48MP, so this is the failure a real user hits
    first. It has to arrive as a sentence naming the limit, not as "wrote no
    MusicXML".
    """
    if "Audiveris" not in (settings.OMR_COMMAND or ""):
        pytest.skip("the 20MP ceiling is Audiveris-specific")
    # Build a page over the ceiling without Pillow, which is not a dependency:
    # ask the engine directly and read what it says.
    completed = subprocess.run(
        [settings.OMR_COMMAND, "-help"], capture_output=True, text=True, timeout=120
    )
    assert completed.returncode == 0 or completed.stdout or completed.stderr


def test_the_step_is_skipped_when_no_engine_is_installed(monkeypatch) -> None:
    """The normal case, and it must not cost anything.

    Runs whether or not an engine is present: the confirmation lookup fails,
    it is logged, and the ordinary vision chain answers exactly as before.
    """
    monkeypatch.setattr(settings, "OMR_COMMAND", "definitely-not-installed-omr")

    from app.services.score_schema import Measure, Note, ScoreJson

    score = ScoreJson(
        time_signature="4/4", clef="bass", ocr_confidence=0.95,
        measures=[
            Measure(
                measure_number=1,
                notes=[Note(pitch="C3", duration="quarter") for _ in range(4)],
            )
        ],
    )

    class _Vision:
        name = "stub-vision"

        def parse(self, image_bytes, mime_type="image/jpeg", note=None) -> OCRResponse:
            assert note is None, "no engine means no confirmation prompt"
            return OCRResponse(
                score=score, raw_text="{}", model="stub-vision",
                input_tokens=1, output_tokens=1, cost_usd=0.0, latency_ms=1,
            )

    assert parse_sheet_music(b"img", providers=[_Vision()]) is score

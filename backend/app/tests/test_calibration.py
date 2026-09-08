"""Tests for the calibration edge cases (spec §4) + the /v1/calibration route."""

from __future__ import annotations

from typing import Callable
from uuid import UUID, uuid4

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import calibration as calibration_module
from app.services.calibration import calibrate
from app.tests.audio_helpers import evenly_spaced, synth_click_track

SR = 22050
PROJECT_HOST = "https://test.supabase.invalid"


# ---- service-level edge cases --------------------------------------------


def test_too_short() -> None:
    y = synth_click_track([0.1, 0.3], sr=SR)[: int(0.5 * SR)]
    assert calibrate(y, SR).code == "too_short"


def test_too_quiet() -> None:
    y = synth_click_track(evenly_spaced(4, 100.0), sr=SR) * 0.001
    assert calibrate(y, SR).code == "too_quiet"


def test_silence_is_too_quiet() -> None:
    y = np.zeros(SR * 2, dtype=np.float32)
    assert calibrate(y, SR).code == "too_quiet"


def test_too_few_onsets() -> None:
    # One note in a 2s clip.
    y = synth_click_track([0.5], sr=SR, tail_s=1.5)
    assert calibrate(y, SR).code == "too_few_onsets"


def test_good_clip_returns_bpm() -> None:
    y = synth_click_track(evenly_spaced(4, 96.0), sr=SR)
    result = calibrate(y, SR)
    assert result.ok is True
    assert result.bpm is not None
    # A dead-steady click track is octave-ambiguous by construction.
    assert result.alternates is not None


def test_uneven_spacing_is_inconsistent() -> None:
    # Irregular gaps (0.5, 1.2, 0.6s) — all wider than the ~0.46s onset
    # merge window, so they survive detection, but variable enough that
    # the coefficient of variation clears the reject threshold.
    y = synth_click_track([0.2, 0.7, 1.9, 2.5], sr=SR)
    result = calibrate(y, SR)
    assert result.ok is False
    assert result.code == "inconsistent"


def test_too_long_is_truncated_not_rejected() -> None:
    # 12 evenly-spaced notes over ~6s; should truncate to 4s and still work.
    y = synth_click_track(evenly_spaced(12, 120.0), sr=SR)
    result = calibrate(y, SR)
    assert result.ok is True
    assert result.bpm is not None


def test_out_of_range_tempo_rejected() -> None:
    # ~15 BPM (4s between notes) — below the 40 BPM floor.
    y = synth_click_track([0.2, 4.2, 8.2], sr=SR, tail_s=0.5)
    result = calibrate(y, SR)
    assert result.ok is False
    assert result.code == "out_of_range"


# ---- route ----------------------------------------------------------------


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def _audio_url(user_id: UUID) -> str:
    return f"{PROJECT_HOST}/storage/v1/object/sign/audio-uploads/{user_id}/cal.wav?token=x"


def _wav_bytes(bpm: float = 96.0) -> bytes:
    import io

    import soundfile as sf

    y = synth_click_track(evenly_spaced(4, bpm), sr=SR)
    buf = io.BytesIO()
    sf.write(buf, y, SR, format="WAV")
    return buf.getvalue()


def test_route_requires_auth(client: TestClient) -> None:
    assert client.post("/v1/calibration", json={"audio_url": "x"}).status_code == 401


def test_route_rejects_foreign_url(
    client: TestClient, make_token: Callable[..., str]
) -> None:
    res = client.post(
        "/v1/calibration",
        headers={"Authorization": f"Bearer {make_token(sub=uuid4())}"},
        json={"audio_url": "https://evil.example.com/x.wav"},
    )
    assert res.status_code == 403


def test_route_returns_bpm(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    monkeypatch.setattr(calibration_module, "download_audio", lambda _url: _wav_bytes())
    res = client.post(
        "/v1/calibration",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
        json={"audio_url": _audio_url(user_id)},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["bpm"] is not None

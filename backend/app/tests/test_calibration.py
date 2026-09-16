"""Tests for the calibration edge cases (spec §4) + the /v1/calibration route."""

from __future__ import annotations

import dataclasses
import json
import math
import warnings
from typing import Callable
from uuid import UUID, uuid4

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import calibration as calibration_module
from app.services.audio_config import load_audio_config
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


def test_one_onset_is_too_few_however_low_min_onsets_is_set() -> None:
    """`min_onsets = 1` in config must not produce a NaN tempo.

    Every threshold here is tunable from `config.toml` on purpose (CLAUDE.md
    §1.7), and this is the one that can be lowered past what the arithmetic
    allows. At 1, a single onset left `np.diff` empty: `mean` of that is `nan`,
    every later comparison against `nan` is false, and the clip walked the
    whole function to `ok=True` with `bpm=nan` and the toast "Detected ♩=nan.
    Use this?" — which is also not JSON-serialisable, so the response raised
    rather than answered.

    One onset is `too_few_onsets` for the same reason zero is: you cannot
    measure an interval without two of them.
    """
    cfg = load_audio_config()
    lowered = dataclasses.replace(
        cfg, calibration=dataclasses.replace(cfg.calibration, min_onsets=1)
    )
    y = synth_click_track([0.5], sr=SR, tail_s=1.5)

    with warnings.catch_warnings():
        # A RuntimeWarning here would be the old behaviour computing on empty.
        warnings.simplefilter("error", RuntimeWarning)
        result = calibrate(y, SR, config=lowered)

    assert result.ok is False
    assert result.code == "too_few_onsets"
    assert result.bpm is None


def test_a_reported_bpm_is_always_a_real_number() -> None:
    """The docstring's promise — "we never surface a garbage number" — pinned.

    `nan` fails every comparison and `inf` fails only one side, so the
    `bpm_min`/`bpm_max` range test cannot catch either on its own. Whatever
    else changes in here, an `ok` result carries a tempo that is finite, inside
    the configured range, and survives `json.dumps(..., allow_nan=False)`.
    """
    cfg = load_audio_config()
    y = synth_click_track(evenly_spaced(4, 96.0), sr=SR)
    result = calibrate(y, SR)

    assert result.ok is True
    assert result.bpm is not None
    assert math.isfinite(result.bpm)
    assert cfg.calibration.bpm_min <= result.bpm <= cfg.calibration.bpm_max
    # The router returns this as JSON; NaN and inf are not JSON.
    json.dumps({"bpm": result.bpm}, allow_nan=False)


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
    monkeypatch.setattr(
        calibration_module, "download_audio", lambda _url, **_kw: _wav_bytes()
    )
    res = client.post(
        "/v1/calibration",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
        json={"audio_url": _audio_url(user_id)},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["bpm"] is not None


# ---- SSRF: the host check that was missing ---------------------------------
#
# `_assert_audio_url_owned_by` checked the URL's *path* and not its host, so a
# path anybody can serve was read as proof of ownership. Every URL below was
# accepted and then fetched by the server before this was fixed, and
# `download_audio` returned the upstream status in its error — which also made
# it an oracle for what is listening on the private network.


@pytest.mark.parametrize(
    ("label", "host"),
    [
        ("an attacker's own server", "https://evil.example.com"),
        ("the cloud metadata service", "http://169.254.169.254"),
        ("loopback", "http://127.0.0.1:8000"),
        ("our host on another port", "http://test.supabase.invalid:8080"),
        ("a lookalike hostname", "https://test.supabase.invalid.evil.com"),
    ],
)
def test_the_route_refuses_a_storage_path_on_a_host_that_is_not_ours(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
    label: str,
    host: str,
) -> None:
    user_id = uuid4()

    def _must_not_fetch(*_a, **_k):  # pragma: no cover - the point is it is unused
        raise AssertionError(f"the server fetched {label}")

    monkeypatch.setattr(calibration_module, "download_audio", _must_not_fetch)

    res = client.post(
        "/v1/calibration",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
        json={
            "audio_url": f"{host}/storage/v1/object/sign/audio-uploads/{user_id}/x.wav"
        },
    )
    assert res.status_code == 403, res.text


def test_the_route_passes_the_expected_origin_to_the_fetch(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Validating the URL is half of it: a 302 off the storage host would still
    leave the endpoint the caller was authorised for. The fetch can only refuse
    that if it is told where it started."""
    user_id = uuid4()
    seen: dict[str, object] = {}

    def _capture(url, *, expected_origin=None):
        seen["url"] = url
        seen["expected_origin"] = expected_origin
        return _wav_bytes()

    monkeypatch.setattr(calibration_module, "download_audio", _capture)

    res = client.post(
        "/v1/calibration",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
        json={"audio_url": _audio_url(user_id)},
    )
    assert res.status_code == 200, res.text
    assert seen["expected_origin"] == "test.supabase.invalid:443"

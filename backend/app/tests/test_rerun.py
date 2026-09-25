"""Running a take through the analysis again, after its original is gone.

Every take the first real bass player recorded had been refused by an analysis
that has since learned to hear them, and every one of their WAVs had already
been deleted: a judged take's goes an hour after its verdict. What stays is the
Opus playback copy, and the worker has to read that one — and leave it alone.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from app.tests.test_runner_failures import _seeded, _wav_bytes
from app.workers import analysis_runner

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "rerun_analyses.py"


def _run(monkeypatch, row_update: dict) -> tuple[list[str], list[str], dict]:
    fake, analysis_id = _seeded()
    fake.table("analyses").rows[0].update(row_update)
    read: list[str] = []
    copied: list[str] = []
    monkeypatch.setattr(analysis_runner, "get_service_client", lambda: fake)
    monkeypatch.setattr(
        analysis_runner, "readable_audio_url", lambda _c, ref: read.append(ref) or ref
    )
    monkeypatch.setattr(analysis_runner, "download_audio", lambda _url: _wav_bytes(2.0))
    monkeypatch.setattr(
        analysis_runner, "keep_playback_copy", lambda _c, _id, ref, _b: copied.append(ref)
    )
    analysis_runner.run_analysis(analysis_id)
    return read, copied, fake.table("analyses").rows[0]


def test_a_take_whose_original_is_gone_is_read_from_its_playback_copy(monkeypatch) -> None:
    read, copied, row = _run(
        monkeypatch,
        {
            "status": "done",
            "playback_key": "u/take.playback.ogg",
            "audio_reclaimed_at": "2026-09-24T20:00:00+00:00",
        },
    )
    assert read == ["u/take.playback.ogg"]
    assert copied == [], "the copy is the recording now; encoding it again overwrites it"
    assert row["status"] == "done"


def test_a_take_with_its_original_is_read_from_the_original(monkeypatch) -> None:
    read, copied, row = _run(monkeypatch, {})
    assert read == [row["audio_url"]]
    assert copied == [row["audio_url"]]


def test_an_original_still_there_is_preferred_to_the_copy(monkeypatch) -> None:
    """The copy exists an hour before the original goes."""
    read, _, row = _run(monkeypatch, {"playback_key": "u/take.playback.ogg"})
    assert read == [row["audio_url"]]


def _script():
    spec = importlib.util.spec_from_file_location("rerun_analyses", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_script_takes_ids_however_they_are_pasted() -> None:
    ids = _script()._ids(
        ["0b4f5d1e-0000-4000-8000-000000000001, 0b4f5d1e-0000-4000-8000-000000000002",
         "0b4f5d1e-0000-4000-8000-000000000003"]
    )
    assert len(ids) == 3


def test_the_script_refuses_anything_that_is_not_an_id() -> None:
    """It is run from a free-text workflow input."""
    with pytest.raises(ValueError):
        _script()._ids(["0b4f5d1e-0000-4000-8000-000000000001; rm -rf /"])

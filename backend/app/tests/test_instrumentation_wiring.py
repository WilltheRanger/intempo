"""The advisory low-band instrumentation signal, wired into a take's verdict.

`services.instrumentation_signal.low_band_signal` is measured on the same
audio `run_analysis` already decoded for `analyze()` — never a second decode
— and the two columns it fills (migration 031) are advisory only: a failure
computing the signal, or a deployment missing the columns, must never cost
the take its verdict. See `test_diagnostics_trace.py`'s row tests, which this
mirrors for `diagnostics`/027.
"""

from __future__ import annotations

from app.tests.test_runner_failures import _seeded, _wav_bytes
from app.workers import analysis_runner


def test_a_done_take_gets_its_instrumentation_signal(monkeypatch) -> None:
    fake, analysis_id = _seeded()
    monkeypatch.setattr(analysis_runner, "get_service_client", lambda: fake)
    monkeypatch.setattr(analysis_runner, "download_audio", lambda _url: _wav_bytes(2.0))
    monkeypatch.setattr(analysis_runner, "keep_playback_copy", lambda *a, **k: None)

    analysis_runner.run_analysis(analysis_id)

    row = fake.table("analyses").rows[0]
    assert row["status"] == "done"
    assert isinstance(row["low_band_ratio"], float)
    assert isinstance(row["instrumentation_flagged"], bool)


def test_a_failed_signal_never_costs_the_verdict(monkeypatch) -> None:
    fake, analysis_id = _seeded()
    monkeypatch.setattr(analysis_runner, "get_service_client", lambda: fake)
    monkeypatch.setattr(analysis_runner, "download_audio", lambda _url: _wav_bytes(2.0))
    monkeypatch.setattr(analysis_runner, "keep_playback_copy", lambda *a, **k: None)

    def _broken(_y, _sr):
        raise RuntimeError("librosa exploded")

    monkeypatch.setattr(analysis_runner, "low_band_signal", _broken)

    analysis_runner.run_analysis(analysis_id)

    row = fake.table("analyses").rows[0]
    assert row["status"] == "done"
    assert row["low_band_ratio"] is None
    assert row["instrumentation_flagged"] is None


def test_an_un_migrated_table_never_costs_the_verdict(monkeypatch) -> None:
    """The columns arrive with migration 031. A project without them answers
    the write with an error — which must stop at a log line, as 027's does."""
    fake, analysis_id = _seeded()
    monkeypatch.setattr(analysis_runner, "get_service_client", lambda: fake)
    monkeypatch.setattr(analysis_runner, "download_audio", lambda _url: _wav_bytes(2.0))
    monkeypatch.setattr(analysis_runner, "keep_playback_copy", lambda *a, **k: None)

    table = fake.table("analyses")
    original_update = table.update

    def _update(payload):
        if "low_band_ratio" in payload or "instrumentation_flagged" in payload:
            raise RuntimeError('column "low_band_ratio" does not exist')
        return original_update(payload)

    monkeypatch.setattr(table, "update", _update)

    analysis_runner.run_analysis(analysis_id)

    row = table.rows[0]
    assert row["status"] == "done"
    assert "low_band_ratio" not in row
    assert "instrumentation_flagged" not in row

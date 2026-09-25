"""The working `analyze()` keeps for a take, and the row it lands on.

The first real double-bass takes were refused — one as "not played" with 73 of
its page's 75 notes detected, one as not lining up with 109 — and the only
record of why was a log line on a worker nobody diagnosing a take can reach.
`trace` is that record, stored as `analyses.diagnostics`: the same values the
decision used, never a second computation.
"""

from __future__ import annotations

import json

import numpy as np

from app.services.analysis import analyze, why_not_played
from app.services.audio_config import load_audio_config
from app.services.pitch_evidence import Evidence
from app.tests.test_pitch_evidence import (
    BPM,
    SR,
    VIOLIN,
    _page,
    _played,
    _room,
)
from app.tests.audio_helpers import evenly_spaced, synth_click_track
from app.tests.test_runner_failures import _seeded, _wav_bytes
from app.workers import analysis_runner

CFG = load_audio_config()


def _traced(y: np.ndarray) -> tuple[str, dict]:
    trace: dict = {}
    result = analyze((y.astype(np.float32), SR), _page(VIOLIN), BPM, trace=trace)
    return result.status, trace


def test_a_judged_take_keeps_what_it_was_judged_on() -> None:
    status, trace = _traced(_played(VIOLIN))

    assert status == "ok"
    assert trace["outcome"] == "ok"
    assert trace["reading"] == "as written"
    assert len(trace["detected_s"]) == trace["alignment"]["n_detected"]
    assert trace["alignment"]["quality"] > 0.9
    assert set(trace["pitch"]) >= {"tonal_share", "page_share", "one_pitch_share"}
    # JSON, not numpy: it goes straight into a jsonb column.
    assert json.loads(json.dumps(trace)) == trace


def test_a_take_refused_as_not_played_names_the_rule() -> None:
    """The question the first real refusal could not answer."""
    seconds = len(VIOLIN) + 1.5
    clicks = synth_click_track(evenly_spaced(len(VIOLIN), BPM, start_s=0.5), sr=SR, freq_hz=1500.0)
    y = np.pad(clicks, (0, max(0, int(seconds * SR) - clicks.size)))[: int(seconds * SR)]

    status, trace = _traced(y + _room(seconds))

    assert status == "not_played"
    assert trace["outcome"] == "not_played"
    assert trace["rule"] in ("no_pitch", "one_pitch", "not_tonal")


def test_silence_is_traced_as_nothing_to_compare() -> None:
    status, trace = _traced(_room(4.0) * 0)

    assert status == "no_onsets"
    assert trace["outcome"] == "no_onsets"
    assert trace["detected_s"] == []


def test_analyze_without_a_trace_is_unchanged() -> None:
    y = _played(VIOLIN)
    plain = analyze((y, SR), _page(VIOLIN), BPM)
    traced = analyze((y, SR), _page(VIOLIN), BPM, trace={})

    assert plain.model_dump() == traced.model_dump()


def test_each_rule_is_named_for_the_evidence_that_trips_it() -> None:
    def evidence(tonal: float, one: float) -> Evidence:
        return Evidence(
            tonal_share=tonal,
            n_attacks=32,
            one_pitch_share=one,
            page_classes=7,
            page_share=0.0,
            n_matched=32,
            n_confirmed=0,
            confirmed=(),
        )

    def rule(tonal: float, one: float, quality: float) -> str | None:
        return why_not_played(
            evidence(tonal, one), quality=quality, n_detected=32, n_expected=32, config=CFG
        )

    assert rule(0.0, 0.3, 1.0) == "no_pitch"
    assert rule(1.0, 1.0, 1.0) == "one_pitch"
    assert rule(0.5, 0.3, 0.5) == "not_tonal"
    # Under `broken_quality` the alignment refuses it, and says why.
    assert rule(0.5, 0.3, 0.2) is None
    assert rule(1.0, 0.3, 1.0) is None


# ---- the row ---------------------------------------------------------------


def test_the_worker_stores_the_working_beside_the_verdict(monkeypatch) -> None:
    fake, analysis_id = _seeded()
    monkeypatch.setattr(analysis_runner, "get_service_client", lambda: fake)
    monkeypatch.setattr(analysis_runner, "download_audio", lambda _url: _wav_bytes(2.0))
    monkeypatch.setattr(analysis_runner, "keep_playback_copy", lambda *a, **k: None)

    analysis_runner.run_analysis(analysis_id)

    row = fake.table("analyses").rows[0]
    assert row["status"] == "done"
    assert row["diagnostics"]["outcome"] == row["result_json"]["status"]


def test_a_failed_diagnostics_write_never_costs_the_verdict(monkeypatch) -> None:
    """The column arrives with migration 027. A project without it answers the
    write with an error — which must stop at a log line."""
    fake, analysis_id = _seeded()
    monkeypatch.setattr(analysis_runner, "get_service_client", lambda: fake)
    monkeypatch.setattr(analysis_runner, "download_audio", lambda _url: _wav_bytes(2.0))
    monkeypatch.setattr(analysis_runner, "keep_playback_copy", lambda *a, **k: None)

    table = fake.table("analyses")
    original_update = table.update

    def _update(payload):
        if "diagnostics" in payload:
            raise RuntimeError('column "diagnostics" does not exist')
        return original_update(payload)

    monkeypatch.setattr(table, "update", _update)

    analysis_runner.run_analysis(analysis_id)

    row = table.rows[0]
    assert row["status"] == "done"
    assert "diagnostics" not in row

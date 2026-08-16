"""The dashboard's own correctness — the parts that could quietly mislead.

A tool for measuring something has one unforgivable failure: appearing to work
while reporting the wrong thing. Two ways this one could do that, and both are
pinned here.

1. A mistyped parameter silently ignored, so the page shows a convincing result
   for a value that was never applied.
2. A deviation bar drawn on the wrong side of the axis, so rushing looks like
   dragging.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.services.audio_config import load_audio_config
from app.services.classification import Band, Delta, Direction
from tuning_dashboard.app import app
from tuning_dashboard.corpus import UnknownParameter, config_with, current_values, load_corpus
from tuning_dashboard.plots import deviation_svg

client = TestClient(app)


def _delta(ms: float) -> Delta:
    return Delta(
        global_index=0,
        measure_number=1,
        expected_ms=0.0,
        actual_ms=ms,
        delta_ms=ms,
        delta_pct=ms / 10,
        band=Band.on,
        direction=Direction.on,
        is_slur_interior=False,
    )


class TestOverrides:
    def test_applies_a_named_parameter(self):
        cfg, applied = config_with({"onset.delta": "0.05"})
        assert cfg.onset.delta == 0.05
        assert applied == {"onset.delta": 0.05}

    def test_leaves_everything_else_alone(self):
        base = load_audio_config()
        cfg, _ = config_with({"onset.delta": "0.05"})
        assert cfg.onset.pre_max == base.onset.pre_max
        assert cfg.tolerance == base.tolerance
        assert cfg.alignment == base.alignment

    def test_coerces_to_the_declared_type(self):
        cfg, _ = config_with({"trend.window": "12"})
        assert cfg.trend.window == 12
        assert isinstance(cfg.trend.window, int)

    def test_rejects_an_unknown_parameter(self):
        # The typo case. Accepting it silently is how you spend an afternoon
        # tuning a value that never moved.
        with pytest.raises(UnknownParameter):
            config_with({"onset.detla": "0.05"})

    def test_current_values_covers_every_tunable(self):
        values = current_values(load_audio_config())
        assert values["onset.delta"] == load_audio_config().onset.delta
        assert "tolerance.rushing_outer_pct" in values
        assert "alignment.sakoe_chiba_band" in values


class TestRoutes:
    def test_clip_page_renders(self):
        response = client.get("/")
        assert response.status_code == 200
        assert "Batch 3 tuning" in response.text

    def test_overview_renders_every_clip(self):
        response = client.get("/overview")
        assert response.status_code == 200
        for clip in load_corpus():
            assert clip.label in response.text

    def test_a_mistyped_parameter_is_an_error_not_a_shrug(self):
        response = client.get("/?onset.detla=0.05")
        assert response.status_code == 400
        assert "onset.detla" in response.text

    def test_override_reaches_the_page(self):
        response = client.get("/?onset.delta=0.123")
        assert response.status_code == 200
        assert "0.123" in response.text

    def test_clip_selection(self):
        clips = load_corpus()
        if len(clips) < 2:
            pytest.skip("corpus manifest has fewer than two clips")
        response = client.get(f"/?clip={clips[1].id}")
        assert response.status_code == 200
        assert clips[1].label in response.text


class TestDeviationChart:
    """`delta_ms` is drag-positive; the chart's label says up is late."""

    def _sides(self, deltas: list[Delta]) -> list[str]:
        svg = deviation_svg(deltas, load_audio_config())
        import re

        sides = []
        for y, h in re.findall(r'<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"', svg):
            bottom = float(y) + float(h)
            sides.append("up" if bottom <= 85.5 else "down")
        return sides

    def test_late_notes_draw_upward(self):
        assert self._sides([_delta(120.0), _delta(40.0)]) == ["up", "up"]

    def test_early_notes_draw_downward(self):
        assert self._sides([_delta(-120.0), _delta(-40.0)]) == ["down", "down"]

    def test_no_matched_notes_says_so(self):
        assert "No matched notes" in deviation_svg([], load_audio_config())

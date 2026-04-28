"""Local-only tuning dashboard for the Batch 3 audio pipeline.

Per the spec's "Batch 3 Tuning Appendix" (intempo-combined.md): tuning
audio thresholds without a visualization is impossible. This dashboard
shows the waveform, detected onsets, expected onset grid, per-note
deviations, and the current parameter snapshot — all from one URL.

Run from `backend/`:
    uv run uvicorn tuning_dashboard.app:app --port 8001 --host 127.0.0.1

Then open http://127.0.0.1:8001/?clip=<name> in a browser.

NOT part of the production app — runs on a separate port and pulls
fixtures from `fixtures/audio/`. The main API on :8000 is unaffected.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse

from app.config import settings
from app.services.analysis import analyze_with_diagnostics
from app.services.score_schema import ScoreJson

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_AUDIO_DIR = REPO_ROOT / "fixtures" / "audio"
FIXTURE_SCORES_DIR = REPO_ROOT / "fixtures" / "audio_scores"  # JSON score per audio fixture


app = FastAPI(title="InTempo Audio Tuning Dashboard")


# --------------------------------------------------------------------------
# Fixture discovery
# --------------------------------------------------------------------------


def _list_fixtures() -> list[str]:
    """All .wav / .m4a / .mp3 files in fixtures/audio/, sorted by name."""
    if not FIXTURE_AUDIO_DIR.is_dir():
        return []
    exts = {".wav", ".m4a", ".mp3", ".flac", ".ogg"}
    return sorted(p.name for p in FIXTURE_AUDIO_DIR.iterdir() if p.suffix.lower() in exts)


def _load_score_for(audio_filename: str) -> ScoreJson | None:
    """Look for a sibling score JSON next to the audio fixture.

    Convention: `01_detache_clean.wav` pairs with `fixtures/audio_scores/01_detache_clean.json`.
    Falls back to `default.json` in the same directory if found.
    """
    stem = Path(audio_filename).stem
    candidates = [
        FIXTURE_SCORES_DIR / f"{stem}.json",
        FIXTURE_SCORES_DIR / "default.json",
    ]
    for path in candidates:
        if path.is_file():
            return ScoreJson.model_validate_json(path.read_text(encoding="utf-8"))
    return None


# --------------------------------------------------------------------------
# JSON API for the front-end
# --------------------------------------------------------------------------


@app.get("/api/clips")
def api_clips() -> dict:
    return {"clips": _list_fixtures(), "fixture_dir": str(FIXTURE_AUDIO_DIR)}


@app.get("/api/diagnostics")
def api_diagnostics(clip: str, target_bpm: float = 60.0, highpass: bool = False) -> JSONResponse:
    audio_path = FIXTURE_AUDIO_DIR / clip
    if not audio_path.is_file():
        raise HTTPException(status_code=404, detail=f"audio fixture not found: {clip}")
    score = _load_score_for(clip)
    if score is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"no score JSON found for {clip}. Drop a Pydantic ScoreJson at "
                f"fixtures/audio_scores/{Path(clip).stem}.json or fixtures/audio_scores/default.json"
            ),
        )

    diag = analyze_with_diagnostics(audio_path, score, target_bpm, apply_highpass=highpass)

    # Downsample the waveform for the browser — full 22 kHz × 10 s = 220k points
    # would lock up the browser. Aim for ~3000 points across the clip.
    max_points = 3000
    stride = max(1, diag.waveform.size // max_points)
    waveform_ds = diag.waveform[::stride].tolist()
    waveform_t = [i * stride / diag.sample_rate for i in range(len(waveform_ds))]

    payload = {
        "clip": clip,
        "target_bpm": target_bpm,
        "highpass": highpass,
        "waveform": {"t": waveform_t, "y": waveform_ds},
        "detected_onsets_s": diag.detected_onsets_s.tolist(),
        "expected_onsets_s": diag.expected_onsets_s.tolist(),
        "matched_pairs": diag.matched_pairs,
        "missed_expected_idx": diag.missed_expected_idx,
        "extra_detected_idx": diag.extra_detected_idx,
        "deltas_ms": diag.deltas_ms,
        "delta_pcts": diag.delta_pcts,
        "bands": [b.value for b in diag.bands],
        "rolling_trend_pcts": diag.rolling_trend_pcts,
        "alignment_quality": diag.alignment_quality,
        "verdict": (
            {
                "headline": diag.verdict.headline,
                "overall": diag.verdict.overall.value,
                "largest_run_pct": diag.verdict.largest_run_pct,
            } if diag.verdict else None
        ),
        "config_snapshot": diag.config_snapshot,
    }
    return JSONResponse(payload)


# --------------------------------------------------------------------------
# Page
# --------------------------------------------------------------------------


_BAND_COLORS = {
    "on": "#22c55e",
    "slight_rush": "#fbbf24",
    "slight_drag": "#fbbf24",
    "rushing": "#fb923c",
    "dragging": "#fb923c",
    "severe_rushing": "#ef4444",
    "severe_dragging": "#ef4444",
}


_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>InTempo audio tuning dashboard</title>
<script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
<style>
  body { font: 13px/1.4 system-ui, sans-serif; margin: 16px; color: #1c1917; }
  h1 { font-size: 18px; margin: 0 0 8px; font-weight: 600; }
  .grid { display: grid; grid-template-columns: 1fr 320px; gap: 16px; }
  .card { background: #fafafa; border: 1px solid #e7e5e4; border-radius: 8px; padding: 12px; }
  .controls { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
  select, input[type=number] { font: inherit; padding: 4px 8px; border: 1px solid #d6d3d1; border-radius: 4px; }
  pre { background: #f5f5f4; padding: 8px; border-radius: 4px; font-size: 11px; overflow-x: auto; }
  .verdict { font-size: 14px; font-weight: 500; padding: 8px 12px; background: #f5f5f4; border-left: 4px solid #22c55e; border-radius: 4px; margin-bottom: 8px; }
  .verdict.warn { border-left-color: #fbbf24; }
  .verdict.bad { border-left-color: #ef4444; }
  .meta { color: #78716c; font-size: 12px; margin-bottom: 12px; }
  .empty { color: #a8a29e; font-style: italic; }
  label { display: flex; align-items: center; gap: 6px; }
</style>
</head>
<body>
<h1>InTempo audio tuning dashboard</h1>
<div class="meta">Read-only on the running config in <code>backend/app/config.toml</code>. Edit the file, restart this server (Uvicorn auto-reloads with <code>--reload</code>), refresh the page.</div>

<div class="controls">
  <label>Clip:
    <select id="clip"></select>
  </label>
  <label>Target BPM:
    <input id="bpm" type="number" value="60" min="30" max="240" step="1" />
  </label>
  <label><input id="hp" type="checkbox" /> high-pass (bass mode)</label>
  <button id="reload">Reload</button>
</div>

<div id="verdict"></div>

<div class="grid">
  <div>
    <div class="card"><div id="waveform" style="height: 280px"></div></div>
    <div class="card" style="margin-top: 12px"><div id="deviations" style="height: 240px"></div></div>
    <div class="card" style="margin-top: 12px"><div id="trend" style="height: 200px"></div></div>
  </div>
  <div>
    <div class="card">
      <h3 style="margin: 0 0 8px; font-size: 14px">Parameters (from config.toml)</h3>
      <pre id="config"></pre>
    </div>
    <div class="card" style="margin-top: 12px">
      <h3 style="margin: 0 0 8px; font-size: 14px">Onsets</h3>
      <div id="counts" style="font-size: 12px;"></div>
      <h3 style="margin: 12px 0 4px; font-size: 14px">Per-note bands</h3>
      <div id="bands" style="font-size: 12px"></div>
    </div>
  </div>
</div>

<script>
const BAND_COLORS = __BAND_COLORS_JSON__;
const $ = (id) => document.getElementById(id);

async function loadClips() {
  const res = await fetch('/api/clips');
  const data = await res.json();
  const sel = $('clip');
  sel.innerHTML = '';
  if (data.clips.length === 0) {
    sel.innerHTML = '<option value="">(no clips found in fixtures/audio/)</option>';
    document.getElementById('verdict').innerHTML =
      '<div class="empty">Drop .wav / .m4a fixtures into <code>fixtures/audio/</code> and refresh.</div>';
    return false;
  }
  for (const c of data.clips) {
    const o = document.createElement('option'); o.value = c; o.textContent = c;
    sel.appendChild(o);
  }
  return true;
}

async function load() {
  const clip = $('clip').value;
  if (!clip) return;
  const bpm = $('bpm').value;
  const hp = $('hp').checked ? '1' : '0';
  const url = `/api/diagnostics?clip=${encodeURIComponent(clip)}&target_bpm=${bpm}&highpass=${hp}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({detail: res.statusText}));
    $('verdict').innerHTML = `<div class="verdict bad">${err.detail || res.statusText}</div>`;
    return;
  }
  const d = await res.json();
  renderVerdict(d);
  renderWaveform(d);
  renderDeviations(d);
  renderTrend(d);
  renderSidebar(d);
}

function renderVerdict(d) {
  const v = d.verdict;
  const q = d.alignment_quality;
  let cls = 'verdict';
  if (q < 0.4) cls += ' bad'; else if (q < 0.7) cls += ' warn';
  const headline = v ? v.headline : '(no notes matched)';
  $('verdict').innerHTML = `<div class="${cls}">${headline}<br><small style="color:#78716c">alignment quality: ${q.toFixed(3)}</small></div>`;
}

function renderWaveform(d) {
  const detected = d.detected_onsets_s;
  const expected = d.expected_onsets_s;
  const traces = [
    { x: d.waveform.t, y: d.waveform.y, type: 'scattergl', mode: 'lines', name: 'waveform', line: {color: '#a8a29e', width: 1} },
    { x: detected, y: detected.map(() => 0.05), type: 'scatter', mode: 'markers', name: 'detected onsets', marker: {color: '#ef4444', size: 9, symbol: 'triangle-down'} },
    { x: expected, y: expected.map(() => -0.05), type: 'scatter', mode: 'markers', name: 'expected onsets', marker: {color: '#3b82f6', size: 9, symbol: 'triangle-up'} },
  ];
  Plotly.react('waveform', traces, {
    margin: {t: 20, l: 40, r: 10, b: 30},
    xaxis: {title: 'time (s)'},
    yaxis: {title: 'amplitude', range: [-0.6, 0.6]},
    showlegend: true,
    legend: {orientation: 'h', y: -0.18},
  }, {displayModeBar: false});
}

function renderDeviations(d) {
  const colors = d.bands.map(b => BAND_COLORS[b] || '#a8a29e');
  Plotly.react('deviations', [{
    x: d.deltas_ms.map((_, i) => i + 1),
    y: d.deltas_ms,
    type: 'bar',
    marker: {color: colors},
    name: 'delta (ms)',
    text: d.delta_pcts.map(p => `${p.toFixed(1)}%`),
    hovertemplate: 'note %{x}<br>%{y:.0f}ms (%{text})<extra></extra>',
  }], {
    margin: {t: 20, l: 50, r: 10, b: 40},
    xaxis: {title: 'matched note (1-indexed)'},
    yaxis: {title: 'delta (ms) — + late, − early', zeroline: true},
  }, {displayModeBar: false});
}

function renderTrend(d) {
  Plotly.react('trend', [{
    x: d.rolling_trend_pcts.map((_, i) => i + 1),
    y: d.rolling_trend_pcts,
    type: 'scatter', mode: 'lines+markers',
    line: {color: '#0ea5e9', width: 2},
    name: 'rolling trend (% of beat)',
  }], {
    margin: {t: 20, l: 50, r: 10, b: 40},
    xaxis: {title: 'matched note (1-indexed)'},
    yaxis: {title: 'rolling % of beat', zeroline: true},
  }, {displayModeBar: false});
}

function renderSidebar(d) {
  $('config').textContent = JSON.stringify(d.config_snapshot, null, 2);
  const matched = d.matched_pairs.length;
  const missed = d.missed_expected_idx.length;
  const extra = d.extra_detected_idx.length;
  $('counts').innerHTML =
    `<div>detected: <b>${d.detected_onsets_s.length}</b></div>` +
    `<div>expected: <b>${d.expected_onsets_s.length}</b></div>` +
    `<div>matched: <b>${matched}</b></div>` +
    `<div style="color:#dc2626">missed: <b>${missed}</b></div>` +
    `<div style="color:#dc2626">extra: <b>${extra}</b></div>`;
  const counts = {};
  for (const b of d.bands) counts[b] = (counts[b] || 0) + 1;
  const rows = Object.entries(counts).map(([b, n]) =>
    `<div><span style="display:inline-block;width:10px;height:10px;background:${BAND_COLORS[b]||'#a8a29e'};border-radius:2px;margin-right:6px"></span>${b}: ${n}</div>`
  ).join('');
  $('bands').innerHTML = rows || '<div class="empty">no notes matched</div>';
}

document.getElementById('reload').addEventListener('click', load);
document.getElementById('clip').addEventListener('change', load);
document.getElementById('bpm').addEventListener('change', load);
document.getElementById('hp').addEventListener('change', load);

(async () => {
  const ok = await loadClips();
  if (ok) load();
})();
</script>
</body>
</html>
"""


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    return HTMLResponse(_HTML.replace("__BAND_COLORS_JSON__", json.dumps(_BAND_COLORS)))

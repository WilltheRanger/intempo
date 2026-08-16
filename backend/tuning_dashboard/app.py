"""The Batch 3 tuning dashboard.

A local instrument readout, not a product surface. It exists because the
tuning loop without it is "edit a number, re-run, read JSON, guess again" at
ten minutes a turn, and the loop with it is a page reload.

Run it:

    cd backend
    uv run uvicorn tuning_dashboard.app:app --reload --port 8100

Two pages. `/` is one clip in detail — waveform, onset marks, deviation chart,
the numbers formatted for pasting into a tuning prompt. `/overview` is all six
at once, which is what makes the appendix's regression rule cheap enough to
actually follow.

Parameters can be overridden per-request: `/?clip=01_detache_clean&onset.delta=0.05`.
Nothing is written back. A value that wins gets moved into `config.toml` by
hand with a `TUNING_LOG.md` entry, because the entry is the point.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.templating import Jinja2Templates

from app.services.diagnostics import Diagnostics, analyze_with_diagnostics
from tuning_dashboard.corpus import (
    Clip,
    UnknownParameter,
    config_with,
    current_values,
    load_corpus,
    TUNABLE,
)
from tuning_dashboard.plots import deviation_svg, prompt_block, waveform_svg

app = FastAPI(title="InTempo tuning dashboard", docs_url=None, redoc_url=None)
templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))


#: Query params that drive the page rather than the pipeline.
PAGE_PARAMS = {"clip"}


def _overrides(request: Request) -> dict[str, str]:
    """Every query param that isn't page state, treated as an intended override.

    Deliberately not "every param that *is* a tunable". Filtering to the known
    list would make `?onset.detla=0.05` a silent no-op, and the page would then
    show a perfectly convincing result for a parameter that was never changed —
    the worst possible outcome for a tool whose whole job is to be trusted.
    Unknown names reach `config_with` and are rejected there.
    """
    return {k: v for k, v in request.query_params.items() if k not in PAGE_PARAMS}


def _run(clip: Clip, overrides: dict[str, str]) -> tuple[Diagnostics | None, dict, str | None]:
    cfg, applied = config_with(overrides)
    if clip.path is None:
        return None, applied, "not recorded yet"
    try:
        diag = analyze_with_diagnostics(
            clip.path, clip.score, clip.target_bpm,
            double_bass=clip.double_bass, config=cfg,
        )
    except Exception as exc:  # a broken clip should show, not 500 the page
        return None, applied, f"{type(exc).__name__}: {exc}"
    return diag, applied, None


@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request, clip: str | None = None):
    clips = load_corpus()
    if not clips:
        return templates.TemplateResponse(request, "empty.html", {"reason": "no manifest"})

    try:
        overrides = _overrides(request)
        cfg, applied = config_with(overrides)
    except UnknownParameter as exc:
        return PlainTextResponse(
            f"Not a tunable parameter: {exc}\n\nTunable:\n  " + "\n  ".join(TUNABLE),
            status_code=400,
        )

    selected = next((c for c in clips if c.id == clip), None) or clips[0]
    diag, applied, error = _run(selected, overrides)

    return templates.TemplateResponse(
        request,
        "dashboard.html",
        {
            "clips": clips,
            "clip": selected,
            "diag": diag,
            "error": error,
            "waveform": waveform_svg(diag) if diag else "",
            "deviations": deviation_svg(diag.deltas, cfg) if diag else "",
            "prompt": prompt_block(selected.label, selected.path.name, diag) if diag else "",
            "params": current_values(cfg),
            "applied": applied,
            "query": {k: v for k, v in request.query_params.items() if k != "clip"},
        },
    )


@app.get("/overview", response_class=HTMLResponse)
async def overview(request: Request):
    """Every clip at the current parameters. The regression rule, in one page."""
    clips = load_corpus()
    if not clips:
        return templates.TemplateResponse(request, "empty.html", {"reason": "no manifest"})

    try:
        overrides = _overrides(request)
        cfg, applied = config_with(overrides)
    except UnknownParameter as exc:
        return PlainTextResponse(f"Not a tunable parameter: {exc}", status_code=400)

    rows = []
    for c in clips:
        diag, _, error = _run(c, overrides)
        rows.append({"clip": c, "diag": diag, "error": error})

    return templates.TemplateResponse(
        request,
        "overview.html",
        {
            "rows": rows,
            "params": current_values(cfg),
            "applied": applied,
            "query": dict(request.query_params),
        },
    )

"""The six tuning clips, and the one thing synthetic audio can answer.

**Nothing held the corpus to anything.** `test_cli.py` runs *one* clip through
the command to prove the command works; `test_audio.py` reaches for a clip to
check a specific behaviour. Neither asks the question the corpus exists for:
does the pipeline still say about each clip what that clip was made to say?

Run by hand today, all six pass — `01_detache_clean` steady at quality 0.988,
`02_detache_rushing` reporting a rush across measures 2–8, `03_detache_dragging`
a drag across 3–8. **A change that made the rushing clip report "steady" would
pass every other check in this repository.** That is the gap.

**Direction only, never thresholds**, and the corpus README is explicit about
why: a synthetic click track "cannot tell you whether a threshold is right,
because the thing a threshold has to survive — bow noise, room reflection, a
bass's slow attack, string ring — is exactly what a synthesized click doesn't
have". Tuning needs the real six and an ear (`TUNING_LOG.md`). What a click
track *can* prove is that the arithmetic still runs and still points the right
way, which is what this asserts and all it asserts.

**Generated on demand rather than skipped.** The `.synthetic.wav` files are
build output and are not in git, so a test that skipped when they were missing
would skip everywhere except a machine that had already run the generator — a
test that passes by not running is the failure mode this file exists to close.
`make_synthetic.py` is deterministic and takes about a second.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from app.services.analysis import analyze
from app.services.score_schema import ScoreJson

CORPUS = Path(__file__).resolve().parents[3] / "fixtures" / "audio"
MANIFEST = json.loads((CORPUS / "manifest.json").read_text())

#: What each clip was recorded — or synthesised — to demonstrate.
#:
#: `None` where the clip is not about a direction at all: `04_slurred` exists to
#: *show* onset detection breaking under slurs rather than to be judged by it,
#: `05_open_e_long` asks only whether low-register detection fires, and
#: `06_pizzicato` is the always-should-work case. For those three the assertion
#: is that the pipeline produced a usable reading, which is the whole claim.
EXPECTED: dict[str, str | None] = {
    "01_detache_clean": "on",
    "02_detache_rushing": "rush",
    "03_detache_dragging": "drag",
    "04_slurred": None,
    "05_open_e_long": None,
    "06_pizzicato": None,
}


def _audio_for(clip_id: str) -> Path:
    """The real recording if it exists, else the synthetic stand-in.

    Real first, deliberately: recording one clip replaces one stand-in, and the
    day that happens this test should start reading the real thing without
    anybody remembering to point it here.
    """
    real = CORPUS / f"{clip_id}.wav"
    if real.exists():
        return real
    synthetic = CORPUS / f"{clip_id}.synthetic.wav"
    if not synthetic.exists():
        subprocess.run(
            [sys.executable, str(CORPUS / "make_synthetic.py")],
            check=True,
            capture_output=True,
        )
    assert synthetic.exists(), f"{synthetic.name} was not generated"
    return synthetic


@pytest.mark.parametrize("clip", MANIFEST["clips"], ids=lambda c: c["id"])
def test_the_pipeline_still_reads_each_clip_the_way_it_was_made(clip: dict) -> None:
    result = analyze(
        _audio_for(clip["id"]),
        ScoreJson.model_validate(clip["score"]),
        clip["target_bpm"],
        double_bass=bool(clip.get("double_bass")),
    )

    # A clip that stops being readable at all is the loudest possible
    # regression, and the one every other assertion here rests on.
    assert result.status == "ok", (
        f"{clip['id']} came back {result.status!r}: {clip['expect']}"
    )
    assert result.per_note, f"{clip['id']} produced no per-note reading"

    expected = EXPECTED[clip["id"]]
    if expected is not None:
        assert result.verdict_direction == expected, (
            f"{clip['id']} was made to read {expected!r} and read "
            f"{result.verdict_direction!r} — {clip['expect']}"
        )


def test_every_clip_in_the_manifest_is_accounted_for() -> None:
    """A seventh clip added to the manifest and not to `EXPECTED` would be
    silently unjudged, which is the shape this repository's exclusion lists
    keep being written to avoid."""
    assert {clip["id"] for clip in MANIFEST["clips"]} == set(EXPECTED)

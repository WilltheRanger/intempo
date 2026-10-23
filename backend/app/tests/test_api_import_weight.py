"""The API process boots without the analysis pipeline or the model SDKs in it.

**What this holds, measured on 2026-10-23.** The API is one process on an
instance with 512 MB, and that morning it was killed for running out of
memory while one musician photographed a page. It had been carrying numpy,
SciPy and librosa (through the calibration route and the analysis runner's
imports), the Anthropic SDK and the Google SDK with Pillow behind it (through
the OCR package) — 2,925 modules and 230 MB resident before the first request,
none of it used by a deployment that reads pages and analyses takes on Modal.
Imported where they are used instead, the same boot is 1,129 modules and 88 MB.

That saving is one stray top-level import away from disappearing, and nothing
else would notice: every test would still pass, and the first sign would be
the next out-of-memory kill. So the boot is imported in a clean interpreter and
the heavy modules are looked for by name.

A subprocess because this test process has imported all of them already —
the analysis tests run in it — and `sys.modules` remembers.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]

#: Modules the web process has no use for at boot. `google.genai` rather than
#: `google`, because `google` is also the namespace protobuf lives in.
HEAVY = (
    "numpy",
    "scipy",
    "librosa",
    "numba",
    "soundfile",
    "PIL",
    "anthropic",
    "google.genai",
    "modal",
)


def test_the_api_boots_without_the_audio_stack_or_the_model_sdks() -> None:
    probe = (
        "import sys\n"
        "import app.main\n"
        f"heavy = [m for m in {HEAVY!r} if m in sys.modules]\n"
        "print(','.join(heavy))\n"
    )
    env = {**os.environ, "ANALYSIS_WARMUP": "0", "PYTHONPATH": str(BACKEND)}
    result = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=BACKEND,
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr
    loaded = [name for name in result.stdout.strip().split(",") if name]
    assert not loaded, (
        f"`import app.main` loaded {loaded}. Each is tens of megabytes on an "
        "instance with 512 MB that never uses them at boot — import it inside "
        "the function that needs it. See this file's docstring."
    )

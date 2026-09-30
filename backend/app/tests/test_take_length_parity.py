"""The server's half of the app's take-length cap.

`[intake] max_duration_s` refuses every take longer than it before decoding,
recorded or picked. The app's recorder stops at `MAX_ANALYSED_SECONDS`
(`mobile/src/lib/audio/types.ts`) so a take is never played past the point it
would be refused. The two must be one number: raising this one alone would
leave the recorder stopping early, and lowering it would refuse takes the
recorder had let a musician play to the end.

`limits.test.ts` holds the app to `config.toml`; this holds the config to the
app, and runs whenever the backend changes.
"""

from __future__ import annotations

import re
from math import prod
from pathlib import Path

from app.services.audio_config import load_audio_config

REPO = Path(__file__).resolve().parents[3]
TYPES_TS = REPO / "mobile" / "src" / "lib" / "audio" / "types.ts"


def _app_cap_seconds() -> int:
    match = re.search(
        r"^export const MAX_ANALYSED_SECONDS = ([\d\s*]+);$",
        TYPES_TS.read_text(),
        re.M,
    )
    assert match, "MAX_ANALYSED_SECONDS is no longer a plain product in types.ts"
    return prod(int(factor) for factor in match.group(1).split("*"))


def test_the_recorder_stops_where_intake_refuses() -> None:
    assert load_audio_config().intake.max_duration_s == _app_cap_seconds()

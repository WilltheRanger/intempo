"""The bands the app assumes when a take does not carry its own.

`result_json.tolerance` travels with every take the pipeline has finished since
it started recording the numbers it judged by. `bandFor` and `fullScaleFor` in
`mobile/src/lib/tempo.ts` apply *those* numbers, which is the only reason
CLAUDE.md can say **no threshold is invented in the app** — and it is the
objection that kept Insights from banding an aggregate at all before the
tolerance was stored.

For rows finished **before** that, there is nothing to travel, and the app
falls back to two constants:

    FALLBACK_INNER_PCT = 5     ← config.toml rushing/dragging_inner_pct
    FALLBACK_OUTER_PCT = 20    ← config.toml rushing/dragging_outer_pct

Both docstrings say they match the shipped `backend/config.toml`, *"which is
what those takes were judged by"*. Nothing checked that, and the claim is only
true because the bands have never been tuned.

**This test is a tripwire for the first time they are**, which is a Batch 3
session that has yet to happen. When `config.toml` moves, the correct value for
these two constants is almost certainly the **old** number — a take analysed in
2026 was judged by 5 and 20, and re-banding it by whatever the bands become is
re-judging a performance nobody re-recorded. The wrong move is to dutifully
update the app to follow the config, which is exactly what the current
docstrings invite, and it would change what a musician is told about takes
already in their history with nothing to show for it.

So the failure message names both answers, and the baseline lives here rather
than in the app: this is the file that knows the config changed.
"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

import pytest

from app.services.audio_config import CONFIG_PATH

REPO = Path(__file__).resolve().parents[3]
TEMPO_TS = REPO / "mobile" / "src" / "lib" / "tempo.ts"

#: (the app's constant, the config keys it stands in for).
#:
#: Two keys each, because the bands are asymmetric by design — the tuning
#: appendix widens dragging, since musicians tolerate it better — and one
#: fallback number can only be right for both while they agree. The day they
#: diverge, a single fallback is a decision about which side to be wrong on,
#: and that is a question for the person tuning them.
FALLBACKS: tuple[tuple[str, tuple[str, str]], ...] = (
    ("FALLBACK_INNER_PCT", ("rushing_inner_pct", "dragging_inner_pct")),
    ("FALLBACK_OUTER_PCT", ("rushing_outer_pct", "dragging_outer_pct")),
)

RAW = tomllib.loads(CONFIG_PATH.read_text())
TOLERANCE = RAW["tolerance"]


def _app_constant(name: str) -> float:
    source = TEMPO_TS.read_text()
    match = re.search(rf"const {name} = ([\d.]+);", source)
    assert match, f"lib/tempo.ts no longer declares {name}"
    return float(match.group(1))


@pytest.mark.parametrize(
    ("name", "keys"), FALLBACKS, ids=[name for name, _ in FALLBACKS]
)
def test_the_fallback_is_the_band_those_takes_were_judged_by(
    name: str, keys: tuple[str, str]
) -> None:
    values = {key: float(TOLERANCE[key]) for key in keys}
    fallback = _app_constant(name)

    assert set(values.values()) == {fallback}, (
        f"lib/tempo.ts assumes {name} = {fallback} for a take that carries no "
        f"tolerance of its own, and config.toml now says {values}.\n\n"
        "Two possible right answers, and the default is the first:\n"
        "  1. LEAVE the app alone. A take finished before the pipeline "
        f"recorded its thresholds was judged by {fallback}, and re-banding it "
        "by a newer number re-judges a performance nobody re-recorded. Update "
        "the recorded baseline in this test instead, and say in TUNING_LOG.md "
        "that the fallback is now a historical value rather than a mirror.\n"
        "  2. Change the app, only if the bands moved because the old ones "
        "were *wrong* rather than because they were being tuned — in which "
        "case those takes were mis-banded and should be re-banded."
    )


def test_the_two_sides_still_agree_where_a_single_fallback_can_stand_in() -> None:
    """One number cannot be two.

    `bandFor` picks the rushing or dragging set by the sign of the deviation
    when a tolerance is present, and uses one number for both when it is not.
    That is only honest while the two sides are equal, which they are today and
    which the tuning appendix says they will not stay.
    """
    for inner, outer in (
        ("rushing_inner_pct", "dragging_inner_pct"),
        ("rushing_outer_pct", "dragging_outer_pct"),
        ("rushing_mid_pct", "dragging_mid_pct"),
    ):
        assert TOLERANCE[inner] == TOLERANCE[outer], (
            f"{inner} and {outer} have diverged. `bandFor`'s fallback branch "
            "uses one number for both sides, so it is now wrong on one of "
            "them for every take with no stored tolerance."
        )


def test_the_middle_band_the_app_infers_is_still_the_midpoint() -> None:
    """`FALLBACK_OUTER_PCT / 2` is `bandFor`'s stand-in for the mid band.

    The app carries no `FALLBACK_MID_PCT`; it halves the outer one. That is
    right only while the config's mid sits at half its outer, which is where
    the spec's starting values put it and is not a law.
    """
    outer = float(TOLERANCE["rushing_outer_pct"])
    mid = float(TOLERANCE["rushing_mid_pct"])

    assert mid == outer / 2, (
        f"config.toml puts the mid band at {mid} against an outer of {outer}, "
        "and `bandFor` assumes half. A take with no stored tolerance now gets "
        "a 'slight' band the pipeline would not have given it."
    )

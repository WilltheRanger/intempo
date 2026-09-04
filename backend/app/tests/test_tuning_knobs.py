"""Every value in `config.toml` turns something, and everything it turns is in it.

CLAUDE.md §1 rule 7: *"Externalize magic numbers to config so tuning never
requires a code edit."* `audio_config.py` states the same thing in the first
line of its docstring — *"Every threshold the pipeline uses … lives in
`config.toml`, never hard-coded in the services. That is what makes the Batch 3
tuning loop cheap: change a number, re-run the fixtures, log it in
TUNING_LOG.md; no code edit."*

Batch 3's thresholds are still on the spec's starting values because tuning
needs real ears on real recordings — CLAUDE.md says so, and the corrections
router's docstring calls that the position the project is stuck in. So the
tuning session is a thing that has yet to happen, and it will happen by
somebody editing this file and re-running the corpus.

**A knob that turns nothing is the worst possible failure of that loop.** The
tuner changes a number, the corpus reads identically, and the honest conclusion
from that evidence is *"this parameter does not matter"* — which is exactly
wrong. `TUNING_LOG.md` would then carry a measurement of nothing.

Held in three directions:

  * every field of `AudioConfig` is read somewhere in the pipeline, or named in
    `TURNS_NOTHING` with the reason;
  * every key in `config.toml` reaches a field, so a value added to the file is
    not silently ignored by `_parse`;
  * every field is filled from the file, so a knob cannot quietly become a
    Python default that the file appears to set.

**Two knobs turn nothing today**, both found by this file and both listed
below. Neither is deleted here: removing a key is a decision about the remote
config a deployment may already be sending, and wiring one up is a change to
detector behaviour that belongs to a tuning session with an ear, not to a test.
What was wrong was that `config.toml` gave no sign — it presented both beside
live values with a spec citation each.
"""

from __future__ import annotations

import re
import tomllib
from dataclasses import fields, is_dataclass
from pathlib import Path
from typing import get_type_hints

import pytest

from app.services.audio_config import CONFIG_PATH, AudioConfig

APP = Path(__file__).resolve().parents[1]
PIPELINE = [APP / "services", APP / "workers", APP / "routers"]

#: Fields nothing reads, and why the honest answer is not to delete them.
#:
#: Checked in both directions, the way `NOT_WIRED` is: an entry that has since
#: gained a consumer fails, and so does one for a field that no longer exists.
TURNS_NOTHING: dict[str, str] = {
    "onset.post_max": (
        "The peak-pick window is no longer chosen, it is derived — "
        "`peak_window_frames` computes it from the smallest note gap the score "
        "and the target BPM imply, and passes the one number as both `pre_max` "
        "and `post_max`. `pre_max` survives as the cap on that; `post_max` "
        "survives as a key nothing reads. Wiring it up would mean deciding "
        "whether an asymmetric window is right, which is a question for a "
        "tuning session with the corpus, not for this file."
    ),
    "alignment.slur_tolerance_pct": (
        "The threshold for a check that was never built. `alignment.py` says "
        "so itself, on `is_slur_boundary`: *'Nothing reads this yet … it is "
        "what a slur-total check (spec: \"we measure the total duration of the "
        "slur\") would need.'* Slur handling today is `is_slur_interior`, which "
        "excludes those notes from the trend and the verdict rather than "
        "measuring the phrase against a tolerance."
    ),
}


def _config_fields() -> set[str]:
    """Every `section.field` `AudioConfig` declares.

    Resolved through `get_type_hints` because the module is written with
    `from __future__ import annotations`, so `Field.type` is the *string*
    `"OnsetConfig"` rather than the class. Discovered from the dataclasses
    rather than listed, which is the only version of this that cannot go stale
    when a knob is added.
    """
    hints = get_type_hints(AudioConfig)
    found: set[str] = set()
    for section in fields(AudioConfig):
        kind = hints[section.name]
        assert is_dataclass(kind), f"{section.name} is not a config section"
        found |= {f"{section.name}.{value.name}" for value in fields(kind)}
    return found


def _pipeline_source() -> dict[str, str]:
    """Every module that could read a threshold, bar the loader itself."""
    return {
        str(path.relative_to(APP)): path.read_text()
        for directory in PIPELINE
        for path in sorted(directory.rglob("*.py"))
        if path.name != "audio_config.py"
    }


def _readers(field: str) -> list[str]:
    """Files that read `…​.field` as an attribute.

    Attribute access, because that is the only way a value gets out of a frozen
    dataclass — `cfg.onset.delta`, or `onset = cfg.onset` then `onset.delta`,
    both of which appear in `audio.py`.
    """
    pattern = re.compile(rf"\w\.{re.escape(field.split('.')[-1])}\b")
    return [name for name, source in _pipeline_source().items() if pattern.search(source)]


CONFIG_FIELDS = _config_fields()
RAW = tomllib.loads(CONFIG_PATH.read_text())


def _raw_keys(table: dict, fields_known: set[str]) -> set[str]:
    """Every leaf key in the TOML, as the `section.field` it fills.

    Sub-tables do not flatten the same way, and that is the loader's shape
    rather than this file's opinion of it:

        [onset.double_bass]  delta        →  onset.double_bass_delta
        [tolerance.pulse]    disturbance… →  tolerance.disturbance…

    So a sub-table key is matched against the prefixed name first and the bare
    one second, and a key matching neither is reported as unread — which is the
    point of the check that uses this.
    """
    keys: set[str] = set()
    for section, body in table.items():
        if not isinstance(body, dict):
            continue
        for name, value in body.items():
            if isinstance(value, dict):
                for leaf in value:
                    prefixed = f"{section}.{name}_{leaf}"
                    keys.add(
                        prefixed
                        if prefixed in fields_known
                        else f"{section}.{leaf}"
                    )
            else:
                keys.add(f"{section}.{name}")
    return keys


RAW_KEYS = _raw_keys(RAW, CONFIG_FIELDS)


@pytest.mark.parametrize("field", sorted(CONFIG_FIELDS), ids=sorted(CONFIG_FIELDS))
def test_every_knob_turns_something(field: str) -> None:
    if field in TURNS_NOTHING:
        pytest.skip(f"named in TURNS_NOTHING: {TURNS_NOTHING[field]}")

    assert _readers(field), (
        f"nothing in the pipeline reads {field}, so changing it in "
        "config.toml does nothing and a tuning session would measure the "
        "corpus reading identically. Wire it up, or add it to "
        "`TURNS_NOTHING` with the reason and say so in config.toml."
    )


def test_no_dead_knob_has_quietly_come_alive() -> None:
    """A stale exclusion is what this list is most likely to become.

    An entry that now has a reader means somebody wired it up and left the
    reason behind, and the next tuner believes a live parameter is inert —
    which is the same failure one direction over.
    """
    alive = sorted(field for field in TURNS_NOTHING if _readers(field))

    assert not alive, (
        "these are listed as turning nothing and now have readers: "
        + "; ".join(f"{f} in {_readers(f)}" for f in alive)
    )


def test_no_excuse_outlives_its_field() -> None:
    gone = sorted(field for field in TURNS_NOTHING if field not in CONFIG_FIELDS)

    assert not gone, f"AudioConfig has no such fields any more: {gone}"


def test_every_key_in_the_file_reaches_a_field() -> None:
    """A value added to `config.toml` that `_parse` ignores.

    The same failure as a dead field, arriving from the other side: the tuner
    adds a number the file's shape invites, nothing reads it, and the corpus
    does not move.
    """
    ignored = sorted(RAW_KEYS - CONFIG_FIELDS)

    assert not ignored, (
        f"config.toml sets these and `_parse` builds no field from them: {ignored}"
    )


def test_every_field_is_filled_from_the_file() -> None:
    """And the other side of that.

    `_parse` gives a few fields Python defaults (`disturbance_deviations`,
    `double_bass_highpass_hz`) so an older remote-config row still loads. A
    field with a default and no key in the file is a knob that looks settable
    and is not — the file is what a tuner edits.
    """
    missing = sorted(CONFIG_FIELDS - RAW_KEYS)

    assert not missing, (
        "these fields take their value from a Python default because "
        f"config.toml does not set them: {missing}"
    )

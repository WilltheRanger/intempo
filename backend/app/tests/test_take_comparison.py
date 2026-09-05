import pytest
from app.services.take_comparison import comparison_key

ROW = {"score_id": "score", "target_bpm": 80, "instrument": "double_bass",
       "metronome_mode": "off", "from_measure": 1, "skip_long_rests": False}


def test_identity_is_stable_and_sensitive_to_notation():
    assert comparison_key({"a": 1, "b": 2}, ROW) == comparison_key({"b": 2, "a": 1}, ROW)
    assert comparison_key({"pitch": "E2"}, ROW) != comparison_key({"pitch": "F2"}, ROW)


@pytest.mark.parametrize("key,value", [
    ("score_id", "other"), ("target_bpm", 81), ("instrument", "cello"),
    ("metronome_mode", "visual"), ("from_measure", 2), ("skip_long_rests", True),
])
def test_changed_practice_settings_do_not_match(key, value):
    assert comparison_key({}, ROW) != comparison_key({}, {**ROW, key: value})


def test_unknown_instrument_is_not_comparable():
    assert comparison_key({}, {**ROW, "instrument": None}) is None

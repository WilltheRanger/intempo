"""The first five minutes after a recording exists.

Everything else between a musician and a verdict — Supabase keys, a deployed
API, a phone that has been granted a microphone — is a separate problem, and
none of it should have to work before you can find out whether the *pipeline*
does. This is the command that answers that, so it has to run.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from tuning_dashboard.cli import main

CORPUS = Path(__file__).resolve().parents[3] / "fixtures" / "audio"


def _a_clip() -> Path:
    for candidate in ("01_detache_clean.wav", "01_detache_clean.synthetic.wav"):
        path = CORPUS / candidate
        if path.exists():
            return path
    pytest.skip("no corpus audio, real or synthetic")


def test_a_corpus_clip_needs_no_arguments(capsys) -> None:
    """Recording `01_detache_clean.wav` and running this is the whole workflow.

    The score and the tempo come from the manifest, matched on the filename, so
    there is nothing to remember and nothing to get wrong at the moment when
    the interesting question is about the playing.
    """
    assert main([str(_a_clip())]) == 0

    out = capsys.readouterr().out
    assert "60 BPM" in out
    assert "quality" in out
    assert "bar" in out and "drift" in out


def test_the_verdict_is_printed_verbatim(capsys) -> None:
    """Not summarised, not graded, not softened.

    A tool that flatters its input is useless for looking at a pipeline.
    """
    main([str(_a_clip())])
    assert "Steady tempo" in capsys.readouterr().out


def test_the_json_is_the_result_itself(capsys) -> None:
    """So a script can read it without parsing prose."""
    main([str(_a_clip()), "--json"])

    payload = json.loads(capsys.readouterr().out)
    assert payload["status"] == "ok"
    assert len(payload["per_measure"]) == 8
    assert payload["tolerance"]["rushing_outer_pct"] == 20.0


def test_a_missing_file_says_so_and_does_not_raise(capsys) -> None:
    assert main(["nowhere/at/all.wav"]) == 2
    assert "no such file" in capsys.readouterr().err


def test_an_unknown_recording_is_told_what_it_needs(capsys, tmp_path) -> None:
    """The likeliest wrong turn: a take of something that is not the corpus."""
    import numpy as np
    import soundfile as sf

    path = tmp_path / "my_practice.wav"
    sf.write(str(path), np.zeros(2205, dtype="float32"), 22050)

    assert main([str(path)]) == 2

    err = capsys.readouterr().err
    assert "--score" in err
    assert "01_detache_clean" in err, "the error should show what a known name looks like"


def test_a_score_file_is_accepted_and_still_needs_a_tempo(capsys, tmp_path) -> None:
    import numpy as np
    import soundfile as sf

    score = tmp_path / "score.json"
    score.write_text(
        json.dumps(
            {
                "clef": "bass",
                "time_signature": "4/4",
                "ocr_confidence": 0.9,
                "measures": [
                    {
                        "measure_number": 1,
                        "notes": [{"pitch": "E2", "duration": "quarter"}] * 4,
                    }
                ],
            }
        )
    )
    audio = tmp_path / "take.wav"
    sf.write(str(audio), np.zeros(22050, dtype="float32"), 22050)

    assert main([str(audio), "--score", str(score)]) == 2
    assert "--bpm is required" in capsys.readouterr().err

    # With a tempo it runs, and silence is a real answer rather than a crash.
    assert main([str(audio), "--score", str(score), "--bpm", "60"]) == 1
    assert "couldn't hear any notes" in capsys.readouterr().out


def test_a_take_the_pipeline_could_not_use_exits_non_zero() -> None:
    """So this is usable in a script without reading the words."""
    import inspect

    from tuning_dashboard import cli

    source = inspect.getsource(cli.main)
    assert 'return 0 if result.status == "ok" else 1' in source

"""The local OMR provider.

The engine is a subprocess that may not be installed, may hang, may exit
non-zero, and may exit *zero* having found nothing. Every one of those has to
end as an `OCRProviderError` so the chain falls through to the next provider —
the one failure that must never happen is a silent empty transcription
returned as a success, because that stops the fallback and hands the product a
score with no notes in it.

The engine itself is never invoked here. A stub binary stands in, so these run
in a second and in CI, where no OMR engine exists.
"""

from __future__ import annotations

import os
import stat
import zipfile
from pathlib import Path

import pytest

from app.services.ocr.base import OCRProviderError
from app.services.ocr.omr_provider import OMRProvider

FIXTURE = (
    Path(__file__).resolve().parents[3]
    / "fixtures"
    / "musicxml"
    / "bass_excerpt.musicxml"
)


def _stub(tmp_path: Path, body: str, name: str = "fake-omr") -> str:
    """A shell script standing in for the engine, put on PATH."""
    binary = tmp_path / name
    binary.write_text("#!/bin/sh\n" + body)
    binary.chmod(binary.stat().st_mode | stat.S_IEXEC)
    os.environ["PATH"] = f"{tmp_path}{os.pathsep}{os.environ['PATH']}"
    return name


@pytest.fixture(autouse=True)
def _restore_path():
    original = os.environ["PATH"]
    yield
    os.environ["PATH"] = original


def test_reads_the_musicxml_the_engine_wrote(tmp_path: Path) -> None:
    xml = FIXTURE.read_text(encoding="utf-8").replace("'", "'\\''")
    name = _stub(tmp_path, f"cat > \"$3/score.musicxml\" <<'XML'\n{xml}\nXML\n")
    response = OMRProvider(command=name).parse(b"not really an image", "image/png")

    assert response.score.clef == "bass"
    assert len(response.score.measures) == 2
    # A local engine bills nothing. That is half the reason to run it on every
    # page as a cross-check rather than only on the ones that look wrong.
    assert response.cost_usd == 0.0
    assert response.input_tokens == 0
    assert response.model == "omr-local"


def test_a_missing_engine_says_how_to_install_one(tmp_path: Path) -> None:
    with pytest.raises(OCRProviderError) as caught:
        OMRProvider(command="definitely-not-installed-omr").parse(b"x")
    message = str(caught.value)
    assert "pip install oemer" in message
    assert "OMR_COMMAND" in message


def test_a_non_zero_exit_carries_the_engine_s_own_words(tmp_path: Path) -> None:
    name = _stub(tmp_path, "echo 'could not find any staff lines' >&2\nexit 3\n")
    with pytest.raises(OCRProviderError) as caught:
        OMRProvider(command=name).parse(b"x")
    assert "exited 3" in str(caught.value)
    assert "could not find any staff lines" in str(caught.value)


def test_a_hang_is_cut_off(tmp_path: Path) -> None:
    name = _stub(tmp_path, "sleep 30\n")
    with pytest.raises(OCRProviderError) as caught:
        OMRProvider(command=name, timeout_s=1).parse(b"x")
    assert "did not finish" in str(caught.value)


def test_exiting_zero_with_no_output_is_still_a_failure(tmp_path: Path) -> None:
    name = _stub(tmp_path, "exit 0\n")
    with pytest.raises(OCRProviderError) as caught:
        OMRProvider(command=name).parse(b"x")
    assert "wrote no MusicXML" in str(caught.value)


def test_an_empty_score_is_refused_rather_than_returned(tmp_path: Path) -> None:
    """The failure this file exists for.

    An engine that finds no staff still exits zero and writes a valid document
    with no measures in it. Returning that as a success stops the chain from
    falling through, and the product gets a piece with no notes.
    """
    name = _stub(
        tmp_path,
        'cat > "$3/score.musicxml" <<\'XML\'\n'
        '<score-partwise><part id="P1"></part></score-partwise>\nXML\n',
    )
    with pytest.raises(OCRProviderError) as caught:
        OMRProvider(command=name).parse(b"x")
    assert "read no measures" in str(caught.value)


def test_unreadable_output_is_refused(tmp_path: Path) -> None:
    name = _stub(tmp_path, 'printf \'not xml\' > "$3/score.musicxml"\n')
    with pytest.raises(OCRProviderError):
        OMRProvider(command=name).parse(b"x")


def test_the_argument_template_is_substituted(tmp_path: Path) -> None:
    """Audiveris takes `-batch -export -output DIR -- FILE`; oemer takes
    `FILE -o DIR`. There is no convention, so the shape is configuration."""
    name = _stub(
        tmp_path,
        # $4 is {out} under this template. Writing there proves the placeholder
        # landed in the right position, which asserting on argv text would not.
        'cat > "$4/score.musicxml" <<\'XML\'\n'
        '<score-partwise><part id="P1"><measure number="1">'
        "<note><rest/><type>quarter</type></note></measure></part></score-partwise>\nXML\n",
    )
    provider = OMRProvider(command=name, args="-batch -export -output {out} -- {image}")
    assert provider.parse(b"x", "image/png").score.measures


def test_a_broken_template_says_so(tmp_path: Path) -> None:
    name = _stub(tmp_path, "exit 0\n")
    with pytest.raises(OCRProviderError) as caught:
        OMRProvider(command=name, args="{nonsense}").parse(b"x")
    assert "OMR_ARGS" in str(caught.value)


def test_a_compressed_mxl_is_read(tmp_path: Path) -> None:
    """Audiveris exports .mxl — a zip holding the document — not a bare file."""
    archive = tmp_path / "payload.mxl"
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("META-INF/container.xml", "<container/>")
        bundle.writestr("score.xml", FIXTURE.read_text(encoding="utf-8"))
    name = _stub(tmp_path, f'cp "{archive}" "$3/out.mxl"\n', name="fake-mxl")
    response = OMRProvider(command=name).parse(b"x", "image/png")
    assert response.score.clef == "bass"
    assert len(response.score.measures) == 2


def test_a_corrupt_mxl_is_refused(tmp_path: Path) -> None:
    name = _stub(tmp_path, 'printf \'not a zip\' > "$3/out.mxl"\n', name="fake-badmxl")
    with pytest.raises(OCRProviderError) as caught:
        OMRProvider(command=name).parse(b"x")
    assert "readable .mxl" in str(caught.value)


def test_it_is_registered_but_not_in_the_default_chain() -> None:
    """Registered so it can be named; absent from the default so an install
    that lacks the engine does not fail every scan."""
    from app.config import settings
    from app.services.ocr.pipeline import PROVIDER_REGISTRY

    assert "omr-local" in PROVIDER_REGISTRY
    assert "omr-local" not in settings.OCR_PROVIDER_CHAIN

"""The whole path a scanned page takes, on real photographs.

Everything is real except the model call: the fixture images off disk, the
normalisation, the media-type sniff, the provider chain with its fallthrough
and beat-sum gate, the validation, and the row the worker writes. Only the
vision API is stubbed, because a test that needs an API key is a test nobody
runs — and because what has repeatedly broken is not the model's reading but
the plumbing on either side of it.

**This is the test that did not exist.** Every OCR test in this repo fed a
provider `b"<jpeg>"` or a 40 KB cropped excerpt. Nothing exercised a full-page
photograph through the worker, which is the only input the app ever actually
receives.
"""

from __future__ import annotations

import io
from pathlib import Path

import pytest
from PIL import Image

from app.services.ocr.base import OCRProviderError, OCRResponse
from app.services.ocr.pipeline import parse_sheet_music
from app.services.page_image import MODEL_MAX_BYTES, find_systems, prepare_for_model
from app.services.score_schema import Measure, Note, ScoreJson
from app.workers import transcription_runner as runner

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures" / "scores"
SCORE_ID = "22222222-2222-2222-2222-222222222222"
IMAGE_URL = "https://p.supabase.co/storage/v1/object/upload/sign/score-images/u/page.jpg"


def _phone_photo(source: Path, width: int = 3024, height: int = 4032) -> bytes:
    """A fixture excerpt blown up into the shape a phone actually produces.

    The fixtures are 30-50 KB crops. The app receives a full sheet at several
    megapixels, which is a different input in every way that has broken so far.
    """
    src = Image.open(source).convert("RGB")
    page = Image.new("RGB", (width, height), "white")
    band = src.resize(
        (int(width * 0.92), max(1, int(src.height * (width * 0.92) / src.width))),
        Image.Resampling.LANCZOS,
    )
    y = int(height * 0.06)
    while y + band.height < height:
        page.paste(band, (int(width * 0.04), y))
        y += int(band.height * 1.9)
    buffer = io.BytesIO()
    page.save(buffer, format="JPEG", quality=95, subsampling=0)
    return buffer.getvalue()


READING = ScoreJson(
    clef="bass",
    time_signature="4/4",
    ocr_confidence=0.86,
    measures=[
        Measure(
            measure_number=n + 1,
            notes=[Note(pitch="C3", duration="quarter") for _ in range(4)],
        )
        for n in range(24)
    ],
)


class _Model:
    """A vision provider that records exactly what it was handed."""

    name = "stub-vision"

    def __init__(self, answer=READING) -> None:
        self.answer = answer
        self.seen: dict = {}
        #: Every call, not just the last. A page is read one system at a time
        #: now, so "what the model was handed" is a list — and checking only
        #: the last one would miss a first crop sent unshrunk or as a PNG.
        self.calls: list[dict] = []

    def parse(self, image_bytes, mime_type="image/jpeg", note=None) -> OCRResponse:
        self.seen = {"bytes": len(image_bytes), "mime": mime_type, "head": image_bytes[:4]}
        self.calls.append(self.seen)
        if isinstance(self.answer, Exception):
            raise self.answer
        return OCRResponse(
            score=self.answer, raw_text="{}", model=self.name,
            input_tokens=1, output_tokens=1, cost_usd=0.0, latency_ms=1,
        )


class _Table:
    def __init__(self, row: dict | None) -> None:
        self._row, self.patches = row, []

    def select(self, *_a): return self
    def eq(self, *_a): return self
    def limit(self, *_a): return self
    def execute(self): return type("R", (), {"data": [self._row] if self._row else []})()
    def update(self, patch):
        self.patches.append(patch)
        return self


class _Client:
    def __init__(self, table):
        self._t = table

    def table(self, _n):
        return self._t


@pytest.fixture()
def wired(monkeypatch):
    """The worker, with storage and the network replaced and nothing else."""
    table = _Table({"id": SCORE_ID, "user_id": "u", "source_image_url": IMAGE_URL})
    monkeypatch.setattr(runner, "get_service_client", lambda: _Client(table))
    monkeypatch.setattr(runner, "readable_url", lambda url: url)
    return table


@pytest.mark.parametrize("fixture", sorted(FIXTURES.glob("0*.jpg")), ids=lambda p: p.stem)
def test_a_full_page_photograph_of_each_fixture_reaches_the_model(
    fixture: Path, wired, monkeypatch
) -> None:
    """Every fixture, at phone resolution, all the way through to a saved row.

    The assertion that matters is not that the stub answered — it always will.
    It is that what reached the provider was a JPEG under the API limit, and
    that the notes landed in the row. Those are the two things that were
    silently wrong.

    **`_phone_photo` pastes the band down the page repeatedly**, so this is a
    real multi-system page and the reader now takes it one system at a time.
    That is why the stub is called several times and why the measures multiply:
    it answers the same 24 bars to every crop. What is worth checking is that
    every crop was prepared properly — not just the last — and that the
    concatenation numbers the result 1..N.
    """
    photo = _phone_photo(fixture)
    model = _Model()
    monkeypatch.setattr(runner, "download_image", lambda url: photo)
    monkeypatch.setattr(
        runner,
        "parse_sheet_music",
        lambda b, *, media_type, on_stage=None: parse_sheet_music(
            b, media_type=media_type, providers=[model], retry=False
        ),
    )

    runner.run_transcription(SCORE_ID)

    # What the model was handed — every time, not just the last.
    systems = find_systems(photo)
    assert len(model.calls) == len(systems) > 1, (
        f"{len(model.calls)} call(s) for {len(systems)} system(s)"
    )
    for index, call in enumerate(model.calls):
        assert call["mime"] == "image/jpeg", index
        assert call["head"][:3] == b"\xff\xd8\xff", f"crop {index} is not a JPEG"
        assert call["bytes"] * 4 / 3 <= MODEL_MAX_BYTES, f"crop {index} over the 5 MB limit"
        assert call["bytes"] < len(photo), f"crop {index} was sent unshrunk"

    final = wired.patches[-1]
    assert final["transcription_status"] == "done"
    assert len(final["score_json"]["measures"]) == 24 * len(model.calls)
    numbers = [m["measure_number"] for m in final["score_json"]["measures"]]
    assert numbers == list(range(1, len(numbers) + 1)), (
        "the systems were joined without renumbering, so bar 1 appears once "
        "per system and every reference to a bar points at the wrong one"
    )
    assert final["ocr_confidence"] == pytest.approx(0.86)


def test_a_sideways_photograph_arrives_upright(wired, monkeypatch) -> None:
    """A phone flags rotation in EXIF instead of rotating pixels, so a page can
    look perfectly upright to the person who took it and arrive on its side."""
    exif = Image.Exif()
    exif[274] = 6
    page = Image.open(io.BytesIO(_phone_photo(FIXTURES / "01_simple_printed.jpg")))
    buffer = io.BytesIO()
    page.save(buffer, format="JPEG", exif=exif.tobytes())
    rotated = buffer.getvalue()

    model = _Model()
    monkeypatch.setattr(runner, "download_image", lambda url: rotated)
    monkeypatch.setattr(
        runner,
        "parse_sheet_music",
        lambda b, *, media_type, on_stage=None: parse_sheet_music(
            b, media_type=media_type, providers=[model], retry=False
        ),
    )
    runner.run_transcription(SCORE_ID)

    sent = prepare_for_model(rotated)[0]
    landscape = Image.open(io.BytesIO(sent))
    assert landscape.width > landscape.height, "the flag was not applied"
    assert wired.patches[-1]["transcription_status"] == "done"


def test_a_model_answering_with_extra_keys_does_not_lose_the_page(wired, monkeypatch) -> None:
    """The failure that used to be indistinguishable from a bad photograph.

    A page that changes metre invites a model to attach the new one to a
    measure. Under `extra="forbid"` that lost the entire score, every provider
    in turn, and reported it as an unreadable photograph.
    """
    payload = {
        "time_signature": "4/4", "clef": "bass", "ocr_confidence": 0.9,
        "rehearsal_marks": ["49", "50"],
        "measures": [{
            "measure_number": 1,
            "notes": [{"pitch": "C3", "duration": "quarter", "fingering": 2} for _ in range(4)],
            "slurs": [], "time_signature": "2/2",
        }],
    }
    model = _Model(ScoreJson.model_validate(payload))
    monkeypatch.setattr(
        runner, "download_image", lambda url: _phone_photo(FIXTURES / "02_medium_printed.jpg")
    )
    monkeypatch.setattr(
        runner,
        "parse_sheet_music",
        lambda b, *, media_type, on_stage=None: parse_sheet_music(
            b, media_type=media_type, providers=[model], retry=False
        ),
    )
    runner.run_transcription(SCORE_ID)

    final = wired.patches[-1]
    assert final["transcription_status"] == "done"
    assert final["score_json"]["measures"][0]["notes"][0]["pitch"] == "C3"


def test_an_undecodable_download_still_reaches_the_provider(wired, monkeypatch) -> None:
    """Normalisation must never be able to lose a page on its own.

    Something it cannot decode is passed through untouched, so the worst case
    is the behaviour that existed before it — the provider refuses it, in the
    provider's own words.
    """
    model = _Model(OCRProviderError("stub-vision: unsupported image"))
    monkeypatch.setattr(runner, "download_image", lambda url: b"not an image")
    monkeypatch.setattr(
        runner,
        "parse_sheet_music",
        lambda b, *, media_type, on_stage=None: parse_sheet_music(
            b, media_type=media_type, providers=[model], retry=False
        ),
    )
    runner.run_transcription(SCORE_ID)

    assert model.seen["bytes"] == len(b"not an image")
    assert wired.patches[-1]["transcription_status"] == "failed"

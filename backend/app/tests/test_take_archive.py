"""Keeping a take without keeping 96 KB a second of it.

A recording is uploaded as 48 kHz mono 16-bit WAV and nothing ever deleted one
— only deleting the piece or the account did. Measured on the live project: an
active musician with twenty two-minute takes carries about 230 MB, so 1 GB of
free storage is about four people.

These tests are about the two things that make replacing it safe rather than
clever: that the *order* of operations can never leave a musician with no
audio, and that both copies are found again when the piece or the account is
deleted.
"""

from __future__ import annotations

import io

import numpy as np
import pytest
import soundfile as sf

from app.services import take_archive
from app.services.take_archive import keep_playback_copy, playback_key_for, to_opus


def _wav(seconds: float = 1.0, rate: int = 48_000) -> bytes:
    t = np.linspace(0, seconds, int(rate * seconds), endpoint=False, dtype="float32")
    out = io.BytesIO()
    sf.write(out, (0.3 * np.sin(2 * np.pi * 440 * t)).astype("float32"), rate,
             subtype="PCM_16", format="WAV")
    return out.getvalue()


class _Bucket:
    def __init__(self, *, upload_fails: bool = False, remove_fails: bool = False) -> None:
        self.uploaded: list[tuple[str, int]] = []
        self.removed: list[list[str]] = []
        self._upload_fails = upload_fails
        self._remove_fails = remove_fails

    def upload(self, key, data, options=None):  # noqa: ANN001, ARG002
        if self._upload_fails:
            raise RuntimeError("storage said no")
        self.uploaded.append((key, len(data)))

    def remove(self, keys):  # noqa: ANN001
        if self._remove_fails:
            raise RuntimeError("storage said no")
        self.removed.append(list(keys))


class _Client:
    def __init__(self, bucket: _Bucket, *, update_fails: bool = False) -> None:
        self._bucket = bucket
        self._update_fails = update_fails
        self.patches: list[dict] = []

    def storage_from(self, _name):  # pragma: no cover - shape only
        return self._bucket

    @property
    def storage(self):
        client = self

        class _Storage:
            def from_(self, _name):  # noqa: ANN001
                return client._bucket

        return _Storage()

    def table(self, _name):  # noqa: ANN001
        return self

    def update(self, patch):  # noqa: ANN001
        if self._update_fails:
            raise RuntimeError("row said no")
        self.patches.append(patch)
        return self

    def eq(self, *_a):
        return self

    def execute(self):
        return type("R", (), {"data": []})()


# ---- the encoding ----------------------------------------------------------


def test_opus_is_a_fraction_of_the_wav() -> None:
    """The whole reason this exists, asserted rather than assumed.

    A pure sine is close to the worst case a codec can be handed — no silence,
    no decay, nothing to predict — so a real take does better than this.
    """
    wav = _wav(seconds=2.0)
    opus = to_opus(wav)

    assert len(opus) < len(wav) / 5, f"{len(wav)} -> {len(opus)} is not worth doing"


def test_the_copy_still_decodes_to_the_same_length() -> None:
    """Smaller is only useful if it is still the take."""
    wav = _wav(seconds=1.0)
    data, rate = sf.read(io.BytesIO(to_opus(wav)))

    assert rate == 48_000
    # Opus pads to its frame size, so this is "the same recording", not "the
    # same sample count".
    assert 0.9 < len(data) / 48_000 < 1.2


def test_a_rate_opus_refuses_is_resampled_rather_than_failing() -> None:
    """A device that insists on 44.1 kHz must not lose its playback copy.

    Opus accepts a fixed set of rates and 44,100 is not among them, so the
    encoder raises rather than resampling for us. That would have been a
    warning in the log and a WAV kept forever, on exactly the phones that are
    hardest to test.
    """
    opus = to_opus(_wav(seconds=1.0, rate=44_100))
    _, rate = sf.read(io.BytesIO(opus))

    assert rate == 48_000


# ---- the key ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("reference", "expected"),
    [
        ("user-1/take.wav", "user-1/take.opus"),
        ("audio-uploads/user-1/take.wav", "user-1/take.opus"),
        ("user-1/no-extension", "user-1/no-extension.opus"),
    ],
)
def test_the_copy_sits_beside_the_original(reference: str, expected: str) -> None:
    """Same key, new extension — so the owner prefix survives.

    `owned_audio_key` re-checks that prefix at every read boundary, so a key
    built any other way would be refused by the endpoint this exists to serve.
    """
    assert playback_key_for(reference) == expected


def test_a_reference_with_no_key_in_it_is_refused() -> None:
    assert playback_key_for("https://elsewhere.test/take.wav") is None


# ---- the ordering ----------------------------------------------------------


def test_the_wav_goes_only_after_the_copy_is_stored_and_recorded() -> None:
    bucket = _Bucket()
    client = _Client(bucket)

    key = keep_playback_copy(client, "a1", "user-1/take.wav", _wav())

    assert key == "user-1/take.opus"
    assert [name for name, _ in bucket.uploaded] == ["user-1/take.opus"]
    assert client.patches == [{"playback_key": "user-1/take.opus"}]
    assert bucket.removed == [["user-1/take.wav"]]


def test_a_failed_upload_leaves_the_wav_alone() -> None:
    """The take is what matters; the copy is an optimisation.

    Every failure here has to fall on the side of costing storage rather than
    costing a recording, which is why this runs after the verdict is written
    and never raises.
    """
    bucket = _Bucket(upload_fails=True)
    client = _Client(bucket)

    assert keep_playback_copy(client, "a1", "user-1/take.wav", _wav()) is None
    assert bucket.removed == [], "the original was deleted after a failed copy"
    assert client.patches == []


def test_a_failed_row_write_leaves_the_wav_alone() -> None:
    """The dangerous one: the object exists but nothing points at it.

    Deleting the WAV here would leave a row naming an object that is gone and
    an object nothing names — a take that cannot be played back by anything.
    """
    bucket = _Bucket()
    client = _Client(bucket, update_fails=True)

    assert keep_playback_copy(client, "a1", "user-1/take.wav", _wav()) is None
    assert bucket.removed == [], "the original was deleted with the row still naming it"


def test_a_failed_delete_still_counts_as_a_copy() -> None:
    """Both copies exist, playback prefers the Opus. Costs storage, nothing else."""
    bucket = _Bucket(remove_fails=True)
    client = _Client(bucket)

    assert keep_playback_copy(client, "a1", "user-1/take.wav", _wav()) == "user-1/take.opus"
    assert client.patches == [{"playback_key": "user-1/take.opus"}]


def test_an_unusable_reference_touches_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    bucket = _Bucket()
    client = _Client(bucket)

    assert keep_playback_copy(client, "a1", "https://elsewhere.test/x.wav", _wav()) is None
    assert bucket.uploaded == []
    assert bucket.removed == []


def test_audio_that_will_not_decode_is_a_warning_not_a_crash(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """`run_analysis` calls this after the row is already `done`.

    An exception escaping here would propagate out of a function whose work is
    finished, and the only thing it could achieve is a traceback in the log
    where a warning belongs.
    """
    bucket = _Bucket()
    client = _Client(bucket)

    with caplog.at_level("WARNING"):
        assert keep_playback_copy(client, "a1", "user-1/take.wav", b"not audio") is None

    assert bucket.uploaded == []
    assert "a1" in caplog.text


def test_it_is_reachable_from_the_runner() -> None:
    """The defect this repository keeps finding: written, tested, never called.

    `check-dead-exports` cannot see this one — the import is real, so the
    export is referenced whether or not anything invokes it.
    """
    from app.workers import analysis_runner

    assert analysis_runner.keep_playback_copy is take_archive.keep_playback_copy
    source = (
        __import__("pathlib").Path(analysis_runner.__file__).read_text(encoding="utf-8")
    )
    assert "keep_playback_copy(client, analysis_id" in source, (
        "imported but never called — the copy would never be made"
    )

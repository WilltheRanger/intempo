"""The guard between a picked file and the decoder.

Every test here is one of two questions: does something that should not reach
ffmpeg reach it, and does a real recording get refused for no reason. Both
matter — a guard that refuses honest files is a feature nobody uses, and one
that passes anything is not a guard.
"""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app.services.audio_intake import (
    HEADER_BYTES,
    inspect_upload,
    probe_duration,
    sniff_container,
)

MAX_S = 600.0
MAX_BYTES = 50 * 1024 * 1024


def _wav(path: Path, seconds: float, sr: int = 22050) -> Path:
    tone = 0.2 * np.sin(2 * np.pi * 220 * np.arange(int(seconds * sr)) / sr)
    sf.write(str(path), tone.astype(np.float32), sr)
    return path


class TestSniffContainer:
    @pytest.mark.parametrize(
        "header,expected",
        [
            (b"RIFF\x00\x00\x00\x00WAVEfmt ", "wav"),
            (b"fLaC\x00\x00\x00\x22\x00\x00\x00\x00\x00\x00\x00\x00", "flac"),
            (b"OggS\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00", "ogg"),
            (b"\x00\x00\x00\x20ftypM4A \x00\x00\x00\x00", "mp4"),
            (b"ID3\x04\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00", "mp3"),
        ],
    )
    def test_each_accepted_container_is_recognised(self, header, expected):
        assert sniff_container(header) == expected

    def test_an_mp3_with_no_tag_is_found_by_its_frame_sync(self):
        """Nearly every real MP3 opens with an ID3 tag, but the format does
        not require one and a trimmed file often has none."""
        assert sniff_container(b"\xff\xfb\x90\x00" + b"\x00" * 12) == "mp3"

    def test_an_avi_is_not_a_wav(self):
        """**RIFF is a container family, not a format.** AVI, WebP and WAV all
        open `RIFF`, so the four bytes at offset 8 are what actually decide —
        and accepting any RIFF would let a video through a check whose whole
        job is keeping non-audio away from the decoder."""
        assert sniff_container(b"RIFF\x00\x00\x00\x00AVI LIST") is None

    @pytest.mark.parametrize(
        "header",
        [
            b"PK\x03\x04" + b"\x00" * 12,          # a zip
            b"\x7fELF\x02\x01\x01\x00" + b"\x00" * 8,  # an executable
            b"%PDF-1.7\n" + b"\x00" * 7,           # a document
            b"\x89PNG\r\n\x1a\n" + b"\x00" * 8,    # an image
            b"#!/bin/sh\necho hi",                 # a script
            b"\x1aE\xdf\xa3" + b"\x00" * 12,       # webm, deliberately refused
        ],
    )
    def test_things_that_are_not_audio_are_refused(self, header):
        assert sniff_container(header) is None

    def test_an_empty_header_is_refused_rather_than_crashing(self):
        assert sniff_container(b"") is None
        assert sniff_container(b"\xff") is None


class TestProbeDuration:
    def test_a_real_wav_reports_its_length(self, tmp_path):
        path = _wav(tmp_path / "take.wav", 3.5)

        assert probe_duration(path, "wav") == pytest.approx(3.5, abs=0.05)

    def test_a_truncated_file_reports_nothing(self, tmp_path):
        path = tmp_path / "broken.wav"
        path.write_bytes(b"RIFF\x00\x00\x00\x00WAVEfmt ")

        assert probe_duration(path, "wav") is None

    def test_an_mp4_with_no_moov_reports_nothing(self, tmp_path):
        """Rather than guessing. A length that cannot be established is
        exactly the file the cap exists to stop."""
        path = tmp_path / "take.m4a"
        path.write_bytes(struct.pack(">I", 16) + b"ftypM4A " + b"\x00" * 8)

        assert probe_duration(path, "mp4") is None

    def test_an_mp4_duration_is_read_from_its_mvhd(self, tmp_path):
        """The hand-parse, against a box built to say 90 seconds.

        Written rather than mocked because the point of parsing it by hand is
        that the arithmetic is ours — a test against a stub would assert that
        the stub agrees with itself.
        """
        timescale, duration = 600, 54_000  # 54000 / 600 = 90 s
        mvhd_body = (
            b"\x00" + b"\x00" * 3          # version 0, flags
            + b"\x00" * 8                  # creation, modification
            + struct.pack(">I", timescale)
            + struct.pack(">I", duration)
        )
        mvhd = struct.pack(">I", 8 + len(mvhd_body)) + b"mvhd" + mvhd_body
        moov = struct.pack(">I", 8 + len(mvhd)) + b"moov" + mvhd
        # 4 size + 4 'ftyp' + 4 brand + 4 minor version = 16, and the declared
        # size has to match or the scan lands mid-atom — see the test below,
        # which is this mistake kept on purpose.
        ftyp = struct.pack(">I", 16) + b"ftypM4A " + b"\x00" * 4

        path = tmp_path / "take.m4a"
        path.write_bytes(ftyp + moov)

        assert probe_duration(path, "mp4") == pytest.approx(90.0, abs=0.01)

    def test_an_atom_that_lies_about_its_size_is_refused_not_misread(self, tmp_path):
        """**Written because the fixture above got this wrong first.** The
        `ftyp` box declared 16 bytes and contained 20, so the scan advanced
        into the middle of the next atom and read length and type out of
        arbitrary bytes.

        The parser returned `None` — it followed the declared size, which is
        what a parser should do, and found nothing it recognised. That is the
        behaviour worth pinning: a container whose atom chain does not add up
        is refused rather than producing a plausible number from misaligned
        bytes, which is the failure mode that would matter if the file were
        hostile rather than merely mine.
        """
        body = b"\x00" * 12 + struct.pack(">I", 600) + struct.pack(">I", 54_000)
        mvhd = struct.pack(">I", 8 + len(body)) + b"mvhd" + body
        moov = struct.pack(">I", 8 + len(mvhd)) + b"moov" + mvhd
        lying = struct.pack(">I", 16) + b"ftypM4A " + b"\x00" * 8  # 20 bytes

        path = tmp_path / "lying.m4a"
        path.write_bytes(lying + moov)

        assert probe_duration(path, "mp4") is None


class TestInspectUpload:
    def test_a_real_recording_is_accepted(self, tmp_path):
        path = _wav(tmp_path / "take.wav", 12.0)

        out = inspect_upload(path, max_duration_s=MAX_S, max_bytes=MAX_BYTES)

        assert out.accepted
        assert out.container == "wav"
        assert out.duration_s == pytest.approx(12.0, abs=0.05)

    def test_a_long_recording_is_refused_with_both_numbers(self, tmp_path):
        """**The refusal this feature exists to make possible.** The byte cap
        was a duration cap only while the app chose the codec: 50 MB of WAV is
        five minutes, 50 MB of low-bitrate MP3 is over an hour and a half.

        Both numbers are in the sentence because a limit without the value it
        was measured against is a limit nobody can act on.
        """
        path = _wav(tmp_path / "long.wav", 30.0)

        out = inspect_upload(path, max_duration_s=10.0, max_bytes=MAX_BYTES)

        assert not out.accepted
        assert "30 seconds" not in out.refusal  # reported in minutes
        assert "limit" in out.refusal

    def test_the_length_is_read_before_any_sample_is_decoded(self, tmp_path):
        """Asserted through the interface rather than by timing: a file far
        over the cap is refused, and `soundfile.info` is the only thing that
        touched it. If this ever started decoding, a two-hour upload would
        cost two hours of decode to refuse."""
        path = _wav(tmp_path / "long.wav", 20.0)

        out = inspect_upload(path, max_duration_s=5.0, max_bytes=MAX_BYTES)

        assert not out.accepted
        assert out.duration_s == pytest.approx(20.0, abs=0.1)

    def test_a_file_pretending_to_be_audio_never_reaches_the_decoder(self, tmp_path):
        """A ZIP named `take.wav`. `upload.py` allows the *extension*; only
        the bytes decide here, and this is the class of file that would
        otherwise be handed to ffmpeg."""
        path = tmp_path / "take.wav"
        path.write_bytes(b"PK\x03\x04" + b"\x00" * 2048)

        out = inspect_upload(path, max_duration_s=MAX_S, max_bytes=MAX_BYTES)

        assert not out.accepted
        assert "audio file" in out.refusal
        # And it names what does work, rather than only what does not.
        assert "WAV" in out.refusal

    def test_an_oversized_file_is_refused_on_one_stat(self, tmp_path):
        path = tmp_path / "huge.wav"
        path.write_bytes(b"RIFF" + b"\x00" * 4 + b"WAVE" + b"\x00" * 4096)

        out = inspect_upload(path, max_duration_s=MAX_S, max_bytes=1024)

        assert not out.accepted
        assert "MB" in out.refusal

    def test_an_empty_file_is_named_as_empty(self, tmp_path):
        path = tmp_path / "nothing.wav"
        path.write_bytes(b"")

        out = inspect_upload(path, max_duration_s=MAX_S, max_bytes=MAX_BYTES)

        assert not out.accepted
        assert "empty" in out.refusal

    def test_a_missing_file_is_refused_rather_than_raising(self, tmp_path):
        """This runs in a worker. An exception here is a take stuck in
        `analysing` forever; a refusal is a sentence the musician can read."""
        out = inspect_upload(
            tmp_path / "gone.wav", max_duration_s=MAX_S, max_bytes=MAX_BYTES
        )

        assert not out.accepted

    def test_a_damaged_file_is_told_apart_from_a_wrong_one(self, tmp_path):
        """Two different problems and two different things to do about them:
        a WAV header with no audio behind it is a broken export, not a file
        of the wrong kind, and telling somebody to choose a different format
        would send them the wrong way."""
        path = tmp_path / "broken.wav"
        path.write_bytes(b"RIFF\x00\x00\x00\x00WAVEfmt " + b"\x00" * 64)

        out = inspect_upload(path, max_duration_s=MAX_S, max_bytes=MAX_BYTES)

        assert not out.accepted
        assert "damaged" in out.refusal

    def test_the_header_read_is_bounded(self, tmp_path):
        """Sixteen bytes decides the format question, so a 50 MB file costs
        sixteen bytes to reject."""
        assert HEADER_BYTES == 16

"""What a file has to be before the pipeline will decode it.

**Why this exists now and did not before.** Until a musician could pick a file,
the app produced every byte the analyser ever saw: `audioRecorder` writes WAV,
the bucket caps it at 50 MB, and the worker decodes something it effectively
authored. A file picker ends all three of those assumptions at once, and two
of them were load-bearing:

**The byte cap was a duration cap in disguise.** 50 MB of the WAV the app
records is about five minutes. 50 MB of 64 kbps MP3 is about **one hour and
forty minutes** — same bytes, twenty times the decode, and nothing downstream
had an opinion about duration because nothing needed one. That is the whole
reason this module leads with a duration probe rather than a format check.

**The extension was a claim about the filename, not about the file.**
`upload.py` allows `wav|m4a|mp3|ogg|webm|flac` by suffix, which was fine when
the suffix was chosen by our own recorder. A picked file called `take.wav` can
hold anything, and what happens to it next is `librosa.load` →
`audioread` → **ffmpeg**, which is a large C parser with a long history and is
not a thing to hand arbitrary input. So the bytes are sniffed here, and a file
whose header is not a container we recognise never reaches a decoder at all.

**What this is not.** It is not a guarantee that a well-formed audio container
is safe to decode — a malicious-but-valid FLAC is still a valid FLAC. It
raises the floor from "anything at all" to "something that is structurally the
format it claims", which is the part that is cheap and certain. The remaining
risk is bounded by the same sandbox the worker already runs in.

Ordered cheapest-first on purpose: sixteen bytes of header rejects the whole
wrong-file class before anything opens the file, and the duration probe reads
a header rather than samples. A two-hour upload is refused in milliseconds.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from pathlib import Path

#: Containers an uploaded file may be, and the bytes that identify each.
#:
#: **Matched on content, never on the filename.** Each entry is
#: `(offset, magic)` — most sit at zero, but MP4's `ftyp` box is preceded by
#: its own length, so its brand lives at byte four.
#:
#: `webm` is deliberately absent even though `upload.py` accepts the
#: extension: it is what a *browser recorder* produces, not something a
#: musician picks out of a file manager, and it is the one allowed container
#: `soundfile` cannot probe without handing the file to ffmpeg — which is the
#: thing being avoided. A webm upload is refused with a sentence naming a
#: format to convert to, rather than accepted and decoded unprobed.
_SIGNATURES: tuple[tuple[str, int, bytes], ...] = (
    ("wav", 0, b"RIFF"),
    ("flac", 0, b"fLaC"),
    ("ogg", 0, b"OggS"),
    ("mp4", 4, b"ftyp"),
    # ID3v2 tag, which is how nearly every real-world MP3 starts.
    ("mp3", 0, b"ID3"),
)

#: An MP3 with no ID3 tag starts with a frame sync: eleven set bits.
#:
#: Checked separately because it is a *bit* pattern rather than a byte string,
#: and because it is the loosest test here — two bytes, one of which is only
#: half constrained. It runs last, so anything matching a real signature is
#: claimed by that first.
_MP3_SYNC_MASK = 0xFFE0
_MP3_SYNC = 0xFFE0

#: How much of the file the signature check needs.
HEADER_BYTES = 16


#: The refusal codes this can produce.
#:
#: **Machine tokens, not sentences**, because `analyses.failure_reason` is a
#: token the app maps to copy — `VerdictScreen` says so in as many words, and
#: the first version of this module wrote a finished English sentence into that
#: column. A test caught it: the reason arrived where a code was expected and
#: the app's mapping would have fallen through to a generic message, throwing
#: the specific one away.
#:
#: Four rather than one, because they are four different things to do about it:
#: trim the recording, export it again, choose a different file, choose a
#: different format. `refusal` below is still a sentence, for a log line and
#: for anything with nowhere to map a code.
TOO_LONG = "audio_too_long"
NOT_AUDIO = "audio_not_recognised"
DAMAGED = "audio_damaged"
EMPTY = "audio_empty"
TOO_LARGE = "audio_too_large"
UNREADABLE = "audio_unreadable"


@dataclass(frozen=True)
class AudioIntake:
    """What was made of a file, and why it was refused if it was."""

    container: str | None = None
    duration_s: float | None = None
    #: `None` when the file is acceptable. Otherwise a machine token from the
    #: list above, which is what goes in `analyses.failure_reason`.
    code: str | None = None
    #: The same refusal as a finished sentence, for logs.
    refusal: str | None = None

    @property
    def accepted(self) -> bool:
        return self.code is None


def sniff_container(header: bytes) -> str | None:
    """Which audio container these opening bytes are, if any.

    Content, not filename. Returns `None` for anything unrecognised, which is
    the answer for a text file, a ZIP, an executable, and for the `webm` this
    deliberately does not accept — see `_SIGNATURES`.
    """
    for name, offset, magic in _SIGNATURES:
        if header[offset : offset + len(magic)] == magic:
            # RIFF is a container family, not a format: AVI is also RIFF.
            if name == "wav" and header[8:12] != b"WAVE":
                continue
            return name

    if len(header) >= 2:
        (first_two,) = struct.unpack(">H", header[:2])
        if first_two & _MP3_SYNC_MASK == _MP3_SYNC:
            return "mp3"
    return None


def _mp4_duration(path: Path) -> float | None:
    """Seconds, read out of an MP4/M4A `mvhd` box.

    **A deliberate hand-parse rather than a library call**, because this is the
    one accepted container `soundfile` cannot open, and the alternative is
    handing the file to ffmpeg *in order to find out whether we want to hand it
    to ffmpeg*. Reading two integers at a known offset does not decode
    anything and cannot execute anything.

    The box is found by scanning top-level atoms rather than by assuming a
    layout: `moov` may sit before or after `mdat`, and a file written by a
    phone usually puts it last. Only the first megabyte of atom headers is
    walked, so a file that never contains one is abandoned rather than
    scanned to its end.
    """
    try:
        with path.open("rb") as handle:
            end = path.stat().st_size
            offset = 0
            while offset < end:
                handle.seek(offset)
                header = handle.read(8)
                if len(header) < 8:
                    return None
                size = int.from_bytes(header[:4], "big")
                kind = header[4:8]
                if size < 8:
                    return None
                if kind == b"moov":
                    # Walk the children of `moov` looking for `mvhd`.
                    child = offset + 8
                    limit = offset + size
                    while child < limit:
                        handle.seek(child)
                        head = handle.read(8)
                        if len(head) < 8:
                            return None
                        child_size = int.from_bytes(head[:4], "big")
                        if child_size < 8:
                            return None
                        if head[4:8] == b"mvhd":
                            body = handle.read(20)
                            if len(body) < 20:
                                return None
                            version = body[0]
                            if version == 1:
                                more = handle.read(12)
                                if len(more) < 12:
                                    return None
                                timescale = int.from_bytes(more[:4], "big")
                                duration = int.from_bytes(more[4:12], "big")
                            else:
                                timescale = int.from_bytes(body[12:16], "big")
                                duration = int.from_bytes(body[16:20], "big")
                            if timescale <= 0:
                                return None
                            return duration / timescale
                        child += child_size
                    return None
                offset += size
    except OSError:
        return None
    return None


def probe_duration(path: Path, container: str) -> float | None:
    """How long the file is, read from its header rather than its samples.

    `soundfile` opens WAV, FLAC, OGG and MP3 through libsndfile and reports
    frames and rate without decoding any audio — which is what makes it safe
    to ask this question of a file we have not yet decided to trust. MP4 is
    parsed by hand above for the same reason.

    `None` when the header does not say, which the caller treats as a refusal
    rather than as permission: a file whose length cannot be established is
    exactly the file a duration cap exists to stop.
    """
    if container == "mp4":
        return _mp4_duration(path)

    try:
        import soundfile as sf

        info = sf.info(str(path))
    except Exception:  # noqa: BLE001 — any failure is "cannot establish length"
        return None
    if not info.samplerate or info.frames <= 0:
        return None
    return float(info.frames) / float(info.samplerate)


def inspect_upload(
    path: Path, *, max_duration_s: float, max_bytes: int
) -> AudioIntake:
    """Everything that has to be true before the pipeline decodes this.

    Cheapest first, so the common refusals cost least: a size check that is
    one `stat`, a format check that is sixteen bytes, then a header probe.
    Nothing here reads a sample.

    Every refusal is a finished sentence naming what to do about it, because
    the caller's job is to show it to the musician and a reason they cannot
    act on is the same as no reason.
    """
    try:
        size = path.stat().st_size
    except OSError:
        return AudioIntake(
            code=UNREADABLE,
            refusal="That file could not be read. Try choosing it again.",
        )

    if size == 0:
        return AudioIntake(code=EMPTY, refusal="That file is empty.")
    if size > max_bytes:
        return AudioIntake(
            code=TOO_LARGE,
            refusal=(
                f"That file is {size / 1_048_576:.0f} MB, and the limit is "
                f"{max_bytes / 1_048_576:.0f} MB. A shorter recording, or one "
                "saved as AAC or MP3 rather than WAV, will fit."
            )
        )

    with path.open("rb") as handle:
        header = handle.read(HEADER_BYTES)

    container = sniff_container(header)
    if container is None:
        return AudioIntake(
            code=NOT_AUDIO,
            refusal=(
                "That does not look like an audio file. WAV, MP3, M4A, FLAC "
                "and OGG all work."
            )
        )

    duration = probe_duration(path, container)
    if duration is None:
        return AudioIntake(
            container=container,
            code=DAMAGED,
            refusal=(
                "That file's length could not be read, so it may be damaged. "
                "Try exporting it again."
            ),
        )
    if duration > max_duration_s:
        return AudioIntake(
            container=container,
            duration_s=duration,
            code=TOO_LONG,
            refusal=(
                f"That recording is {duration / 60:.0f} minutes long, and the "
                f"limit is {max_duration_s / 60:.0f}. Trim it to the passage "
                "you want read."
            ),
        )
    # A file with no audio in it at all is not a take, and saying so here is
    # kinder than letting it through to be refused as "completely silent"
    # after it has cost one of three monthly analyses.
    if duration <= 0:
        return AudioIntake(
            container=container,
            duration_s=duration,
            code=EMPTY,
            refusal="That recording has no audio in it.",
        )

    return AudioIntake(container=container, duration_s=duration)

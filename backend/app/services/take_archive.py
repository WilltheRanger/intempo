"""What happens to a recording once it has been judged.

**A take is uploaded as 48 kHz mono 16-bit WAV — 96 KB every second — and
nothing ever deleted one.** Only deleting the piece or the whole account
removed a take's audio. Measured against the live project rather than
estimated: an active musician with twenty two-minute takes carries about
**230 MB**, so the free tier's 1 GB of storage is about **four people**, and
audio is around ninety per cent of it.

Uncompressed is right for exactly one job and it is already finished by the
time this runs. `analyze()` measures onset envelopes, and a lossy codec
reshapes attacks — the same reason `audioRecorder` turns off voice processing
and auto gain. So the WAV is what gets analysed, and what is kept afterwards is
a different question with a different answer: the verdict screen offers
playback so a musician can hear the bar they rushed, and Opus is more than
enough for that at a fraction of the bytes.

**libsndfile's default VBR, because there is no bitrate to set.** `soundfile`
exposes no rate control for Opus, so a `PLAYBACK_BITRATE` constant here would
have been a number nothing applied — the same kind of lie as a grab handle
nothing drags. Measured instead: a two-second 440 Hz sine, which is close to
the worst case a codec can be handed, went from 192 KB to 16 KB — **11.8x** —
at about 65 kbps. Real playing, with its silences and its decay, does better.

**Everything here is best effort, and the ordering says why.** The verdict is
already written and the musician is already looking at it; a failed transcode
must cost storage, never the take. So the order is: encode, upload, record the
new key, and only then delete the original — each step conditional on the last
having worked. The failure modes that leaves are all the *safe* direction:

  - encode or upload fails  → the WAV stays, playback is unchanged
  - the row write fails     → the WAV stays and an orphan Opus is left, which
                              `pending_uploads` does not sweep because nothing
                              claimed it. One object, logged.
  - the delete fails        → both copies exist, playback prefers the Opus

The one arrangement that would lose a recording — delete first, then write —
is the one this cannot do.
"""

from __future__ import annotations

import io
import logging

import numpy as np
import soundfile as sf

from app.services.audio_storage import object_key_from
from app.services.buckets import AUDIO_BUCKET
from app.services.cache_headers import CACHE_FOREVER

log = logging.getLogger("intempo.analysis")

#: What the compressed copy is called, next to the original.
#:
#: The same key with a different extension, so the two are obviously one take
#: in a storage listing and the owner prefix — which is what `owned_audio_key`
#: checks at every read boundary — is carried over unchanged rather than
#: rebuilt. A key that lost its prefix would be refused by the very endpoint
#: this exists to serve.
PLAYBACK_SUFFIX = ".opus"


def playback_key_for(reference: str) -> str | None:
    """The Opus key belonging to an original upload reference."""
    key = object_key_from(reference)
    if not key:
        return None
    stem = key.rsplit(".", 1)[0] if "." in key.rsplit("/", 1)[-1] else key
    return f"{stem}{PLAYBACK_SUFFIX}"


def to_opus(wav_bytes: bytes) -> bytes:
    """Re-encode a WAV as Opus in an Ogg container.

    Through `soundfile`, which is already a dependency and whose libsndfile
    builds Opus in — so this adds no package to a 512 MB instance and no
    `ffmpeg` to the image.

    **Opus only accepts a handful of sample rates**, 48 kHz among them, which
    is what the recorder asks for. A device that insisted on 44.1 would be
    refused by the encoder, so it is resampled to 48 kHz first — badly, by
    nearest-neighbour, and that is fine for a playback copy in a way it would
    never be for the analysis that has already happened.
    """
    data, rate = sf.read(io.BytesIO(wav_bytes), dtype="float32", always_2d=False)
    if rate not in _OPUS_RATES:
        data = _resample_to_48k(data, rate)
        rate = 48_000

    out = io.BytesIO()
    with sf.SoundFile(
        out,
        mode="w",
        samplerate=rate,
        channels=1 if data.ndim == 1 else data.shape[1],
        format="OGG",
        subtype="OPUS",
    ) as handle:
        handle.write(data)
    return out.getvalue()


#: The rates the Opus encoder will accept. Anything else has to be resampled.
_OPUS_RATES = frozenset({8_000, 12_000, 16_000, 24_000, 48_000})


def _resample_to_48k(data: "np.ndarray", rate: int) -> "np.ndarray":
    """Nearest-neighbour to 48 kHz. Good enough for a copy nobody measures."""
    if rate <= 0:
        raise ValueError(f"sample rate {rate} is not a rate")
    length = int(round(data.shape[0] * 48_000 / rate))
    index = np.minimum(
        (np.arange(length) * rate // 48_000).astype(np.int64), data.shape[0] - 1
    )
    return data[index]


def keep_playback_copy(client, analysis_id: str, reference: str, wav_bytes: bytes) -> str | None:
    """Store an Opus copy of a judged take and delete its WAV.

    Returns the new key, or None when anything at all went wrong — in which
    case the WAV is still there and the take is still playable, which is the
    whole point of doing this after the verdict rather than before it.
    """
    key = playback_key_for(reference)
    original = object_key_from(reference)
    if not key or not original or key == original:
        log.warning("analysis %s: no playback key for %r", analysis_id, reference)
        return None

    try:
        opus = to_opus(wav_bytes)
    except Exception:  # noqa: BLE001 — a take must never be lost to its copy
        log.warning("analysis %s: could not encode a playback copy", analysis_id, exc_info=True)
        return None

    bucket = client.storage.from_(AUDIO_BUCKET)
    try:
        bucket.upload(
            key,
            opus,
            # See `cache_headers.CACHE_FOREVER`: without this Supabase serves
            # the take `no-cache` and the verdict screen re-downloads it on
            # every visit.
            {
                "content-type": "audio/ogg",
                "upsert": "true",
                "cache-control": CACHE_FOREVER,
            },
        )
    except Exception:  # noqa: BLE001
        log.warning("analysis %s: could not upload %s", analysis_id, key, exc_info=True)
        return None

    try:
        client.table("analyses").update({"playback_key": key}).eq(
            "id", analysis_id
        ).execute()
    except Exception:  # noqa: BLE001
        # The row still points at the WAV, so playback works and the Opus is an
        # orphan. Named in the log because nothing sweeps it: `pending_uploads`
        # only knows about objects a client uploaded and never claimed.
        log.warning(
            "analysis %s: %s was written but the row still names the WAV; "
            "the compressed copy is orphaned",
            analysis_id, key, exc_info=True,
        )
        return None

    try:
        bucket.remove([original])
    except Exception:  # noqa: BLE001
        # Both copies exist. Playback prefers the Opus, so this costs storage
        # and nothing else — which is the direction to fail in.
        log.warning(
            "analysis %s: kept %s but could not remove %s",
            analysis_id, key, original, exc_info=True,
        )

    log.info(
        "analysis %s: playback copy %s (%d KB from %d KB)",
        analysis_id, key, len(opus) // 1024, len(wav_bytes) // 1024,
    )
    return key

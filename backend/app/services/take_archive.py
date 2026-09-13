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

**The other half is the takes that never get a verdict**, and for three days
there was nothing at all. `keep_playback_copy` runs on one path: `run_analysis`,
after the row is written `done`. A take that ends `failed` or
`failed_recoverable` keeps its WAV, and nothing else will ever remove it —
`pending_uploads` sweeps objects *nothing claimed*, and `POST /v1/analyses`
claims the object as it writes the row, correctly and permanently. So the
object ends up claimed by a row that is finished with it and reachable by no
cleanup at all: ~3 MB per failed take, for as long as takes fail.
`sweep_unjudged_takes` is that path, on a day's delay and off the sweeper loop
in `main`.

Measured on `intempo-dev` on 2026-09-13 before writing any of it, because the
report this answers said the opposite: both analyses that have ever run under
018 carry a `playback_key` and neither WAV is in the bucket — the judged path
works. The four stray `.wav` there have no `analyses` row at all and predate
018 by a fortnight.
"""

from __future__ import annotations

import io
import logging
from datetime import datetime, timedelta, timezone

import numpy as np
import soundfile as sf

from app.db import get_service_client
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


#: How long a take that will never be judged keeps its recording.
#:
#: **The audio outlives the verdict here deliberately.** A failed take is the
#: one case where the original is the whole of what is left: the verdict screen
#: says the analysis failed and the musician's playing was not the problem, and
#: draws a player underneath it. Deleting the WAV as the row turns `failed`
#: would take that away in the minutes they are most likely to use it.
#:
#: Nothing comes back to it afterwards. Both buttons that screen offers — "Try
#: again" and "Record again" — open the recorder and make a new object, and the
#: only other route back to a submitted take, `rememberPendingAnalysis`, polls
#: the row rather than resubmitting the audio. So there is no retry to break;
#: there is a musician who may still want to listen.
#:
#: A day, the same as `pending_uploads.UNCLAIMED_TTL_HOURS` and for the same
#: reason it gives: sweeping too early costs somebody a recording they are
#: still using, and sweeping too late costs a few megabytes for a few hours.
RECLAIM_AFTER = timedelta(hours=24)

#: How many takes one pass will reclaim.
#:
#: The sweep runs every five minutes for the life of the process, so a backlog
#: drains at 200 takes a pass rather than needing one big query — and a limit
#: is only safe because `audio_reclaimed_at` means a reclaimed row is never
#: selected again. Without that mark the batch would fill with work already
#: done and the newest takes would never be reached.
RECLAIM_BATCH = 200

#: The states a take ends in without ever having been judged.
#:
#: `failed_recoverable` is where the stuck-row sweeper puts a row that was
#: still `queued` or `processing` after ten minutes, so a take whose worker
#: never ran arrives here too — which is what makes this the whole set rather
#: than two thirds of it. `done` is deliberately absent even when
#: `playback_key` is null: there the transcode failed and the WAV is the only
#: copy of a take that *does* have a verdict, so it is the live recording.
UNJUDGED = ("failed", "failed_recoverable")


def sweep_unjudged_takes(client=None, *, now: datetime | None = None) -> int:
    """Delete the recordings of takes that ended without a verdict. Returns how many.

    **The object first, then the mark**, which is the same ordering rule as
    `pending_uploads.sweep_unclaimed` and for the same reason: a row marked
    before its object is deleted leaks the object permanently and silently,
    which is precisely the bug this exists to fix, reintroduced one level down.
    A mark that never lands costs one repeated delete on the next pass, and a
    delete of an object that is already gone succeeds.

    A row whose `audio_url` yields no key is marked without anything being
    removed: there is no object here to reclaim — the reference names storage
    this service does not own, which `durable_audio_reference` has made
    impossible for new rows — and leaving it unmarked would hand it to every
    future pass forever, which is the starvation `RECLAIM_BATCH` describes.

    Nothing raises. This runs on a timer beside three other sweeps, and one bad
    pass has to cost one pass.
    """
    client = client or get_service_client()
    if client is None:
        return 0

    cutoff = ((now or datetime.now(tz=timezone.utc)) - RECLAIM_AFTER).isoformat()
    try:
        rows = (
            client.table("analyses")
            .select("id,audio_url")
            .in_("status", list(UNJUDGED))
            # Not `playback_key is null` as a nicety: a row that has one has
            # had its WAV deleted already, by `keep_playback_copy`, and the
            # only thing left at that key is the Opus playback depends on.
            .is_("playback_key", "null")
            .is_("audio_reclaimed_at", "null")
            .lt("updated_at", cutoff)
            .limit(RECLAIM_BATCH)
            .execute()
        ).data or []
    except Exception:  # noqa: BLE001 — the loop outlives any one failure
        log.warning("could not list takes to reclaim", exc_info=True)
        return 0

    reclaimed = 0
    for row in rows:
        analysis_id = row.get("id")
        key = object_key_from(str(row.get("audio_url") or ""))
        if not analysis_id:
            continue
        if key:
            try:
                client.storage.from_(AUDIO_BUCKET).remove([key])
            except Exception:  # noqa: BLE001
                # Left unmarked on purpose: the next pass tries again. An
                # object that no longer exists removes cleanly, so a repeated
                # failure here means storage is unreachable, not a bad key.
                log.warning(
                    "analysis %s: could not reclaim %s", analysis_id, key, exc_info=True
                )
                continue
        try:
            client.table("analyses").update(
                {"audio_reclaimed_at": _now_iso()}
            ).eq("id", analysis_id).execute()
        except Exception:  # noqa: BLE001
            log.warning(
                "analysis %s: reclaimed %s but could not mark the row",
                analysis_id, key, exc_info=True,
            )
        reclaimed += 1

    if reclaimed:
        log.info("reclaimed the audio of %d unjudged take(s)", reclaimed)
    return reclaimed


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()

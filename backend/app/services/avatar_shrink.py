"""A profile picture over the size limit, replaced once by a 512px copy.

**Measured on the live project, 2026-09-23:** the four avatars in use were
1.1 MB, 5.2 MB, 401 kB and 12 kB — for a picture drawn in a 76pt circle. The app
has shrunk a photograph before uploading it since 2026-09-10
(`mobile/src/data/profile/avatarImage.ts`), and the 12 kB one is that working.
The two large ones predate it. The 401 kB one got past it: that resize fails
open by design and uploads the original, so a phone whose browser could not
decode the picture sent the whole thing. Profile waited on those bytes, and the
owner's report was that it "still takes time to load".

So the server makes sure, and it makes sure after the fact rather than at the
upload: the bytes go from the phone straight to storage on a signed URL, and
the server never holds them on the way in. The first time `/v1/me` names an
avatar in this process, the object is read **after the response has gone**,
and one over `AVATAR_MAX_BYTES` is re-encoded here.

**A new key, never an overwrite.** Every upload is served
`immutable` (`cache_headers.py`), which is safe only because keys are never
reused; writing smaller bytes under the old key would leave every browser that
already has the large ones holding them for a year. The row moves to the new key
**only if it still names the old one**, so a photograph uploaded while this ran
is left alone and the copy is thrown away. The new object is recorded as a
pending upload before it is written and claimed once the row names it — the
invariant `pending_uploads.py` keeps for every object in these buckets.

Never raises. A profile picture is decoration, and this runs in a background
task behind the call that provisions the account.
"""

from __future__ import annotations

import io
import logging
import threading
import uuid
from typing import Any
from uuid import UUID

from app.services import pending_uploads
from app.services.buckets import AVATAR_BUCKET
from app.services.cache_headers import CACHE_FOREVER

log = logging.getLogger("intempo.me")

#: The app's own limit (`AVATAR_MAX_EDGE` in `avatarImage.ts`), so a picture
#: this writes is the same picture a working upload would have been.
AVATAR_MAX_EDGE = 512

#: Above this an avatar is re-encoded. A 512px JPEG of a face is 30–60 kB; this
#: leaves room for an unusually detailed one without re-encoding it for nothing.
AVATAR_MAX_BYTES = 200 * 1024

_QUALITY = 80

#: Keys already looked at in this process, so `/v1/me` on every launch reads a
#: given object once per deploy rather than once per request. Bounded: one entry
#: per musician with a picture.
_checked: set[str] = set()
_CHECKED_MAX = 4096
_lock = threading.Lock()


def reset() -> None:
    """For tests. The memo is process state, and tests must not share it."""
    with _lock:
        _checked.clear()


def shrunk_avatar(data: bytes) -> bytes | None:
    """The picture as a JPEG no longer than `AVATAR_MAX_EDGE` on either side.

    None when it cannot be decoded, or when the result would not be smaller —
    there is no point replacing a picture with a larger one.
    """
    try:
        from PIL import Image, ImageOps
    except ImportError:  # pragma: no cover — Pillow is a declared dependency
        return None

    # The same HEIC opener the page pipeline registers: an iPhone's own format.
    from app.services.page_image import _register_heif

    _register_heif()
    try:
        with Image.open(io.BytesIO(data)) as image:
            # Orientation before size, or the long edge is measured on the
            # wrong axis and a portrait photograph comes back on its side.
            image = ImageOps.exif_transpose(image)
            if image.mode != "RGB":
                image = image.convert("RGB")
            image.thumbnail((AVATAR_MAX_EDGE, AVATAR_MAX_EDGE), Image.Resampling.LANCZOS)
            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=_QUALITY, optimize=True)
            encoded = buffer.getvalue()
    except Exception as exc:  # noqa: BLE001 — decode failures of every kind
        log.warning("could not re-encode an avatar: %s", exc)
        return None
    return encoded if len(encoded) < len(data) else None


def shrink_if_oversized(client: Any, user_id: UUID, key: str) -> str | None:
    """Replace an oversized avatar with a small copy. Returns the new key, if any."""
    with _lock:
        if key in _checked:
            return None
        if len(_checked) >= _CHECKED_MAX:
            _checked.clear()
        _checked.add(key)

    bucket = client.storage.from_(AVATAR_BUCKET)
    try:
        data = bucket.download(key)
    except Exception as exc:  # noqa: BLE001 — storage down, key gone, permissions
        log.warning("could not read avatar %s to check its size: %s", key, exc)
        return None
    if not isinstance(data, (bytes, bytearray)) or len(data) <= AVATAR_MAX_BYTES:
        return None

    small = shrunk_avatar(bytes(data))
    if small is None:
        return None

    # The same shape `routers/upload.py::_build_object_key` mints, so the
    # ownership check (`_own_avatar_key`: the account's id, then one segment)
    # accepts it like any other.
    new_key = f"{user_id}/{uuid.uuid4()}.jpg"
    pending_uploads.record(user_id, AVATAR_BUCKET, new_key)
    try:
        bucket.upload(
            new_key,
            small,
            {"content-type": "image/jpeg", "cache-control": CACHE_FOREVER},
        )
        moved = (
            client.table("users")
            .update({"avatar_key": new_key})
            .eq("id", str(user_id))
            .eq("avatar_key", key)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("could not replace oversized avatar %s: %s", key, exc)
        _remove(bucket, new_key)
        return None

    if not (moved.data or []):
        # A new photograph arrived while this ran. Theirs wins.
        _remove(bucket, new_key)
        return None

    pending_uploads.claim(AVATAR_BUCKET, [new_key])
    _remove(bucket, key)
    log.info(
        "avatar %s re-encoded: %d bytes -> %d, now %s", key, len(data), len(small), new_key
    )
    return new_key


def _remove(bucket: Any, key: str) -> None:
    try:
        bucket.remove([key])
    except Exception as exc:  # noqa: BLE001 — logged; the sweep or a later pass
        log.warning("could not remove avatar object %s: %s", key, exc)

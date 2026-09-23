"""An oversized profile picture is replaced once by a 512px copy.

Measured on the live project on 2026-09-23: the avatars in use were 1.1 MB,
5.2 MB, 401 kB and 12 kB, for a picture drawn in a 76pt circle, and Profile
waited on those bytes. The app shrinks before uploading, but only since
2026-09-10 and only when the phone can decode the picture; this is the server
making sure. See `services/avatar_shrink.py`.
"""

from __future__ import annotations

import io
import random
from typing import Any
from uuid import UUID, uuid4

import pytest
from PIL import Image

from app.services import avatar_shrink, pending_uploads
from app.services.buckets import AVATAR_BUCKET
from app.tests.fake_supabase import FakeSupabase


def _photo(width: int, height: int) -> bytes:
    """A noisy JPEG, so it is as large as a real photograph of that size."""
    rng = random.Random(width * 31 + height)
    image = Image.frombytes(
        "RGB", (width, height), bytes(rng.getrandbits(8) for _ in range(width * height * 3))
    )
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=92)
    return buffer.getvalue()


class _Bucket:
    """The fake bucket, plus `download`, counted."""

    def __init__(self, inner: Any, *, down: bool = False) -> None:
        self.inner = inner
        self.down = down
        self.downloads = 0

    def download(self, key: str) -> bytes:
        self.downloads += 1
        if self.down:
            raise RuntimeError("storage unreachable")
        return self.inner.objects[key]

    def upload(self, key: str, data: bytes, options: dict | None = None) -> None:
        self.inner.upload(key, data, options)

    def remove(self, keys: list[str]) -> list[dict]:
        return self.inner.remove(keys)


class _Storage:
    def __init__(self, bucket: _Bucket) -> None:
        self.bucket = bucket

    def from_(self, name: str) -> _Bucket:
        assert name == AVATAR_BUCKET
        return self.bucket


@pytest.fixture(autouse=True)
def _fresh_memo():
    avatar_shrink.reset()
    yield
    avatar_shrink.reset()


def _account(photo: bytes, *, down: bool = False) -> tuple[FakeSupabase, _Bucket, UUID, str]:
    sb = FakeSupabase()
    user_id = uuid4()
    key = f"{user_id}/face.jpg"
    sb.put_object(AVATAR_BUCKET, key, photo)
    sb.seed("users", [{"id": str(user_id), "avatar_key": key}])
    bucket = _Bucket(sb.storage.from_(AVATAR_BUCKET), down=down)
    sb.storage = _Storage(bucket)  # type: ignore[assignment]
    return sb, bucket, user_id, key


@pytest.fixture()
def pending(monkeypatch: pytest.MonkeyPatch) -> FakeSupabase:
    """`pending_uploads` reaches for its own client; give it one to write to."""
    ledger = FakeSupabase()
    monkeypatch.setattr(pending_uploads, "get_service_client", lambda: ledger)
    return ledger


def test_a_large_photograph_is_replaced_by_a_small_one_under_a_new_key(pending) -> None:
    big = _photo(1600, 1200)
    assert len(big) > avatar_shrink.AVATAR_MAX_BYTES
    sb, bucket, user_id, key = _account(big)

    new_key = avatar_shrink.shrink_if_oversized(sb, user_id, key)

    assert new_key is not None and new_key != key
    # The shape `_own_avatar_key` accepts: the account's id, then one segment.
    assert new_key.startswith(f"{user_id}/") and "/" not in new_key[len(f"{user_id}/"):]
    assert sb.table("users").rows[0]["avatar_key"] == new_key
    small = bucket.inner.objects[new_key]
    assert len(small) <= avatar_shrink.AVATAR_MAX_BYTES
    with Image.open(io.BytesIO(small)) as image:
        assert max(image.size) == avatar_shrink.AVATAR_MAX_EDGE
        assert image.size == (512, 384)
    # Never an overwrite: the old object is gone rather than rewritten, because
    # every avatar is served `immutable`.
    assert key not in bucket.inner.objects
    # Recorded before it was written and claimed once the row named it.
    assert pending.table(pending_uploads.TABLE).rows == []


def test_a_small_photograph_is_left_alone(pending) -> None:
    sb, bucket, user_id, key = _account(_photo(300, 300))

    assert avatar_shrink.shrink_if_oversized(sb, user_id, key) is None
    assert sb.table("users").rows[0]["avatar_key"] == key
    assert set(bucket.inner.objects) == {key}


def test_a_photograph_uploaded_meanwhile_wins(pending) -> None:
    sb, bucket, user_id, key = _account(_photo(1600, 1200))
    # The musician chose a new picture while this was reading the old one.
    newer = f"{user_id}/newer.jpg"
    sb.table("users").rows[0]["avatar_key"] = newer

    assert avatar_shrink.shrink_if_oversized(sb, user_id, key) is None
    assert sb.table("users").rows[0]["avatar_key"] == newer
    # The copy nobody points at is not left behind.
    assert set(bucket.inner.objects) == {key}


def test_each_picture_is_read_once_per_process(pending) -> None:
    sb, bucket, user_id, key = _account(_photo(300, 300))

    avatar_shrink.shrink_if_oversized(sb, user_id, key)
    avatar_shrink.shrink_if_oversized(sb, user_id, key)

    assert bucket.downloads == 1


def test_storage_being_down_changes_nothing(pending) -> None:
    sb, bucket, user_id, key = _account(_photo(1600, 1200), down=True)

    assert avatar_shrink.shrink_if_oversized(sb, user_id, key) is None
    assert sb.table("users").rows[0]["avatar_key"] == key


def test_bytes_that_are_not_a_picture_are_left_alone(pending) -> None:
    sb, _bucket, user_id, key = _account(b"\x00" * (avatar_shrink.AVATAR_MAX_BYTES + 1))

    assert avatar_shrink.shrink_if_oversized(sb, user_id, key) is None
    assert sb.table("users").rows[0]["avatar_key"] == key


def test_a_portrait_comes_back_upright() -> None:
    """EXIF orientation 6 is how a phone stores a portrait: landscape pixels
    and a note to turn them. Measured on the wrong axis, the picture shrinks
    sideways."""
    image = Image.new("RGB", (1600, 1200), (200, 50, 50))
    exif = image.getexif()
    exif[0x0112] = 6
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=95, exif=exif)

    small = avatar_shrink.shrunk_avatar(buffer.getvalue())

    assert small is not None
    with Image.open(io.BytesIO(small)) as out:
        assert out.size == (384, 512)

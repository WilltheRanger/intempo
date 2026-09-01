"""Durable private-storage handoff for practice recordings."""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.services.audio_storage import (
    AudioStorageError,
    durable_audio_reference,
    object_key_from,
    readable_audio_url,
)


class _Bucket:
    def __init__(self, answer):
        self.answer = answer
        self.calls: list[tuple[str, int]] = []

    def create_signed_url(self, key: str, ttl: int):
        self.calls.append((key, ttl))
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


class _Storage:
    def __init__(self, bucket: _Bucket):
        self.bucket = bucket

    def from_(self, _name: str) -> _Bucket:
        return self.bucket


class _Client:
    def __init__(self, bucket: _Bucket):
        self.storage = _Storage(bucket)


def test_upload_permission_yields_the_same_object_key() -> None:
    user_id = uuid4()
    url = (
        "https://project.supabase.co/storage/v1/object/upload/sign/"
        f"audio-uploads/{user_id}/take.wav?token=short-lived"
    )

    assert object_key_from(url) == f"{user_id}/take.wav"


def test_durable_reference_contains_no_upload_token() -> None:
    user_id = uuid4()

    reference = durable_audio_reference(f"{user_id}/take.wav", user_id)

    assert f"/object/authenticated/audio-uploads/{user_id}/take.wav" in reference
    assert "token=" not in reference


def test_worker_signs_a_fresh_download_from_the_durable_reference() -> None:
    user_id = uuid4()
    bucket = _Bucket({"signedURL": f"/object/sign/audio-uploads/{user_id}/take.wav?token=fresh"})
    reference = durable_audio_reference(f"{user_id}/take.wav", user_id)

    url = readable_audio_url(_Client(bucket), reference)

    assert url.endswith(f"/object/sign/audio-uploads/{user_id}/take.wav?token=fresh")
    assert bucket.calls and bucket.calls[0][0] == f"{user_id}/take.wav"


def test_private_reference_never_falls_back_to_an_unauthenticated_get() -> None:
    user_id = uuid4()
    reference = durable_audio_reference(f"{user_id}/take.wav", user_id)
    bucket = _Bucket(RuntimeError("storage unavailable"))

    with pytest.raises(AudioStorageError, match="could not sign"):
        readable_audio_url(_Client(bucket), reference)

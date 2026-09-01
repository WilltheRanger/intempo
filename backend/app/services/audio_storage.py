"""Durable references and fresh read URLs for private practice recordings.

The upload endpoint grants one short-lived PUT permission and also returns the
object key it names. Analysis rows keep a token-free authenticated reference
built from that key. Workers sign a fresh GET URL immediately before reading,
so neither a slow retry nor a queued worker depends on the upload token.
"""

from __future__ import annotations

from urllib.parse import urlparse
from uuid import UUID

from app.config import settings
from app.services.buckets import AUDIO_BUCKET

STORAGE_PREFIXES = (
    "/storage/v1/object/sign/",
    "/storage/v1/object/upload/sign/",
    "/storage/v1/object/authenticated/",
    "/storage/v1/object/public/",
)
SIGNED_AUDIO_DOWNLOAD_TTL_SECONDS = 60 * 60


class InvalidAudioReference(ValueError):
    """A recording reference is malformed or belongs to another account."""


class AudioStorageError(RuntimeError):
    """A recording key could not be turned into a readable storage URL."""


def object_key_from(reference: str) -> str | None:
    """Recover an audio object key from a durable reference or storage URL."""
    parsed = urlparse(reference)
    if not parsed.scheme:
        if (
            parsed.netloc
            or reference.startswith(("/", "\\"))
            or any(mark in reference for mark in ("?", "#"))
        ):
            return None
        key = reference.removeprefix(f"{AUDIO_BUCKET}/")
        return key or None

    if parsed.scheme not in {"http", "https"}:
        return None
    for prefix in STORAGE_PREFIXES:
        marker = f"{prefix}{AUDIO_BUCKET}/"
        if parsed.path.startswith(marker):
            key = parsed.path[len(marker) :]
            return key or None
    return None


def owned_audio_key(reference: str, user_id: UUID) -> str:
    """Return the key when it names exactly one object owned by this account."""
    key = object_key_from(reference)
    owner, separator, filename = (key or "").partition("/")
    if (
        owner != str(user_id)
        or not separator
        or not filename
        or "/" in filename
        or "\\" in filename
        or filename in {".", ".."}
    ):
        raise InvalidAudioReference(
            "recording reference must name audio owned by your account"
        )
    return key


def durable_audio_reference(reference: str, user_id: UUID) -> str:
    """Canonical token-free value stored on an analysis row."""
    key = owned_audio_key(reference, user_id)
    return (
        f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1/object/authenticated/"
        f"{AUDIO_BUCKET}/{key}"
    )


def readable_audio_url(client, reference: str) -> str:
    """Sign a fresh download URL for a stored recording reference.

    Historical rows may already contain a signed readable URL. If its key
    cannot be recovered, keep that old behaviour. New rows always have a key;
    failure to sign one is explicit so the worker reports audio_unavailable
    instead of attempting an unauthenticated GET on a private object.
    """
    key = object_key_from(reference)
    if key is None:
        return reference

    try:
        signed = client.storage.from_(AUDIO_BUCKET).create_signed_url(
            key, SIGNED_AUDIO_DOWNLOAD_TTL_SECONDS
        )
    except Exception as exc:  # provider/SDK failures vary
        # Historical rows may already carry a GET-capable signed/public URL.
        # Keep them usable during a rolling deploy and in degraded storage
        # clients. Never fall back for upload/authenticated URLs: neither is a
        # readable private URL without a fresh signature.
        path = urlparse(reference).path
        if any(
            path.startswith(prefix)
            for prefix in (
                f"/storage/v1/object/sign/{AUDIO_BUCKET}/",
                f"/storage/v1/object/public/{AUDIO_BUCKET}/",
            )
        ):
            return reference
        raise AudioStorageError(f"could not sign recording download: {exc}") from exc

    if isinstance(signed, dict):
        fresh = (
            signed.get("signedURL")
            or signed.get("signedUrl")
            or signed.get("signed_url")
        )
        if fresh:
            fresh = str(fresh)
            if fresh.startswith("http"):
                return fresh
            return f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1{fresh}"

    raise AudioStorageError("storage did not return a recording download URL")

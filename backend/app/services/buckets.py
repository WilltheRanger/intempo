"""The names of the storage buckets, in one place a worker can reach.

**Why this is not in `routers/upload.py` any more.** It was, and
`services/page_image.py` imported it from there — so reading a page pulled in
the router, which pulls in `app.auth`, which pulls in FastAPI and PyJWT. None
of that is wrong on the API host, where all of it is loaded anyway.

It was fatal on Modal. The transcription image deliberately ships the
application without its web layer (`ignore=["**/routers/**"]`), because a
container that reads photographs has no business carrying an HTTP API — so
`from app.routers.upload import SCORE_BUCKET` raised `ModuleNotFoundError`
about ten milliseconds into every single call. Measured on the Modal dashboard:
`transcribe_score`, startup 3.13 s, **execution 11 ms, Failed**, twice, for
every read that has ever been dispatched there.

Nothing reported it. `spawn` had succeeded, the row was Modal's to write and
Modal died before writing anything, so the API saw a row that had not changed
and the sweeper called it "stopped before it finished" — which is what a *slow*
page looks like too.

A constant shared by a router and a worker belongs to neither. It lives here,
imports nothing, and cannot drag a web framework into a container again.
"""

from __future__ import annotations

from urllib.parse import urlparse

#: Practice recordings. Read by `analysis_runner`, written by the app.
AUDIO_BUCKET = "audio-uploads"

#: Photographed pages. Transient — deleted when a reading is accepted.
SCORE_BUCKET = "score-images"

#: Profile pictures. Persist for the life of the account (migration 009).
AVATAR_BUCKET = "avatars"


#: Every path shape a Supabase storage URL takes, as this backend hands them
#: out. Shared by the routers' ownership validators AND the workers' key
#: re-derivation, and it lives HERE — not in page_image — for the same reason
#: the bucket names do: the analysis worker needs it, and importing the web
#: layer from a worker is what the module docstring above warns about.
STORAGE_PREFIXES = (
    "/storage/v1/object/sign/",
    "/storage/v1/object/upload/sign/",
    "/storage/v1/object/authenticated/",
    "/storage/v1/object/public/",
)


def object_key_from(url: str, bucket: str = SCORE_BUCKET) -> str | None:
    """`<user_id>/<uuid>.<ext>` out of a stored storage URL, or None.

    Stored URLs hold whatever the app sent at enqueue time — often the signed
    *upload* URL, which stops working minutes after issue — so fetching the
    object later means re-deriving its key and signing (or reading) fresh.
    The key is in the URL's path; this pulls it back out.

    Storing the key on the row would be tidier than re-deriving it, and is the
    right follow-up. It needs a migration and a backfill, and the derivation is
    safe today because the routers' ownership validators have already refused
    any URL that isn't one of these shapes.
    """
    path = urlparse(url).path
    for prefix in STORAGE_PREFIXES:
        marker = f"{prefix}{bucket}/"
        if path.startswith(marker):
            key = path[len(marker) :]
            return key or None
    return None

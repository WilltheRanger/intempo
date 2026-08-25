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

#: Practice recordings. Read by `analysis_runner`, written by the app.
AUDIO_BUCKET = "audio-uploads"

#: Photographed pages. Transient — deleted when a reading is accepted.
SCORE_BUCKET = "score-images"

#: Profile pictures. Persist for the life of the account (migration 009).
AVATAR_BUCKET = "avatars"

"""Shared dependencies for the HTTP layer.

Kept beside the routers rather than in `app/db.py` on purpose: this raises
`HTTPException`, which is an HTTP concern, and `db.py` is imported by the
workers — `analysis_runner` and `transcription_runner` run in the Modal
container, and there is no reason for them to pull FastAPI in behind a
database helper.
"""

from __future__ import annotations

import logging
from supabase import Client

from app import db
from app.errors import server_fault

log = logging.getLogger("intempo.api")


def require_service_client() -> Client:
    """The service-role client, or a 500 that says why.

    `get_service_client()` returns `None` when the URL or the service-role key
    is unset, which is a deployment fault rather than anything the request did
    — so it is a 500 naming the missing configuration, not a 404 or a silent
    empty result.

    **This was three byte-identical private copies**, one each in
    `analyses.py`, `corrections.py` and `scores.py`. Every route that touches
    storage or another user's row goes through it, so three copies of the
    check was three places for one of them to stop matching the others.

    Called through the `db` module rather than a `from … import` binding so
    that faking the service client for the whole HTTP layer is one
    `monkeypatch.setattr(app.db, "get_service_client", …)`. Importing the name
    here would make *this* module the patch point instead, which is one more
    place a test has to know about and gains nothing.
    """
    client = db.get_service_client()
    if client is None:
        raise server_fault(
            log,
            "Supabase service-role client is not configured",
            "The server isn't fully set up right now. Try again later.",
        )
    return client

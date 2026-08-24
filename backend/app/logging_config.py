"""Letting this service's own log lines out of whatever process it is in.

**Its own module because the Modal container cannot import `app.main`.** This
lived there, beside the FastAPI app, and the transcription image does not
install FastAPI — so the one process whose logs are the only window onto what an
OMR engine did to a page could not call the function that makes logging work at
all. The API is not the only thing that runs this code.
"""

from __future__ import annotations

import logging

log = logging.getLogger("intempo")


def configure_logging() -> None:
    """Let this service's own log lines out of the process.

    **Nothing configured logging at all**, so the effective level was Python's
    default of WARNING and every `log.info` in the codebase — twenty-seven of
    them — was discarded in production. That is not a cosmetic gap: those lines
    are the only account of what the reader actually did, and the hosting logs
    are the only diagnostic channel that works when the API itself cannot be
    reached. "read 10 systems separately: 78 measures, 431 notes" is the single
    line that says whether reading a page a stave at a time is working, and it
    never left the process.

    Only this service's logger is raised. Root stays where uvicorn put it, so
    request logs and library chatter are unchanged — the goal is to hear what
    this code says, not everything.

    A handler is added **only when nothing else has one**. Under uvicorn the
    root logger already has one and these records propagate to it; adding a
    second would print every line twice. Without uvicorn — a script, a test, a
    worker — there is no handler at all, and `logging.lastResort` carries
    WARNING and above only, so INFO would still vanish.
    """
    # Read when called, not bound at import — the same rule `_default_chain`
    # states for the provider chain. This resolves *configuration*, and a
    # snapshot taken at import time is a different claim: one that happens to be
    # true in production, where nothing reloads, and quietly false anywhere it
    # does. `test_cors` reloads `app.config`, which makes a new `settings`; a
    # module-level import here kept the old one and silently ignored every
    # change to `LOG_LEVEL`.
    from app.config import settings

    level = logging.getLevelName(settings.LOG_LEVEL.strip().upper())
    if not isinstance(level, int):
        level = logging.INFO
    log.setLevel(level)
    if not logging.getLogger().handlers and not log.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(
            logging.Formatter("%(levelname)s %(name)s: %(message)s")
        )
        log.addHandler(handler)

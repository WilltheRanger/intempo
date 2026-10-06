"""A server fault, said twice: once for the musician, once for the log.

`HTTPException(500, detail="failed to persist score")` put the second
sentence in front of the first person. The app shows a 5xx's `detail` as it
arrives — rightly, because much of what this API writes was written for a
musician ("Could not prepare this piece for deletion. Try again.") — so a
diagnostic in `detail` reached the screen word for word: "failed to persist
score", "Failed to provision user row", "Supabase service-role client is not
configured", and from calibration whatever `httpx` said about the network.
The owner chose, 2026-10-06, to rewrite them rather than have the app guess
which details are sentences.

The diagnostic is not thrown away: it goes to the area's logger, which is the
reader it was always for.
"""

import logging

from fastapi import HTTPException, status


def server_fault(
    log: logging.Logger,
    diagnostic: str,
    sentence: str,
    *,
    status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR,
) -> HTTPException:
    """Log `diagnostic`; return the exception that tells the musician `sentence`."""
    log.error("%s", diagnostic)
    return HTTPException(status_code=status_code, detail=sentence)

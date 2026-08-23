from fastapi import APIRouter, Response

from app.services.readiness import check

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    """Is the process alive.

    Deliberately trivial and deliberately dependency-free. Render's health
    check points here, so anything that can fail in it can take a working
    deployment offline. "Can it do anything useful" is `/v1/ready`.
    """
    return {"status": "ok"}


@router.get("/ready")
def ready(response: Response) -> dict:
    """What this deployment can actually do, and what is stopping it.

    Open it in a browser. It names the settings that are missing and the
    migrations that have not been applied — **never a value**, so it is safe to
    read on a phone or paste into a chat.

    503 when something blocking is unset, so a script can tell without parsing.
    Not wired to Render's health check: a deployment missing its keys should
    stay up and say so, rather than crash-loop and say nothing.
    """
    result = check()
    response.status_code = 200 if result.ready else 503
    return result.as_dict()

from fastapi import APIRouter, Header, Response

from app.services.readiness import check, cors_probe

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
def ready(
    response: Response,
    origin: str | None = None,
    origin_header: str | None = Header(default=None, alias="Origin"),
) -> dict:
    """What this deployment can actually do, and what is stopping it.

    Open it in a browser. It names the settings that are missing and the
    migrations that have not been applied — **never a value**, so it is safe to
    read on a phone or paste into a chat.

    503 when something blocking is unset, so a script can tell without parsing.
    Not wired to Render's health check: a deployment missing its keys should
    stay up and say so, rather than crash-loop and say nothing.

    **`?origin=` asks a different kind of question.** Every other check here
    reports whether a setting is present. `cors_allowed_origins` passes for any
    value it holds, including one that names an origin the deployed web app
    does not have — and the browser's report of that difference is a thrown
    fetch with no status, which looks exactly like this API being down. Given
    an origin, this answers whether a browser there would actually be allowed
    through, evaluated against the same values `CORSMiddleware` was built with.

    A real preflight carries `Origin`, so that is used when no query parameter
    is given. Someone opening this in a browser tab sends none, which is why
    the parameter exists at all.
    """
    result = check()
    probed = origin or origin_header
    if probed:
        result.checks.append(cors_probe(probed))
    response.status_code = 200 if result.ready else 503
    return result.as_dict()

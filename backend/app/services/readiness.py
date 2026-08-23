"""What this deployment can actually do, and what is stopping it.

`/v1/health` answers "is the process alive", which is what Render's health
check needs and all it needs. It answered 200 on a deployment with no
service-role key, no model key and a database missing a column the code writes
to — so the dashboard said **live** while every single write returned 500.

That is the failure this module exists to make impossible to have silently. A
musician who cannot sign in, or whose first take fails, has no way to tell a
missing key from a bug, and neither has anyone helping them.

**Never reports a value.** Only the *name* of a setting and whether it is
present. The whole point is that this can be opened in a browser on a phone.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from app.config import settings
from app.db import get_service_client

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Check:
    name: str
    ok: bool
    #: What this being false costs the musician, in their terms — not the
    #: exception text. "You cannot save a piece" beats "NoneType has no
    #: attribute table".
    detail: str
    #: False for a check whose failure degrades a feature rather than stopping
    #: the app. A missing Stripe key is not a broken app.
    blocking: bool = True

    def as_dict(self) -> dict:
        return {
            "name": self.name,
            "ok": self.ok,
            "detail": self.detail,
            "blocking": self.blocking,
        }


#: Columns this build writes to that a migration had to add.
#:
#: Kept because the schema is applied **by hand** through the Supabase SQL
#: editor — nothing auto-applies `app/migrations/*.sql` — so shipping code and
#: applying its migration are two separate acts and the gap between them is
#: invisible. It has already happened once: `analyses.instrument` went live in
#: code before the column existed, and every take submission would have failed
#: with a column-not-found error that reads like a server bug.
#:
#: Add a row here whenever a migration adds a column the code depends on.
REQUIRED_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("scores", "transcription_status", "006"),
    ("scores", "transcription_accepted_at", "007"),
    ("analyses", "instrument", "008"),
)


@dataclass
class Readiness:
    checks: list[Check] = field(default_factory=list)

    @property
    def ready(self) -> bool:
        return all(c.ok for c in self.checks if c.blocking)

    @property
    def blocking(self) -> list[str]:
        return [c.detail for c in self.checks if c.blocking and not c.ok]

    def as_dict(self) -> dict:
        return {
            "ready": self.ready,
            "blocking": self.blocking,
            "checks": [c.as_dict() for c in self.checks],
        }


def _configuration_checks() -> list[Check]:
    """Settings only. No network, so this half always answers."""
    checks = [
        Check(
            name="supabase_url",
            ok=bool(settings.SUPABASE_URL),
            detail="SUPABASE_URL is not set — there is no project to talk to.",
        ),
        Check(
            name="supabase_anon_key",
            ok=bool(settings.SUPABASE_KEY),
            detail="SUPABASE_KEY is not set — tokens cannot be verified, so every request is unauthenticated.",
        ),
        Check(
            name="supabase_service_role_key",
            ok=bool(settings.SUPABASE_SERVICE_ROLE_KEY),
            detail=(
                "SUPABASE_SERVICE_ROLE_KEY is not set — nothing can be written. "
                "Saving a piece, recording a take and running an analysis all fail."
            ),
        ),
    ]

    # One check per provider in the configured chain, because a chain whose
    # first entry has no key is not broken — it falls through to the next.
    # Only a chain with *no* usable entry stops sheet music being read.
    from app.services.ocr.pipeline import _default_chain

    try:
        chain = _default_chain()
    except Exception as exc:  # noqa: BLE001 — a bad chain name is a config error
        checks.append(
            Check(
                name="ocr_provider_chain",
                ok=False,
                detail=f"OCR_PROVIDER_CHAIN cannot be resolved: {exc}",
            )
        )
        return checks

    from app.services.ocr.pipeline import unknown_provider_names

    if unknown_provider_names:
        checks.append(
            Check(
                name="ocr_provider_chain",
                ok=False,
                detail=(
                    f"OCR_PROVIDER_CHAIN names {unknown_provider_names} are not known "
                    "to this build and were skipped — usually a model that has been "
                    "renamed. Update the setting."
                ),
                # Not blocking on its own: the rest of the chain still runs.
                # `sheet_music_reading` below is what says whether any of it can.
                blocking=False,
            )
        )

    usable = []
    for provider in chain:
        setting = getattr(provider, "api_key_setting", "")
        present = bool(getattr(settings, setting, ""))
        if present:
            usable.append(provider.name)
        checks.append(
            Check(
                name=f"ocr:{provider.name}",
                ok=present,
                detail=f"{setting} is not set, so {provider.name} cannot be used.",
                blocking=False,
            )
        )

    checks.append(
        Check(
            name="sheet_music_reading",
            ok=bool(usable),
            detail=(
                "No model key is set, so a photographed page cannot be read at all. "
                "Importing a MusicXML file still works — that path uses no model."
            ),
        )
    )
    return checks


def _schema_checks(client) -> list[Check]:
    """That the database has the columns this build writes to.

    One request per column, selected with `limit=0`: PostgREST validates the
    column list before returning anything, so an unknown column errors and a
    known one costs no rows.
    """
    checks = []
    for table, column, migration in REQUIRED_COLUMNS:
        try:
            client.table(table).select(column).limit(1).execute()
            ok, detail = True, ""
        except Exception as exc:  # noqa: BLE001 — any failure is "not usable"
            ok = False
            detail = (
                f"`{table}.{column}` is missing — apply "
                f"`backend/app/migrations/{migration}_*.sql` in the Supabase SQL "
                f"editor. Until then anything writing {table} fails. ({type(exc).__name__})"
            )
        checks.append(Check(name=f"schema:{table}.{column}", ok=ok, detail=detail))
    return checks


def check() -> Readiness:
    """Everything, configuration first so a missing key explains a dead database."""
    result = Readiness(checks=_configuration_checks())

    client = get_service_client()
    if client is None:
        result.checks.append(
            Check(
                name="database",
                ok=False,
                detail="Not attempted — there is no service-role client to attempt it with.",
            )
        )
        return result

    try:
        client.table("users").select("id").limit(1).execute()
        result.checks.append(
            Check(name="database", ok=True, detail="")
        )
    except Exception as exc:  # noqa: BLE001 — report, never raise out of a health route
        log.warning("readiness: database unreachable: %s", exc)
        result.checks.append(
            Check(
                name="database",
                ok=False,
                detail=(
                    "The database did not answer. A paused Supabase project is the "
                    f"usual cause — check the project is active. ({type(exc).__name__})"
                ),
            )
        )
        return result

    result.checks.extend(_schema_checks(client))
    return result

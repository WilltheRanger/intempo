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
import re
from dataclasses import dataclass, field

from app.db import get_service_client
from app.workers.dispatch import _MODAL_CREDENTIAL_VARS

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
        """The check, with its detail only when the detail is true.

        **`detail` describes the failure**, so reporting it next to a passing
        check states the opposite of the truth. Read back from a real
        deployment, in a table:

            supabase_url   True   SUPABASE_URL is not set — there is no
                                  project to talk to.

        Every word of that is wrong except the name. The setting *is* set;
        that is why the check passed. Somebody scanning the list for what is
        broken has to notice that the `ok` column contradicts the sentence
        beside it, on every single row, and the rows that genuinely are broken
        look exactly the same.

        Two checks written later already returned `""` when they passed, which
        is what made the inconsistency visible. This makes it the rule: a
        passing check has nothing to say.
        """
        return {
            "name": self.name,
            "ok": self.ok,
            "detail": "" if self.ok else self.detail,
            "blocking": self.blocking,
        }


#: Columns this build writes to that a migration had to add.
#:
#: Kept because **no deploy applies `app/migrations/*.sql`** — someone runs each
#: one, through the Supabase SQL editor or through a session holding the
#: Supabase MCP — so shipping code and applying its migration are two separate
#: acts and the gap between them is invisible. It has already happened once: `analyses.instrument` went live in
#: code before the column existed, and every take submission would have failed
#: with a column-not-found error that reads like a server bug.
#:
#: Add a row here whenever a migration adds a column the code depends on.
REQUIRED_COLUMNS: tuple[tuple[str, str, str], ...] = (
    # **004 is not here and cannot be.** It drops a NOT NULL rather than adding
    # a column, so there is nothing to select for — the only way to detect it
    # is to attempt an insert, and this endpoint must not write. A database
    # missing it rejects every hand-entered piece with a not-null violation,
    # which at least names the column it is about. Recorded so the next reader
    # knows it is absent by argument rather than by oversight.
    ("scores", "movement", "005"),
    # 006. Three columns, three different failures, which is why the rule two
    # blocks down — one row per column, not one per migration — applies here
    # too. It did not, until `test_readiness_columns.py` went looking.
    ("scores", "transcription_status", "006"),
    # Written on every step the worker reports. A deployment without it errors
    # partway through every read, leaving the row `reading` for the sweeper to
    # find, and the measured progress bar with nothing to move on.
    ("scores", "transcription_stage", "006"),
    # Written when a read fails, and it is the only place the sentence goes.
    # Without it `_FAILURE_REASONS` — the whole table of wordings written for a
    # musician rather than a log, rewritten three times to stop blaming a
    # photograph for a fault on our side — reaches nobody: the scan shows as
    # failed with no reason at all.
    ("scores", "transcription_error", "006"),
    ("scores", "transcription_accepted_at", "007"),
    # Also 007, and the half that actually writes. `accept` is the only thing
    # that discards a photograph; missing this column, the accept fails, so the
    # object is never removed and the row never records that it was. The
    # storage side then has no row saying the photograph is gone and no request
    # that can remove it.
    ("scores", "page_image_discarded_at", "007"),
    ("analyses", "instrument", "008"),
    # 009. One row per column the code reads, not one per migration: a
    # deployment can be half-applied, and each of these fails differently.
    # `instrument` is the one that changes behaviour rather than decoration —
    # without it every account looks un-onboarded and the screen never stops
    # appearing.
    ("users", "instrument", "009"),
    ("users", "display_name", "009"),
    ("users", "avatar_key", "009"),
    ("users", "onboarded_at", "009"),
    # 010. Without it a read dispatched to Modal is anonymous, so a container
    # that dies before its first write is indistinguishable from a slow page
    # and the sweeper reports a guess. Not blocking would be wrong: the column
    # is written on every Modal dispatch, so a missing one is an error logged
    # on every single scan.
    ("scores", "transcription_call_id", "010"),
    # 011. The pages of a scan, in page order. A deployment missing it reads
    # page one of a three-page part and silently discards the rest — which is
    # the failure the column exists to end, so it is worth saying out loud
    # rather than degrading quietly back to it.
    ("scores", "source_image_urls", "011"),
    # 012. Whether a take was played with the long rests skipped. A deployment
    # missing it does not degrade quietly: the API writes the key only when the
    # musician actually skipped something, so an ordinary take is unaffected
    # and a skipped one fails at submit. That is deliberate — measured, a take
    # judged against rests it skipped scores **0.000** and is told to check it
    # is the right piece — but an error a musician meets by using a control the
    # app offered them is worth naming here before they meet it.
    ("analyses", "skip_long_rests", "012"),
    ("analyses", "from_measure", "015"),
    # 025. The leg an in-flight run has reached, so a two-and-a-half minute
    # wait can show a bar that moves on something real. Degrades quietly by
    # construction — `_stage` swallows its own failures and the app treats a
    # null as "no finer information" — so a deployment missing it analyses
    # takes exactly as before and simply cannot say where they are. Listed
    # anyway, because "the bar never moves" is indistinguishable from the
    # defect this was written to fix, and that is precisely the confusion
    # worth being able to look up rather than re-diagnose.
    ("analyses", "stage", "025"),
    # 026. What the microphone applied to a take. Degrades quietly by
    # construction — the insert drops the key and logs rather than refuse a
    # take over a diagnostic — which is exactly why it is listed: a deployment
    # missing it records nothing and looks, from the table, like a fleet of
    # clients that never reported.
    ("analyses", "capture", "026"),
    # 027. The analysis's working on each take. Degrades quietly the same way
    # — the worker writes it separately, after the verdict, and logs a failure
    # — so a deployment missing it analyses exactly as before and keeps no
    # record of why a take was refused, which is the one thing it is for.
    ("analyses", "diagnostics", "027"),
    # 013. All three degrade quietly on purpose — every caller narrows its
    # select or retries its write without them, because the alternative was a
    # save that 500s and a scan that sits `reading` forever during the window
    # between Render deploying `main` and somebody applying the migration by
    # hand. Quietly is the right behaviour and a bad thing to be unable to see:
    # a deployment missing these keeps nothing, and looks exactly like one where
    # nobody has consented.
    ("users", "training_consent_at", "013"),
    ("scores", "transcription_reader", "013"),
    ("scores", "page_image_retained_at", "013"),
    # 017. The ceiling on how many times one page may be read, and the only
    # thing standing between a loop on `POST /v1/scores/{id}/transcribe` and an
    # unbounded model bill. A deployment missing it does **not** degrade
    # quietly: the column is written on every reading that starts, so the first
    # scan after a deploy without it fails at the insert — which is the right
    # direction for a spend ceiling to fail in, and worth naming here so it is
    # read as a half-applied schema rather than a broken scanner.
    ("scores", "transcription_runs", "017"),
    ("analyses", "playback_key", "018"),
    # 019. The mark that a take which never got a verdict has had its WAV
    # reclaimed. A deployment missing it degrades quietly and in the expensive
    # direction: `sweep_unjudged_takes` contains its own failure, so the sweep
    # does nothing at all and every failed take keeps ~3 MB forever, which
    # looks exactly like a deployment where no take has ever failed. Nothing
    # else reads it, so nothing else breaks — which is the whole reason it is
    # worth a row here rather than being noticed by a storage bill.
    ("analyses", "audio_reclaimed_at", "019"),
)

#: Tables added after the initial schema that production behavior depends on.
#:
#: A column probe cannot discover a table the code reaches only during cleanup
#: or after consent. Migration 014 was absent in production while every
#: readiness check said nothing about it: uploads could be abandoned forever,
#: precisely the failure that table exists to prevent. Keep table migrations
#: here for the same reason columns live above — deployment and schema are two
#: separate manual acts today.
REQUIRED_TABLES: tuple[tuple[str, str], ...] = (
    ("training_corrections", "013"),
    ("pending_uploads", "014"),
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


def _corrector_check() -> Check:
    """Whether the bars that do not add up can actually be re-read.

    **A configuration check, and it says so.** It asks whether a corrector is
    named and whether its key is present — not whether one has ever run. That
    distinction has bitten this project before (`transcription_dispatch` exists
    because every readiness check passed while every spawn raised), so the
    detail says which question it answered.

    Non-blocking either way. A page with no corrector is read exactly as it was
    before one existed: homr's reading stands, the bars that do not add up are
    named for the musician, and `MeasureEditScreen` fixes them by hand.
    """
    from app.config import settings
    from app.services.ocr.pipeline import PROVIDER_REGISTRY

    named = settings.OCR_CORRECTOR.strip()
    if not named:
        return Check(
            name="ocr_corrector",
            ok=True,
            detail=(
                "OCR_CORRECTOR is empty, so bars that do not add up are left "
                "for the musician to correct rather than re-read."
            ),
            blocking=False,
        )

    provider = PROVIDER_REGISTRY.get(named)
    if provider is None:
        return Check(
            name="ocr_corrector",
            ok=False,
            detail=(
                f"OCR_CORRECTOR names {named!r}, which this build does not "
                f"know ({', '.join(sorted(PROVIDER_REGISTRY))}). Bars that do "
                "not add up will not be re-read."
            ),
            blocking=False,
        )

    setting = getattr(provider, "api_key_setting", "")
    has_key = bool(getattr(settings, setting, "")) if setting else True
    return Check(
        name="ocr_corrector",
        ok=has_key,
        detail=(
            f"{named} is configured to re-read bars that do not add up. "
            "Configured, not exercised — `transcription_dispatch` is what says "
            "whether pages reach a reader at all."
            if has_key
            else (
                f"OCR_CORRECTOR is {named} but {setting} is not set **in this "
                "process**. When TRANSCRIPTION_RUNTIME=modal the re-read runs "
                "in the Modal container and reads that container's secret, so "
                "this is expected and harmless there — the same caveat the "
                f"ocr:{named} check carries. Set it here only if pages are read "
                "here. If it is missing in both, no bar is ever re-read: the "
                "reading still stands and the bars that do not add up are "
                "still named for the musician."
            )
        ),
        blocking=False,
    )


def _tempo_reader_check() -> Check:
    """Whether tempo words can be read off a photographed page.

    A configuration check, like `_corrector_check` and with its caveat: when
    pages are read on Modal it is that container's key that counts. Never
    blocking — a page read without it has no tempo changes, which is what every
    photographed page had before, and they can be marked by hand.
    """
    from app.config import settings
    from app.services.ocr.tempo_marks import tempo_reader

    named = settings.OCR_TEMPO_READER.strip()
    if not named:
        return Check(
            name="ocr_tempo_reader",
            ok=True,
            detail="OCR_TEMPO_READER is empty, so tempo words are not read from photographs.",
            blocking=False,
        )
    provider = tempo_reader()
    if provider is None:
        return Check(
            name="ocr_tempo_reader",
            ok=False,
            detail=f"OCR_TEMPO_READER names {named!r}, which cannot be asked about a page.",
            blocking=False,
        )
    setting = getattr(provider, "api_key_setting", "")
    has_key = bool(getattr(settings, setting, "")) if setting else True
    return Check(
        name="ocr_tempo_reader",
        ok=has_key,
        detail=(
            f"{named} is configured to read tempo words from photographs. "
            "Configured, not exercised."
            if has_key
            else (
                f"OCR_TEMPO_READER is {named} but {setting} is not set in this "
                "process. Pages read on Modal use that container's secret; if it "
                "is missing there too, no tempo words are read from photographs."
            )
        ),
        blocking=False,
    )


def _configuration_checks() -> list[Check]:
    """Settings only. No network, so this half always answers.

    The settings object is fetched here rather than bound at import. This
    endpoint's whole job is to report what the process is *currently*
    configured with, and a snapshot taken at import time is a different claim —
    one that happens to be true in production, where nothing reloads, and
    quietly false anywhere it does.
    """
    from app.config import settings

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
        Check(
            name="cors_allowed_origins",
            ok=bool(settings.CORS_ALLOWED_ORIGINS),
            detail=(
                "CORS_ALLOWED_ORIGINS is not set. Native clients are unaffected, "
                "and localhost development is already covered — but a browser on "
                "any other origin is refused *before* it sends anything, and the "
                'only thing it can report is "Failed to fetch". Name the web '
                "app's origin here, including its preview domain if previews "
                "should work."
            ),
            # Not blocking. Unset is correct for a local server and for a
            # deployment that only serves the native app, and this endpoint
            # exists to be believed — a 503 on a working API would teach
            # whoever reads it to stop reading it.
            #
            # It is here at all because it is the one misconfiguration in this
            # list that names *nothing* on its own: no server log, no status
            # code, no message beyond "Failed to fetch". Everything else fails
            # loudly somewhere.
            blocking=False,
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
        if setting:
            present = bool(getattr(settings, setting, ""))
            detail = f"{setting} is not set, so {provider.name} cannot be used."
        else:
            # **A provider without an API key is not a provider without a
            # requirement.** homr is an engine that lives *in this container*,
            # not a service reached with a key, so "is the key set" is the wrong
            # question and asking it reported `ocr:homr` unusable with an empty
            # setting name in the message. The failure this prevents is quiet: a
            # chain naming `homr` on a host that does not have it falls through
            # to the vision models and reads every page the slower, worse way,
            # while appearing to work.
            available = getattr(provider, "available", None)
            present = bool(available()) if callable(available) else False
            detail = (
                f"{provider.name} is not installed in this container. It runs "
                "on Modal, so this is expected and harmless when "
                "TRANSCRIPTION_RUNTIME=modal — check `transcription_dispatch` "
                "for whether pages are actually getting there. If they are "
                "not, a page reaching the chain here is read by whichever "
                "other provider is usable, and refused outright if none is."
            )
        if present:
            usable.append(provider.name)
        checks.append(
            Check(
                name=f"ocr:{provider.name}",
                ok=present,
                detail=detail,
                blocking=False,
            )
        )

    checks.append(_corrector_check())
    checks.append(_tempo_reader_check())

    # A reader can live here or behind the page runtime. The production
    # deployment deliberately keeps homr off this 512 MB process and sends
    # photographs to Modal, so checking only the local provider list made a
    # healthy delegated reader report as a blocking 503.
    from app.workers import dispatch

    checks.append(
        Check(
            name="sheet_music_reading",
            ok=bool(usable) or dispatch.TRANSCRIPTION_RUNTIME == "modal",
            detail=(
                "No sheet-music reader is available in this process, and page "
                "transcription is not delegated to Modal. Importing a MusicXML "
                "file still works — that path needs no reader."
            ),
        )
    )
    return checks


def _tuning_config_check() -> Check:
    """That `config.toml` is in the image at all.

    Every threshold the analysis uses lives there and is read **lazily**, deep
    inside the pipeline, so a container built without it starts cleanly, passes
    its health check, signs people in and reads photographed pages — and then
    fails every analysis with `internal_error` the moment somebody finishes
    playing. That is exactly what the API image did: `backend/Dockerfile`
    copied `app/`, `pyproject.toml` and the lock, and no config.

    Blocking, unlike the runtime checks below. A deployment that cannot analyse
    a take cannot do the thing the app is for.
    """
    from app.services.audio_config import CONFIG_PATH, load_audio_config

    try:
        load_audio_config()
    except OSError:
        return Check(
            name="tuning_config",
            ok=False,
            detail=(
                f"The analysis thresholds are missing from this build — nothing is at "
                f"{CONFIG_PATH}. Recording works and every take then fails. The image "
                "has to carry backend/config.toml."
            ),
        )
    except Exception as exc:  # noqa: BLE001 — a malformed config is a config error
        return Check(
            name="tuning_config",
            ok=False,
            detail=(
                f"The analysis thresholds could not be parsed ({type(exc).__name__}), "
                "so every take will fail. Check backend/config.toml."
            ),
        )
    return Check(name="tuning_config", ok=True, detail="")


def _transcription_dispatch_check() -> list[Check]:
    """Whether pages are being read where the deployment says they are.

    `_analysis_runtime_checks` below asks whether Modal *could* be reached —
    credentials present, function deployed. This asks the different and more
    useful question: **when a page was actually handed over, what happened?**

    The two came apart badly. A token with a trailing newline is present, and
    names a function that is deployed, so every configuration check passed
    while `fn.spawn()` raised on every call. Pages were read in this process,
    without homr, for the entire life of the deployment, and one of them came
    back as invented notes that the app displayed as a transcription.

    Not blocking. The fallback is a real reading and the app works; it works in
    the place that moving to Modal was meant to empty, and with the engine that
    reads pages properly left out of it.
    """
    from app.workers import dispatch

    if dispatch.TRANSCRIPTION_RUNTIME != "modal":
        return []

    seen = dispatch.transcription_dispatches
    if seen.to_modal == 0 and seen.fell_back == 0:
        return [
            Check(
                name="transcription_dispatch",
                ok=True,
                detail=(
                    "No page has been handed over since this process started, so "
                    "there is nothing to report yet."
                ),
                blocking=False,
            )
        ]

    if seen.fell_back == 0:
        return [
            Check(name="transcription_dispatch", ok=True, detail="", blocking=False)
        ]

    # The failure type, never its message: `grpclib` puts the credential *in*
    # the message, and a readiness detail is served over HTTP and read in a
    # browser.
    because = (
        f" The last failure was a {seen.last_failure_type}; the logs have the "
        "traceback."
        if seen.last_failure_type
        else ""
    )
    return [
        Check(
            name="transcription_dispatch",
            ok=False,
            detail=(
                f"TRANSCRIPTION_RUNTIME is modal, but {seen.fell_back} of "
                f"{seen.fell_back + seen.to_modal} pages handed over since this "
                "process started were read here instead — without homr, by the "
                "vision models alone, which is materially worse at reading a "
                f"page.{because}"
            ),
            blocking=False,
        )
    ]


def _transcription_runtime_checks() -> list[Check]:
    """Whether the runtime that reads photographed pages is reachable now.

    Provider checks above answer what this web process can run. Production
    intentionally answers "not homr": the engine peaks around 1.35 GB and lives
    only in Modal. Treating that local absence as the capability check made
    `/v1/ready` return 503 on the intended deployment, while never asking
    whether Modal's actual `transcribe_score` function existed.

    This is blocking when Modal was explicitly selected. With the shipped
    homr-only chain, falling back to this process cannot read a page at all.
    The behaviour counter below remains separate: hydration proves the function
    exists; only a real dispatch proves a page reached it.
    """
    import os

    from app.workers import dispatch

    if dispatch.TRANSCRIPTION_RUNTIME != "modal":
        return []

    try:
        import modal
    except ImportError:
        return [
            Check(
                name="transcription_runtime:modal",
                ok=False,
                detail=(
                    "TRANSCRIPTION_RUNTIME is modal, but the modal package is "
                    "not installed on this host, so photographed pages cannot "
                    "be handed to the reader."
                ),
            )
        ]

    if not (os.getenv("MODAL_TOKEN_ID") and os.getenv("MODAL_TOKEN_SECRET")):
        return [
            Check(
                name="transcription_runtime:modal",
                ok=False,
                detail=(
                    "MODAL_TOKEN_ID and MODAL_TOKEN_SECRET are not both set "
                    "here, so this API cannot hand photographed pages to Modal."
                ),
            )
        ]

    checks: list[Check] = []
    untrimmed = [
        name
        for name in _MODAL_CREDENTIAL_VARS
        if (raw := os.getenv(name)) is not None and raw != raw.strip()
    ]
    if untrimmed:
        checks.append(
            Check(
                name="transcription_modal_credentials",
                ok=False,
                detail=(
                    f"{' and '.join(untrimmed)} "
                    + ("carry" if len(untrimmed) > 1 else "carries")
                    + " leading or trailing whitespace. It is repaired before "
                    "use, but should be re-pasted cleanly in the hosting "
                    "dashboard."
                ),
                blocking=False,
            )
        )
        # The dispatcher makes the same repair immediately before a spawn.
        # Apply it here too so hydration tests the credentials that will
        # actually be used rather than failing on a newline already handled.
        dispatch.clean_modal_credentials()

    try:
        modal.Function.from_name(
            dispatch.MODAL_APP_NAME,
            dispatch.MODAL_TRANSCRIBE_FUNCTION_NAME,
        ).hydrate()
    except Exception as exc:  # noqa: BLE001 — report, never break readiness
        log.warning("readiness: Modal transcription function not resolvable: %s", exc)
        checks.append(
            Check(
                name="transcription_runtime:modal",
                ok=False,
                detail=(
                    f"Modal has no function "
                    f"'{dispatch.MODAL_TRANSCRIBE_FUNCTION_NAME}' in an app "
                    f"named '{dispatch.MODAL_APP_NAME}', so photographed pages "
                    f"cannot be read. Run the Deploy Modal workflow. "
                    f"({type(exc).__name__})"
                ),
            )
        )
        return checks

    checks.append(Check(name="transcription_runtime:modal", ok=True, detail=""))
    return checks


def _analysis_runtime_checks() -> list[Check]:
    """Whether a take will actually run where the deployment says it will.

    **Because "it fell back" is indistinguishable from "it worked".** The
    dispatcher deliberately runs the analysis in this process when Modal
    refuses — a musician who has just finished playing should not lose the take
    to a deployment setting. The cost of that kindness is that a deployment
    which *thinks* it is on Modal and is quietly analysing everything locally
    looks completely healthy until two people record at once and the box is
    killed for memory.

    Nothing here blocks. Every one of these being false leaves an app that
    works; it just works in the place that moving to Modal was meant to empty.
    """
    import os

    from app.workers import dispatch

    if dispatch.ANALYSIS_RUNTIME != "modal":
        return [
            Check(
                name="analysis_runtime:inprocess",
                ok=True,
                detail="",
                blocking=False,
            )
        ]

    try:
        import modal
    except ImportError:
        return [
            Check(
                name="analysis_runtime:modal",
                ok=False,
                detail=(
                    "ANALYSIS_RUNTIME is modal, but the modal package is not installed "
                    "on this host, so every take falls back to running inside the web "
                    "process. Add it to backend/pyproject.toml and redeploy."
                ),
                blocking=False,
            )
        ]

    # The two halves of a Modal API token. This host does not run the analysis
    # under `ANALYSIS_RUNTIME=modal` — it *asks* Modal to — and asking requires
    # credentials, which is easy to miss because the container's own secret is
    # a separate thing set up on a separate dashboard.
    if not (os.getenv("MODAL_TOKEN_ID") and os.getenv("MODAL_TOKEN_SECRET")):
        return [
            Check(
                name="modal_credentials",
                ok=False,
                detail=(
                    "MODAL_TOKEN_ID and MODAL_TOKEN_SECRET are not both set here, so "
                    "this API cannot hand a take to Modal and every one falls back to "
                    "running in this process. They are the same token pair the deploy "
                    "workflow uses."
                ),
                blocking=False,
            )
        ]

    # Set is not the same as usable, and this check could not fail until it
    # said so. Modal sends both values as gRPC metadata, which may not contain
    # a newline; a token pasted into a hosting dashboard carries one often
    # enough that it happened here. `grpclib` then raised from inside every
    # `spawn`, no page ever reached Modal — the only place homr is installed —
    # and pages were read by the vision chain alone and shown to a musician as
    # transcriptions. Meanwhile this reported the credentials present, because
    # they were.
    #
    # `clean_modal_credentials` repairs the value, so by the time anything
    # spawns it is usable. This still reports it: a deployment whose token
    # needs repairing on every call should be corrected at the source, and the
    # next thing pasted into that field will have the same newline.
    untrimmed = [
        name
        for name in _MODAL_CREDENTIAL_VARS
        if (raw := os.getenv(name)) is not None and raw != raw.strip()
    ]
    if untrimmed:
        return [
            Check(
                name="modal_credentials",
                ok=False,
                detail=(
                    f"{' and '.join(untrimmed)} "
                    + ("carry" if len(untrimmed) > 1 else "carries")
                    + " leading or trailing whitespace — usually a newline picked up "
                    "when the value was pasted into the hosting dashboard. Modal sends "
                    "these as gRPC metadata, which rejects a newline, so every spawn "
                    "fails and the work silently falls back to this process. It is "
                    "trimmed before use, so this is not currently breaking anything; "
                    "re-paste the value without the newline to fix it at the source."
                ),
                blocking=False,
            )
        ]

    try:
        # `from_name` is documented as lazy — it defers the lookup until first
        # use — so it proves nothing on its own. `hydrate()` is what actually
        # asks Modal whether this function exists, which is the only version of
        # this check worth having.
        modal.Function.from_name(
            dispatch.MODAL_APP_NAME, dispatch.MODAL_FUNCTION_NAME
        ).hydrate()
    except Exception as exc:  # noqa: BLE001 — report, never raise out of a health route
        log.warning("readiness: Modal function not resolvable: %s", exc)
        return [
            Check(
                name="analysis_runtime:modal",
                ok=False,
                detail=(
                    f"Modal has no function '{dispatch.MODAL_FUNCTION_NAME}' in an app "
                    f"named '{dispatch.MODAL_APP_NAME}', so every take falls back to "
                    "running in this process. Run the Deploy Modal workflow. "
                    f"({type(exc).__name__})"
                ),
                blocking=False,
            )
        ]

    return [Check(name="analysis_runtime:modal", ok=True, detail="", blocking=False)]


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

    for table, migration in REQUIRED_TABLES:
        try:
            client.table(table).select("id").limit(1).execute()
            ok, detail = True, ""
        except Exception as exc:  # noqa: BLE001 — any failure is "not usable"
            ok = False
            detail = (
                f"`{table}` is missing — apply "
                f"`backend/app/migrations/{migration}_*.sql` in the Supabase SQL "
                "editor. Until then the feature backed by that table cannot run. "
                f"({type(exc).__name__})"
            )
        checks.append(Check(name=f"schema:{table}", ok=ok, detail=detail))
    return checks


def _client_write_grants_check(client) -> Check:
    """That no client role can still write to a table directly.

    **The one thing in this module that a `select` cannot see.** Every other
    schema check here detects a migration by reading a column it added; 021
    adds no column — it takes a privilege away, and a privilege is invisible
    from the outside. So the migration ships a `SECURITY DEFINER` function that
    reads `information_schema` and answers the question, and this asks it.

    What it is protecting: while `anon` and `authenticated` held UPDATE, an
    account could write `users.tier` — which `tier_limits.tier_of` reads — and
    delete its own `analyses` rows, which `count_analyses_this_month` counts.
    Both are the free-tier limit, by two different routes. See migration 021.

    **Blocking**, unlike most of what `_storage_checks` reports. A deployment
    that serves requests with the grants open is not degraded, it is giving the
    product away, and the fix is one migration rather than a code change.

    A missing function is reported as *not closed* rather than as an error:
    the only database where it does not exist is one where 021 has not been
    applied, which is exactly the state this is here to name.
    """
    try:
        response = client.rpc("client_write_grants_closed", {}).execute()
    except Exception as exc:  # noqa: BLE001 — any failure means "cannot say it is closed"
        return Check(
            name="security:client_write_grants",
            ok=False,
            detail=(
                "Could not confirm that client write grants are closed — apply "
                "`backend/app/migrations/021_restrict_client_updates.sql`. Until "
                "then a signed-in account can set its own tier and delete its own "
                f"analyses, and the free-tier limit is not enforced. ({type(exc).__name__})"
            ),
        )

    closed = getattr(response, "data", None)
    if closed is True:
        return Check(name="security:client_write_grants", ok=True, detail="")

    return Check(
        name="security:client_write_grants",
        ok=False,
        detail=(
            "`anon` or `authenticated` still holds a write privilege in `public` "
            "— re-apply `backend/app/migrations/021_restrict_client_updates.sql`. "
            "A signed-in account can set its own tier and delete its own analyses, "
            "so the free-tier limit is not enforced."
        ),
    )


def _storage_checks(client) -> list[Check]:
    """That the worker will fetch anything the bucket agreed to hold.

    Two numbers in two systems, and nothing ever compared them. The worker's
    cap was 25 MB against a bucket that accepts 50, so a six-minute take
    uploaded, sat in storage, and was refused by the thing meant to read it —
    reported as `audio_unavailable`, which was not true.

    A mismatch in the other direction is harmless and still worth saying: it
    means the worker would happily fetch something the musician can never get
    into storage in the first place, so the real limit is somewhere the code
    does not mention.
    """
    from app.routers.upload import AUDIO_BUCKET, AVATAR_BUCKET, SCORE_BUCKET
    from app.services.page_image import MAX_IMAGE_BYTES
    from app.workers.analysis_runner import MAX_AUDIO_BYTES

    checks: list[Check] = []
    # `cap` is the limit of the thing that later *reads* the object, which is
    # what the mismatch above is about. Avatars have no reader — the picture
    # goes straight from storage to an `<img>` — so there is no second number
    # and `None` says so. The bucket is still checked, because it is created by
    # migration 009 and a deployment that ran the column half of that migration
    # and not the bucket half has an onboarding screen nobody can finish, with
    # nothing anywhere reporting why.
    for bucket_name, cap, what in (
        (AUDIO_BUCKET, MAX_AUDIO_BYTES, "recording"),
        (SCORE_BUCKET, MAX_IMAGE_BYTES, "photograph"),
        (AVATAR_BUCKET, None, "profile picture"),
    ):
        name = f"storage:{bucket_name}"
        try:
            bucket = client.storage.get_bucket(bucket_name)
            limit = getattr(bucket, "file_size_limit", None)
        except Exception as exc:  # noqa: BLE001 — any failure is "cannot tell"
            checks.append(
                Check(
                    name=name,
                    ok=False,
                    detail=(
                        f"the `{bucket_name}` bucket could not be read, so a "
                        f"{what} may not be storable at all. "
                        f"({type(exc).__name__})"
                    ),
                )
            )
            continue

        if cap is None or not limit:
            # Nothing to compare. Either no reader has a limit of its own, or
            # no limit is set on the bucket and the project default applies,
            # which this cannot see. Reaching here at all means the bucket was
            # read, which is the part that matters for a bucket with no cap.
            checks.append(Check(name=name, ok=True, detail=""))
            continue

        ok = cap >= limit
        checks.append(
            Check(
                name=name,
                ok=ok,
                detail=""
                if ok
                else (
                    f"the `{bucket_name}` bucket accepts files up to "
                    f"{limit // (1024 * 1024)} MB, but this build refuses to "
                    f"fetch anything over {cap // (1024 * 1024)} MB. A {what} "
                    f"between the two uploads and is then reported as "
                    f"unavailable."
                ),
            )
        )
    return checks


def check() -> Readiness:
    """Everything, configuration first so a missing key explains a dead database."""
    result = Readiness(checks=_configuration_checks())
    result.checks.append(_tuning_config_check())
    # Before the database, and not behind it. Where the analysis runs is a
    # configuration fact, and the two early returns below would otherwise
    # swallow it on exactly the deployment most likely to be half-configured.
    result.checks.extend(_analysis_runtime_checks())
    result.checks.extend(_transcription_runtime_checks())
    result.checks.extend(_transcription_dispatch_check())

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
        result.checks.append(Check(name="database", ok=True, detail=""))
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
    result.checks.append(_client_write_grants_check(client))
    result.checks.extend(_storage_checks(client))
    return result


#: Longest origin this will quote back. An origin is a scheme and a host; a
#: kilobyte of one is somebody testing what this endpoint will echo.
_MAX_PROBE_LENGTH = 200
#: Anything outside this is not part of any origin, and quoting it back into a
#: response somebody pastes into a chat or a terminal is not worth the
#: convenience of exactness.
_PROBE_SAFE = re.compile(r"[^A-Za-z0-9:/._*\-]")


def cors_probe(origin: str) -> Check:
    """Would a browser on this origin be allowed to call the API.

    **A behaviour check, which the one beside it is not.**
    `cors_allowed_origins` asks whether the variable is *set*. Every value it
    can hold passes that, including one naming an origin the deployed web app
    does not have — and the browser's report of the difference is a thrown
    `fetch` with no status, indistinguishable from the API being down. This
    project has already paid for that distinction once, with Modal: every
    readiness check passed while every spawn raised, because they asked whether
    the runtime *could* be reached rather than what happened when it was.

    So this answers the question actually being asked — *can the site at this
    address talk to me* — by evaluating the same two values `CORSMiddleware`
    was constructed with. There is no second copy of the matching rules here:
    an exact hit against `cors_origins`, or a match against
    `cors_origin_regex`. If those two are wrong, this is wrong in the same
    direction, which is the only kind of agreement worth having.

    Reached as `/v1/ready?origin=https://example.pages.dev`. Not blocking: an
    API serving only the native app has no origin to name, and a 503 on a
    working deployment teaches whoever reads this to stop reading it.

    The origin is echoed so a reply carrying several is readable, trimmed and
    with anything that is not part of an origin removed. It is the caller's own
    input and no setting of ours — this module still never reports a value.

    Settings are fetched here, not bound at import, for the reason
    `_configuration_checks` already gives: a snapshot taken at import is a
    different claim from "what this process is configured with now", true in
    production and quietly false anywhere the module is reloaded — which is
    exactly what `test_cors.py` does to rebuild the middleware.
    """
    from app.config import settings

    quoted = _PROBE_SAFE.sub("?", origin.strip()[:_MAX_PROBE_LENGTH])

    allowed = origin in settings.cors_origins
    if not allowed:
        pattern = settings.cors_origin_regex
        allowed = bool(pattern and re.match(pattern, origin))

    return Check(
        name="cors_probe",
        ok=allowed,
        detail=(
            f"A browser on {quoted} is refused before it sends anything, and "
            "the only thing it can report is a failed fetch — which looks "
            "exactly like this API being down. Add that origin to "
            "CORS_ALLOWED_ORIGINS. A Cloudflare Pages project needs both its "
            "production alias and a wildcard for the per-deployment hostname: "
            "https://project.pages.dev,https://*.project.pages.dev"
        ),
        blocking=False,
    )

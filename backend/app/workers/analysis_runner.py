"""The analysis worker — Phase 1: called off a bounded pool in `dispatch`.

`run_analysis` is a plain SYNC function on purpose:

- It runs on a worker thread, so the CPU-bound `analyze()` never blocks the
  event loop — which is the #1 Batch 4 pitfall. No `run_in_executor`
  gymnastics needed.
- **The thread is `dispatch`'s, not Starlette's.** This was a
  `BackgroundTasks` task until 2026-09-10, which meant the forty-thread pool
  the request handlers share, with nothing counting how many analyses were in
  flight — at ~460 MB each against a 512 MB instance. See
  `ANALYSIS_MAX_CONCURRENT`.
- The Supabase client is sync anyway.
- The body is structured so the Celery migration is mechanical: add a
  `@celery_app.task` decorator and swap `add_task` → `.delay` at the
  call site. The DB writes, result shape, and exception handling don't
  change (see the "Migration to Celery" subsection in the spec).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import httpx

from app.db import get_service_client
from app.models.analysis import Instrument
from app.services import audio as audio_svc
from app.services.audio_storage import AudioStorageError, readable_audio_url
from app.services.take_archive import keep_playback_copy
from app.services.analysis import analyze
from app.services.storage_origin import origin_of
from app.services.take_comparison import comparison_key
from app.services.long_rests import shorten_long_rests
from app.services.start_at import start_from_measure
from app.services.score_schema import ScoreJson

log = logging.getLogger("intempo.analysis")

#: The largest recording this will fetch, which must be at least what storage
#: agreed to hold.
#:
#: **It was 25 MB, and its comment said "~2 MB AAC / ~10 MB WAV" — describing a
#: client that no longer exists.** The app records uncompressed WAV now (every
#: codec MediaRecorder offers smears the note attacks this pipeline measures),
#: so 25 MB is **4.6 minutes**. The `audio-uploads` bucket accepts 50 MB. A
#: six-minute take therefore uploaded successfully, sat in storage, and was
#: then refused here — reported to the musician as `audio_unavailable`, which
#: is not true: the audio is fine and reachable.
#:
#: So this tracks the bucket rather than an estimate of what a take weighs.
#: Anything storage accepted, this has to be able to fetch; a cap below the
#: bucket's is a hole with a wrong error message in it, and `/v1/ready` now
#: compares the two against the live bucket so they cannot drift apart again.
MAX_AUDIO_BYTES = 50 * 1024 * 1024

#: Long enough to pull the largest file the bucket will hold.
#:
#: 20 seconds needed 2.5 MB/s to fetch 50 MB, which is fine from a datacentre
#: and is not something to depend on. The body is read whole, so this is the
#: only thing standing between a slow read and a take reported as unavailable.
AUDIO_DOWNLOAD_TIMEOUT = 60.0


class AudioFetchError(Exception):
    """Raised when the recording can't be pulled from storage."""


class WorkerMisconfigured(RuntimeError):
    """The worker cannot reach the database it was asked to work on.

    Raised rather than logged-and-returned, and the distinction matters now
    that the analysis can run somewhere other than the web process.

    The service-role key lives in **two** places since Modal: Render's
    environment and a Modal secret typed by hand into a dashboard. Get the
    Modal one wrong — one of the two key names misspelled, a URL for a
    different project — and everything else still works. Scanning works,
    sign-in works, the upload works. Only the analysis is dead, and it dies
    *quietly*: the call returns without raising, so Modal records it as
    **succeeded**, the row stays `queued`, and ten minutes later the stuck-row
    sweeper tells the musician "server restarted while analyzing — please
    retry". None of that is true, retrying does the same thing, and the one
    screen anybody would check to set Modal up is showing green.

    There is nothing to write the failure into — that is the whole problem —
    so the only honest thing left is to crash where somebody is looking.
    """


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


#: Redirects to follow. Supabase serves signed object URLs from the project
#: host and is not expected to redirect off it at all.
#:
#: **A tightening, not the bound.** httpx already defaults to 20, measured —
#: so removing this line does not make a chain unbounded, and a mutation that
#: removes it survives every test here for exactly that reason. It is written
#: down rather than left implicit because 3 states the expectation (one hop, or
#: none) where 20 states nothing, and because the origin check below is what
#: actually stops a redirect going somewhere it should not.
MAX_AUDIO_REDIRECTS = 3


def download_audio(url: str, *, expected_origin: str | None = None) -> bytes:
    """Fetch a recording, refusing anything too large, too far, or not there.

    **Three protections the image path grew after a review and this never
    did.** `download_image` caps redirects, checks where it actually ended up,
    and enforces the size limit while reading. This followed redirects without
    limit, never looked at the final host, and read the whole body into memory
    before measuring it — so an object storage would accept at 50 MB was fully
    buffered before being rejected, and a 302 from the storage host to a
    link-local address was followed without comment.

    `expected_origin` is `host:port`, and a redirect that leaves it is refused.
    Port as well as host, because another port on the same host is another
    service. None disables the check, which is what the analysis worker passes
    while its own URL is signed from a stored object key rather than supplied by
    anyone — but the caller that takes a URL from a request body must pass one.
    """
    try:
        with httpx.Client(
            timeout=AUDIO_DOWNLOAD_TIMEOUT,
            follow_redirects=True,
            max_redirects=MAX_AUDIO_REDIRECTS,
        ) as client:
            with client.stream("GET", url) as response:
                if response.status_code != 200:
                    raise AudioFetchError(
                        f"download returned status {response.status_code}"
                    )
                final = response.url
                # **`origin_of`, not an f-string.** `httpx.URL.port` is `None`
                # when the port is the scheme's default, so
                # `f"{final.host}:{final.port}"` renders a real
                # `https://x.supabase.co/...` as `x.supabase.co:None` — while
                # the caller's `expected_origin` comes from `storage_origin()`,
                # which fills the default in and says `x.supabase.co:443`. The
                # two never match, so the comparison below fired on every
                # legitimate fetch against real storage.
                #
                # Invisible to the suite because every test here serves from a
                # local port, which is explicit and therefore not None. The one
                # shape that is never exercised is the only shape production
                # has.
                #
                # This is the drift `services/storage_origin` was extracted to
                # stop, recurring in the same two functions: both had a private
                # copy of what `origin_of` already does. Now neither does.
                final_origin = origin_of(str(final)) or f"{final.host}"
                if expected_origin and final_origin != expected_origin:
                    raise AudioFetchError(
                        "audio download redirected off the storage host "
                        f"({expected_origin} -> {final_origin})"
                    )
                declared = response.headers.get("content-length")
                if declared and declared.isdigit() and int(declared) > MAX_AUDIO_BYTES:
                    raise AudioFetchError(
                        f"audio larger than {MAX_AUDIO_BYTES} bytes"
                    )
                chunks: list[bytes] = []
                total = 0
                for chunk in response.iter_bytes():
                    total += len(chunk)
                    if total > MAX_AUDIO_BYTES:
                        # Stop at the first chunk over the line rather than
                        # after allocating whatever was sent.
                        raise AudioFetchError(
                            f"audio larger than {MAX_AUDIO_BYTES} bytes"
                        )
                    chunks.append(chunk)
    except httpx.RequestError as exc:
        raise AudioFetchError(f"download failed: {exc}") from exc
    return b"".join(chunks)


def run_analysis(analysis_id: str) -> None:
    """Load audio + score, run `analyze()`, write the result back to the row.

    Phase 2 (Celery): this same function gets `@celery_app.task` on top and
    the enqueue site becomes `run_analysis.delay(analysis_id)`. Body unchanged.
    """
    client = get_service_client()
    if client is None:
        raise WorkerMisconfigured(
            f"analysis {analysis_id}: no service-role client. SUPABASE_URL and "
            "SUPABASE_SERVICE_ROLE_KEY must both be set wherever this runs — "
            "the Render environment for the in-process runtime, the Modal "
            "secret named 'intempo-backend' for ANALYSIS_RUNTIME=modal."
        )

    row = _fetch_analysis(client, analysis_id)
    if row is None:
        # The row is written before the work is asked for and nothing deletes
        # one, so its absence is not a race — it means this worker is reading a
        # *different* Supabase project from the one the API wrote to. Same
        # cause as the branch above, one config field along.
        raise WorkerMisconfigured(
            f"analysis {analysis_id}: row missing. The API wrote it, so this "
            "worker is pointed at a different Supabase project — check "
            "SUPABASE_URL matches the one the API uses."
        )

    _update(client, analysis_id, {"status": "processing", "updated_at": _now_iso()})

    try:
        # Rows keep a durable key-shaped reference, never the five-minute PUT
        # permission. Sign a fresh private GET immediately before reading.
        audio_bytes = download_audio(readable_audio_url(client, row["audio_url"]))
        score = _load_score(client, row["score_id"], row["user_id"])
        # **The take was played against a shortened score, so judge it against
        # one.** Skipping a long rest the timeline still contains takes an
        # otherwise perfect take from quality 1.000 to 0.000 —
        # `alignment_failed`, "check you're on the right piece" — and that holds
        # for a two-bar rest as much as a twenty-bar one.
        #
        # The same transformation the app applied to play and count it. The rule
        # lives in `fixtures/practice/long_rests.json` because there is no way to
        # share the walk between the two languages; see `services/long_rests.py`.
        # **The entry bar first, the rest-shortening second**, and the order is
        # load-bearing: `shorten_long_rests` rewrites bars, so trimming after it
        # would be asking for bar 14 of a score whose bar 14 is no longer the
        # page's bar 14. Trimming first keeps `from_measure` meaning what the
        # musician read off the page.
        if row.get("from_measure"):
            score = start_from_measure(score, int(row["from_measure"]))
        if row.get("skip_long_rests"):
            score = shorten_long_rests(score).score
        y, sr = audio_svc.load_audio_bytes(audio_bytes)
        # The one caller that has ever set this. `analyze()` has taken a
        # `double_bass` flag since Batch 3 — a high-pass filter and a lower
        # onset threshold for the register where attacks are softest and the
        # detector is weakest — and nothing had ever turned it on, so every
        # bass player was analysed with settings tuned for treble strings.
        #
        # Read from the row rather than passed in: the work happens after the
        # response is sent, so the row is the only thing that survives.
        result = analyze(
            (y, sr),
            score,
            float(row["target_bpm"]),
            double_bass=row.get("instrument") == Instrument.double_bass.value,
        )
        # Stamped on the model, not bolted onto the dump, so `AnalysisResult`
        # stays the whole truth about what an analysis result contains.
        result.comparison_key = comparison_key(score.model_dump(mode="json"), row)
        result_payload = result.model_dump(mode="json")
    except (AudioFetchError, AudioStorageError) as exc:
        log.warning("analysis %s: %s", analysis_id, exc)
        _finish_failed(client, analysis_id, "audio_unavailable")
        return
    except Exception:  # noqa: BLE001 — any pipeline error → failed, never a silent hang
        log.exception("analysis %s: internal error", analysis_id)
        _finish_failed(client, analysis_id, "internal_error")
        return

    _update(
        client,
        analysis_id,
        {
            "status": "done",
            "result_json": result_payload,
            "alignment_quality": result.quality,
            "failure_reason": None,
            "finished_at": _now_iso(),
            "updated_at": _now_iso(),
        },
    )

    # **After the verdict is written, never before it.** The WAV existed for
    # `analyze()` and that is now finished; what is kept from here is a
    # playback copy at a fraction of the size — the difference between four
    # musicians fitting in the free storage tier and seventy.
    #
    # Outside the `try` above on purpose. A failure in here must not reach
    # `_finish_failed` and turn a judged take into a failed one; the whole
    # module is best effort and returns None rather than raising, and the row
    # is already `done` either way.
    keep_playback_copy(client, analysis_id, str(row["audio_url"]), audio_bytes)


def _fetch_analysis(client, analysis_id: str) -> dict | None:
    res = client.table("analyses").select("*").eq("id", analysis_id).limit(1).execute()
    rows = res.data or []
    return rows[0] if rows else None


def _load_score(client, score_id: str, user_id: str) -> ScoreJson:
    res = (
        client.table("scores")
        .select("score_json")
        .eq("id", score_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise ValueError(f"score {score_id} not found for user {user_id}")
    return ScoreJson.model_validate(rows[0]["score_json"])


def _update(client, analysis_id: str, patch: dict) -> None:
    client.table("analyses").update(patch).eq("id", analysis_id).execute()


def _finish_failed(client, analysis_id: str, reason: str) -> None:
    _update(
        client,
        analysis_id,
        {"status": "failed", "failure_reason": reason, "updated_at": _now_iso()},
    )


# In-process work does not survive a crash/restart: a job that was
# 'processing' when the server died would spin forever in the UI, and so would
# one still sitting in `dispatch`'s queue, which is memory like any other. Any
# 'queued'/'processing' row older than this window is marked
# 'failed_recoverable' so the client can offer a retry (spec Batch 4 §4).
# Matching 'queued' as well as 'processing' is what makes a bounded pool safe
# to queue into: work that never reached a thread ends the same way as work
# that did.
STUCK_AFTER = timedelta(minutes=10)

#: How often to look, once the server is up.
#:
#: The sweep used to run **only** at startup, which recovers exactly one class
#: of failure: the crash you restart after. It does nothing for a server that
#: stays up — a worker thread killed by the OOM reaper, a `_update` to 'done'
#: that fails, a task that never returns — and those rows then spin in the UI
#: until the next deploy, which could be weeks. A musician waiting on a verdict
#: gets no answer and no error.
#:
#: Half of `STUCK_AFTER`, so nothing waits longer than about fifteen minutes
#: for an answer it is never going to get.
SWEEP_INTERVAL_SECONDS = 5 * 60


def sweep_stuck_analyses(client=None, *, now: datetime | None = None) -> int:
    """Recover crashed-mid-analysis rows. Returns how many were swept."""
    client = client or get_service_client()
    if client is None:
        return 0
    cutoff = ((now or datetime.now(tz=timezone.utc)) - STUCK_AFTER).isoformat()
    res = (
        client.table("analyses")
        .update(
            {
                "status": "failed_recoverable",
                "failure_reason": "server restarted while analyzing — please retry",
                "updated_at": _now_iso(),
            }
        )
        .in_("status", ["queued", "processing"])
        .lt("updated_at", cutoff)
        .execute()
    )
    swept = len(res.data or [])
    if swept:
        log.info("swept %d stuck analysis row(s) to failed_recoverable", swept)
    return swept


def sweep_once() -> int:
    """One sweep, with its failure contained.

    Split out so the periodic loop cannot die: a transient Supabase error must
    cost one sweep, not every sweep for the lifetime of the process. Returns 0
    when it failed, which is indistinguishable from "nothing to sweep" — and
    that is fine, because the caller's only job either way is to try again.
    """
    try:
        return sweep_stuck_analyses()
    except Exception:  # noqa: BLE001 — the loop outlives any one failure
        log.exception("stuck-analysis sweep failed")
        return 0

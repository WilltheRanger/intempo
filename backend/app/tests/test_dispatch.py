"""Where an analysis runs, and what happens when that goes wrong.

None of this needs Modal installed or an account. The point of the dispatcher
is that the choice is made in one place — so the tests can make it too.
"""

from __future__ import annotations

import os

import pytest


from app.workers import dispatch


class _Tasks:
    """Stands in for FastAPI's `BackgroundTasks`."""

    def __init__(self) -> None:
        self.added: list[tuple] = []

    def add_task(self, fn, *args) -> None:
        self.added.append((fn, args))


def test_in_process_is_the_default(monkeypatch) -> None:
    """692 tests, the corpus regression and the tuning CLI all run `analyze()`
    locally with no network. A remote-only default would mean tuning thresholds
    against real recordings needed a deploy."""
    monkeypatch.setattr(dispatch, "ANALYSIS_RUNTIME", "inprocess")
    # Asserting the *attempt*, not just the outcome. Without this the test
    # cannot tell "did not try Modal" from "tried Modal and fell back", because
    # a box with no `modal` package refuses either way and the take runs here
    # regardless — which a mutation check found by removing the runtime
    # condition entirely and staying green.
    tried: list[str] = []
    monkeypatch.setattr(
        dispatch, "_spawn_on_modal", lambda aid: tried.append(aid) or True
    )
    tasks = _Tasks()

    dispatch.start_analysis("abc", tasks)

    assert tried == [], "in-process must not reach out at all"
    assert len(tasks.added) == 1
    assert tasks.added[0][1] == ("abc",)


def test_the_setting_has_to_say_modal_exactly(monkeypatch) -> None:
    """A typo must not silently move where the work runs."""
    import importlib

    for value in ("", "MODAL ", "modal", "yes", "true", "in-process"):
        monkeypatch.setenv("ANALYSIS_RUNTIME", value)
        reloaded = importlib.reload(dispatch)
        expected = "modal" if value.strip().lower() == "modal" else "inprocess"
        assert reloaded.ANALYSIS_RUNTIME == expected, value
    monkeypatch.delenv("ANALYSIS_RUNTIME", raising=False)
    importlib.reload(dispatch)


def test_modal_is_used_when_it_is_asked_for(monkeypatch) -> None:
    monkeypatch.setattr(dispatch, "ANALYSIS_RUNTIME", "modal")
    spawned: list[str] = []
    monkeypatch.setattr(
        dispatch, "_spawn_on_modal", lambda aid: spawned.append(aid) or True
    )
    tasks = _Tasks()

    dispatch.start_analysis("abc", tasks)

    assert spawned == ["abc"]
    assert tasks.added == [], "it must not also run here"


def test_a_refused_spawn_falls_back_rather_than_losing_the_take(monkeypatch) -> None:
    """The judgement call in this file.

    A musician who has just finished playing should not lose the take because a
    deployment setting is wrong. A slow analysis on a tight box is a far better
    outcome than none — and the failure is in the log, where it belongs.
    """
    monkeypatch.setattr(dispatch, "ANALYSIS_RUNTIME", "modal")
    monkeypatch.setattr(dispatch, "_spawn_on_modal", lambda _aid: False)
    tasks = _Tasks()

    dispatch.start_analysis("abc", tasks)

    assert len(tasks.added) == 1


def test_a_missing_modal_package_is_reported_not_raised(monkeypatch) -> None:
    """`import modal` fails on a box that never installed it — which is every
    box running the tests. It must be a logged refusal, not a 500 on a request
    the musician has already waited for."""
    import builtins

    real = builtins.__import__

    def _no_modal(name, *args, **kwargs):
        if name == "modal":
            raise ImportError("no modal here")
        return real(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", _no_modal)

    assert dispatch._spawn_on_modal("abc") is False


def test_a_spawn_that_throws_is_reported_not_raised(monkeypatch) -> None:
    """Modal being unreachable, the app not being deployed, the secret being
    missing — all of it arrives here as an exception, and none of it should
    reach the request."""
    import sys
    import types

    fake = types.ModuleType("modal")

    class _Function:
        @staticmethod
        def from_name(*_args, **_kwargs):
            raise RuntimeError("not deployed")

    fake.Function = _Function
    monkeypatch.setitem(sys.modules, "modal", fake)

    assert dispatch._spawn_on_modal("abc") is False


def test_the_function_name_matches_the_deployed_one() -> None:
    """The dispatcher looks the function up by name. A rename in `modal_app.py`
    that missed this would produce analyses that are enqueued and never run —
    visible only as takes that stay `queued` forever.
    """
    from pathlib import Path

    source = (Path(__file__).resolve().parents[2] / "modal_app.py").read_text()

    assert f'APP_NAME = "{dispatch.MODAL_APP_NAME}"' in source
    assert f"def {dispatch.MODAL_FUNCTION_NAME}(" in source


def test_modal_runs_the_same_runner_not_a_copy() -> None:
    """The failure this project keeps having, which here would be the worst of
    them: two analysis runners disagreeing about a musician's timing, with
    nothing to say which one produced a given result."""
    from pathlib import Path

    source = (Path(__file__).resolve().parents[2] / "modal_app.py").read_text()

    assert "from app.workers.analysis_runner import run_analysis as run" in source


# ---------------------------------------------------------------------------
# The worker's own configuration
#
# Moving the analysis to Modal put the service-role key in a *second* place: a
# secret typed by hand into a dashboard, next to the one already in Render's
# environment. Everything else keeps working when that second copy is wrong —
# sign-in, scanning, the upload — so the only thing that reports it is the
# analysis, and until now the analysis reported it by returning quietly.
# ---------------------------------------------------------------------------


def _misconfigured_message(monkeypatch, *, client) -> str:
    import pytest

    from app.workers import analysis_runner

    monkeypatch.setattr(analysis_runner, "get_service_client", lambda: client)
    with pytest.raises(analysis_runner.WorkerMisconfigured) as caught:
        analysis_runner.run_analysis("take-42")
    return str(caught.value)


def test_a_worker_with_no_database_crashes_rather_than_returning(monkeypatch) -> None:
    """Because a clean return is indistinguishable from a clean run.

    `spawn` succeeded, the function returned, so Modal marks the call
    **succeeded** — and the one screen anybody looks at while setting Modal up
    shows green while no analysis has ever run. The row stays `queued` and the
    musician is told, ten minutes later, that the server restarted.
    """
    message = _misconfigured_message(monkeypatch, client=None)

    assert "take-42" in message, "the crash has to name the take it lost"
    assert "SUPABASE_SERVICE_ROLE_KEY" in message
    assert "SUPABASE_URL" in message


def test_the_crash_names_the_secret_the_deployment_actually_uses() -> None:
    """The message tells you which Modal secret to go and fix. If that secret
    is ever renamed in `modal_app.py`, an error message pointing at the old
    name is worse than no message — it sends the one person trying to fix this
    to a dashboard page that does not exist."""
    from pathlib import Path

    from app.workers import analysis_runner

    source = (Path(__file__).resolve().parents[2] / "modal_app.py").read_text()
    named = [
        line for line in source.splitlines() if "Secret.from_name(" in line
    ]
    assert named, "modal_app.py no longer names a secret"
    secret_name = named[0].split('Secret.from_name("')[1].split('"')[0]

    doc_and_message = (
        analysis_runner.WorkerMisconfigured.__doc__ or ""
    ) + _source_of(analysis_runner.run_analysis)
    assert secret_name in doc_and_message, (
        f"modal_app.py deploys with the secret {secret_name!r}, but the worker's "
        "misconfiguration message points somewhere else"
    )


def _source_of(fn) -> str:
    import inspect

    return inspect.getsource(fn)


def test_a_worker_reading_the_wrong_project_crashes_too(monkeypatch) -> None:
    """A `SUPABASE_URL` for a different project passes every check the worker
    has — the client builds, the call succeeds — and returns no rows. Nothing
    deletes an analysis, so a row that the API wrote and this cannot see is not
    a race; it is two halves of the deployment looking at different databases.
    """

    class _Empty:
        def table(self, _name):
            return self

        def select(self, *_a, **_k):
            return self

        def eq(self, *_a, **_k):
            return self

        def limit(self, *_a, **_k):
            return self

        def execute(self):
            class _Res:
                data: list = []

            return _Res()

    message = _misconfigured_message(monkeypatch, client=_Empty())

    assert "take-42" in message
    assert "SUPABASE_URL" in message


# ---- where a page is read -------------------------------------------------


def test_a_page_goes_to_modal_when_the_deployment_says_so(monkeypatch) -> None:
    """Reading a page with homr peaks at 1350 MB, measured. The API host has
    512 MB for the whole application, so this is not a preference."""
    spawned: list[str] = []
    monkeypatch.setattr(dispatch, "TRANSCRIPTION_RUNTIME", "modal")
    monkeypatch.setattr(
        dispatch, "_spawn_transcription_on_modal", lambda sid: spawned.append(sid) or True
    )
    tasks = _Tasks()

    dispatch.start_transcription("score-1", tasks)

    assert spawned == ["score-1"]
    assert tasks.added == [], "it was read here as well as there"


def test_a_page_is_still_read_here_when_modal_refuses(monkeypatch) -> None:
    """Falls back to a real reading, not a stub: no homr on this host, so the
    vision chain reads it instead. Worse at reading, and not nothing — a
    musician who has just photographed a page should not lose it to a
    deployment setting.
    """
    monkeypatch.setattr(dispatch, "TRANSCRIPTION_RUNTIME", "modal")
    monkeypatch.setattr(dispatch, "_spawn_transcription_on_modal", lambda sid: False)
    tasks = _Tasks()

    dispatch.start_transcription("score-2", tasks)

    assert [args for _fn, args in tasks.added] == [("score-2",)]


def test_reading_a_page_and_analysing_a_take_are_settled_separately(monkeypatch) -> None:
    """Two switches, on purpose. An analysis peaks near 460 MB and merely wants
    headroom; reading a page does not fit on the host at all. A deployment can
    sensibly run one here and one there, and one switch would force a choice
    nobody needs to make."""
    assert dispatch.ANALYSIS_RUNTIME is not dispatch.TRANSCRIPTION_RUNTIME or True
    monkeypatch.setenv("ANALYSIS_RUNTIME", "modal")
    monkeypatch.delenv("TRANSCRIPTION_RUNTIME", raising=False)
    import importlib

    reloaded = importlib.reload(dispatch)
    try:
        assert reloaded.ANALYSIS_RUNTIME == "modal"
        assert reloaded.TRANSCRIPTION_RUNTIME == "inprocess"
    finally:
        monkeypatch.delenv("ANALYSIS_RUNTIME", raising=False)
        importlib.reload(dispatch)


def test_the_modal_function_name_matches_what_is_deployed() -> None:
    """`spawn` on a name the app does not define fails at run time, on a page a
    musician is waiting for. `modal_app.py` is right there."""
    source = (
        __import__("pathlib").Path(__file__).resolve().parents[2] / "modal_app.py"
    ).read_text()

    assert f"def {dispatch.MODAL_TRANSCRIBE_FUNCTION_NAME}(" in source
    assert f"def {dispatch.MODAL_FUNCTION_NAME}(" in source


# ---- a token that was pasted with a newline ---------------------------------
#
# Reported as "the scan made something up", and it is four failures deep.
#
# `MODAL_TOKEN_ID` on the API host ended in `\n`. Modal sends both halves of
# the token as gRPC metadata, and `grpclib` refuses a metadata value containing
# a newline — so `fn.spawn()` raised `ValueError: Invalid metadata value` from
# six frames down, on every call, since the day the value was pasted.
#
# Nothing above it treated that as serious, and each layer was individually
# reasonable. The spawn failure is caught so it cannot 500 the request. The
# fallback to reading in-process is deliberate, because a musician who has just
# photographed a page should not lose it to a deployment setting. And
# `/v1/ready` tested the tokens for presence, which they had.
#
# Together they meant no page ever reached Modal, which is the only place homr
# is installed, so an orchestral bass part was read by the vision chain alone
# and returned at confidence 0.40 — its own `notes_to_human` calling it
# "approximate reconstructions" — and the app displayed that as the score.


def test_a_token_pasted_with_a_newline_is_trimmed_before_it_is_sent(monkeypatch) -> None:
    monkeypatch.setenv("MODAL_TOKEN_ID", "ak-example\n")
    monkeypatch.setenv("MODAL_TOKEN_SECRET", "  as-example  ")

    assert dispatch.clean_modal_credentials() == ["MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET"]

    assert os.environ["MODAL_TOKEN_ID"] == "ak-example"
    assert os.environ["MODAL_TOKEN_SECRET"] == "as-example"


def test_a_clean_token_is_left_exactly_as_it_is(monkeypatch) -> None:
    """Whitespace inside a value would be Modal's business, not this
    function's. Only the ends are touched."""
    monkeypatch.setenv("MODAL_TOKEN_ID", "ak-example")
    monkeypatch.setenv("MODAL_TOKEN_SECRET", "as-example")

    assert dispatch.clean_modal_credentials() == []
    assert os.environ["MODAL_TOKEN_ID"] == "ak-example"


def test_an_unset_token_is_not_invented(monkeypatch) -> None:
    """A missing credential must stay missing — `/v1/ready` reports that case
    separately, and an empty string would make it look configured."""
    monkeypatch.delenv("MODAL_TOKEN_ID", raising=False)
    monkeypatch.delenv("MODAL_TOKEN_SECRET", raising=False)

    assert dispatch.clean_modal_credentials() == []
    assert "MODAL_TOKEN_ID" not in os.environ


def test_the_value_never_reaches_the_log(monkeypatch, caplog) -> None:
    """It is a credential. The real one reached the logs already, inside the
    traceback grpclib raised — which is its own problem and the reason this
    says only which variable was wrong."""
    monkeypatch.setenv("MODAL_TOKEN_ID", "ak-hunter2\n")

    with caplog.at_level("WARNING"):
        dispatch.clean_modal_credentials()

    assert caplog.records, "a repaired credential is worth one line"
    said = " ".join(r.getMessage() for r in caplog.records)
    assert "ak-hunter2" not in said
    assert "MODAL_TOKEN_ID" in said


def test_both_spawns_repair_the_token_before_building_a_client(monkeypatch) -> None:
    """Repairing it in only one of the two would leave the other raising.

    Reading a page and analysing a take are separate runtimes on purpose
    (`TRANSCRIPTION_RUNTIME` and `ANALYSIS_RUNTIME`), and both hand work to
    Modal through a client built from these same two variables.
    """
    import re
    from pathlib import Path

    source = Path(dispatch.__file__).read_text()
    # Discovered, not listed. A third way to hand work to Modal added later is
    # covered by this without anyone remembering to add it here — and the
    # first version of this test named a function that does not exist and
    # checked nothing.
    spawners = re.findall(r"^def (_spawn\w*on_modal)\(", source, re.MULTILINE)
    assert len(spawners) >= 2, f"expected the analysis and page spawners, found {spawners}"

    for fn in spawners:
        body = source.split(f"def {fn}(")[1].split("\ndef ")[0]
        code = re.sub(r"#[^\n]*", "", body)
        assert "clean_modal_credentials()" in code, f"{fn} does not repair the token"
        # Before `import modal`, not merely somewhere in the function: the
        # client reads the environment when it is constructed.
        assert code.index("clean_modal_credentials()") < code.index("import modal"), (
            f"{fn} repairs the token after the client was already built"
        )


# ---- what actually happened to the pages ------------------------------------
#
# The fact nobody could see. `TRANSCRIPTION_RUNTIME=modal` was set and every
# page was read in this process instead, without homr, for the entire life of
# the deployment. Nothing was broken enough to notice: the spawn failure is
# caught so it cannot 500 the request, the fallback is deliberately quiet so a
# musician does not lose a page to a deployment setting, and `/v1/ready`
# reported the configuration — which was correct. A single counter would have
# shown it on the first scan.


class _Tasks:
    """Stands in for FastAPI's BackgroundTasks."""

    def __init__(self) -> None:
        self.added: list = []

    def add_task(self, fn, *args) -> None:
        self.added.append((fn, args))


@pytest.fixture(autouse=True)
def _fresh_counters():
    dispatch.transcription_dispatches.to_modal = 0
    dispatch.transcription_dispatches.fell_back = 0
    dispatch.transcription_dispatches.last_failure_type = None
    yield


def test_a_page_that_fell_back_is_counted(monkeypatch) -> None:
    monkeypatch.setattr(dispatch, "TRANSCRIPTION_RUNTIME", "modal")
    monkeypatch.setattr(dispatch, "_spawn_transcription_on_modal", lambda _id: False)
    tasks = _Tasks()

    dispatch.start_transcription("s1", tasks)

    assert dispatch.transcription_dispatches.fell_back == 1
    assert dispatch.transcription_dispatches.to_modal == 0
    # And it was still read. The counter records the fallback, it does not
    # replace it — a musician who has just photographed a page must not lose it
    # to a deployment setting.
    assert len(tasks.added) == 1


def test_a_page_that_reached_modal_is_counted(monkeypatch) -> None:
    monkeypatch.setattr(dispatch, "TRANSCRIPTION_RUNTIME", "modal")
    monkeypatch.setattr(dispatch, "_spawn_transcription_on_modal", lambda _id: True)
    tasks = _Tasks()

    dispatch.start_transcription("s1", tasks)

    assert dispatch.transcription_dispatches.to_modal == 1
    assert dispatch.transcription_dispatches.fell_back == 0
    assert tasks.added == [], "it was read twice"


def test_in_process_deployments_are_not_counted_as_falling_back(monkeypatch) -> None:
    """Reading here is not a fallback when here is where it was meant to run.
    Counting it would make every correctly-configured local deployment report
    a problem, which is how a warning stops being read."""
    monkeypatch.setattr(dispatch, "TRANSCRIPTION_RUNTIME", "inprocess")
    tasks = _Tasks()

    dispatch.start_transcription("s1", tasks)

    assert dispatch.transcription_dispatches.fell_back == 0
    assert len(tasks.added) == 1


def test_the_failure_type_is_kept_and_the_message_is_not(monkeypatch) -> None:
    """`grpclib` raises `ValueError: Invalid metadata value: '<the token>'`, so
    the message is where the credential is. It reached the Render logs once
    inside a traceback; `/v1/ready` is served over HTTP and read in a browser,
    which is the last place it should be able to reach."""
    secret = "ak-not-a-real-token"

    class _Boom:
        @staticmethod
        def from_name(*_a, **_k):
            raise ValueError(f"Invalid metadata value: {secret!r}")

    monkeypatch.setitem(__import__("sys").modules, "modal", type("m", (), {"Function": _Boom}))

    assert dispatch._spawn_transcription_on_modal("s1") is False

    recorded = dispatch.transcription_dispatches.last_failure_type
    assert recorded == "ValueError"
    assert secret not in (recorded or "")

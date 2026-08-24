"""Where an analysis runs, and what happens when that goes wrong.

None of this needs Modal installed or an account. The point of the dispatcher
is that the choice is made in one place — so the tests can make it too.
"""

from __future__ import annotations


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

"""The Deploy Modal workflow's own logic, run rather than read.

**Why this file exists.** A skipped deploy and a real one are both a green
tick. That is deliberate — a red cross on every push in a repository nobody has
set up yet is noise, and noise on a signal is how the signal stops being read —
but it means the run page cannot answer the one question anybody opens it to
ask. The first real deploy in this repository was told apart from the four
skips before it by *timing the Deploy step*: 36 seconds against zero.

So the step writes to `$GITHUB_STEP_SUMMARY` on each branch, and these tests
execute that script in bash with a stand-in `modal` to check it does.

The third case is the one worth having. `modal deploy | tee` sends the exit
status of `tee` — which always succeeds — unless `pipefail` is set. Without it
a failed deploy is a green job with a summary saying "Deployed", which is the
exact failure the summary was added to prevent, wearing the fix as a disguise.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

import pytest
import yaml

BACKEND = Path(__file__).resolve().parents[2]
WORKFLOW = BACKEND.parent / ".github" / "workflows" / "deploy-modal.yml"

#: What the real `modal deploy` prints on success. Only the shape matters —
#: the point is that the summary carries modal's words rather than ours.
MODAL_OUTPUT = "\n".join(
    [
        "Created objects.",
        "└── Created function run_analysis.",
        "App deployed in 12.345s!",
    ]
)


def _deploy_script() -> str:
    workflow = yaml.safe_load(WORKFLOW.read_text())
    step = next(
        s for s in workflow["jobs"]["deploy"]["steps"] if s.get("name") == "Deploy"
    )
    return step["run"]


def _run(*, tokens: bool, modal_exit: int = 0) -> tuple[int, str]:
    """Run the Deploy step. Returns its exit status and what it summarised."""
    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp)
        summary = directory / "summary.md"
        summary.touch()

        stand_in = directory / "modal"
        stand_in.write_text(
            "#!/usr/bin/env bash\n"
            + "".join(f"echo {line!r}\n" for line in MODAL_OUTPUT.splitlines())
            + f"exit {modal_exit}\n"
        )
        stand_in.chmod(0o755)

        completed = subprocess.run(
            ["bash", "-c", _deploy_script()],
            cwd=BACKEND,
            capture_output=True,
            text=True,
            env={
                **os.environ,
                "PATH": f"{directory}:{os.environ['PATH']}",
                "GITHUB_STEP_SUMMARY": str(summary),
                "MODAL_TOKEN_ID": "ak-stand-in" if tokens else "",
                "MODAL_TOKEN_SECRET": "as-stand-in" if tokens else "",
            },
        )
        return completed.returncode, summary.read_text()


def test_no_tokens_skips_and_says_so() -> None:
    """Green, because a fresh clone has no Modal account — but not silently."""
    status, summary = _run(tokens=False)

    assert status == 0, "an unconfigured repository must not go red on every push"
    assert "Skipped" in summary
    assert "MODAL_TOKEN_ID" in summary, "name what is missing"
    assert "Deployed" not in summary


def test_a_real_deploy_reports_modal_own_words() -> None:
    status, summary = _run(tokens=True)

    assert status == 0
    assert "Deployed" in summary
    assert "run_analysis" in summary, (
        "the summary should carry modal's output; a sentence of our own "
        "restating it is one more thing able to disagree with what happened"
    )
    assert "Skipped" not in summary


def test_a_failed_deploy_does_not_report_a_deploy() -> None:
    """The `pipefail` regression guard, and the reason this file exists.

    `modal deploy ... | tee` exits with `tee`'s status, which is always 0.
    Drop `set -eo pipefail` and a deploy that failed becomes a green job
    announcing "Deployed" — the summary lying in exactly the way it was added
    to stop.
    """
    status, summary = _run(tokens=True, modal_exit=1)

    assert status != 0, (
        "a failed `modal deploy` was swallowed by the pipe into `tee`; the job "
        "would go green with nothing deployed"
    )
    assert "Deployed" not in summary


@pytest.mark.parametrize("branch", ["skip", "deploy"])
def test_every_branch_writes_a_summary(branch: str) -> None:
    """A branch that writes nothing leaves the run page as ambiguous as it was
    before any of this — which is how it went unnoticed the first time."""
    _status, summary = _run(tokens=(branch == "deploy"))

    assert summary.strip(), f"the {branch} branch summarised nothing"


def test_the_script_still_sets_pipefail() -> None:
    """Belt and braces on the test above.

    `set -eo pipefail` could be removed *and* `tee` dropped in the same edit,
    which would leave the behaviour test green while the pipe protection is
    gone from the file — so the next person to add a pipe inherits the bug.
    """
    script = _deploy_script()
    if "| tee" in script or "|tee" in script:
        assert "pipefail" in script, (
            "the script pipes a command whose failure matters and does not set "
            "pipefail; the exit status of the pipeline is the last command's"
        )

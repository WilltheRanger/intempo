"""`tools/check-log-entry.py`'s one decision, tested.

The rule lives in a function rather than in the shell of the CI step for the
reason this repository keeps rediscovering: a rule that only runs inside a
workflow file is a rule nothing checks, and this particular one exists because
a commit landed without its `EDIT_LOG` entry and nothing noticed.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_TOOL = Path(__file__).resolve().parents[3] / "tools" / "check-log-entry.py"


@pytest.fixture(scope="module")
def check():
    spec = importlib.util.spec_from_file_location("check_log_entry", _TOOL)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_a_code_change_with_no_entry_is_refused(check) -> None:
    assert check.needs_an_entry(["backend/app/services/ocr/musicxml.py"]) == [
        "backend/app/services/ocr/musicxml.py"
    ]


def test_the_same_change_with_an_entry_is_fine(check) -> None:
    assert (
        check.needs_an_entry(
            ["backend/app/services/ocr/musicxml.py", "EDIT_LOG.md"]
        )
        == []
    )


def test_a_commit_that_only_records_things_needs_no_record(check) -> None:
    """A change to `CLAUDE.md`, `DECISIONS.md` or a README is already a record.
    Requiring an entry for one would mean an entry about writing an entry."""
    assert check.needs_an_entry(["CLAUDE.md", "DECISIONS.md", "README.md"]) == []


def test_a_tool_change_needs_an_entry_like_any_other(check) -> None:
    """**`tools/` counts, and that is the point of listing it.**

    The benches decide what gets measured and therefore what gets believed.
    Two conclusions this session came from a bench that silently skipped a
    production gate, so a change to one is exactly as worth recording as a
    change to the code it measures.
    """
    assert check.needs_an_entry(["tools/homr-bench.py"]) == ["tools/homr-bench.py"]


def test_a_fixture_change_needs_an_entry(check) -> None:
    """Every measurement in this repository is taken against the fixtures, so
    changing one silently changes every number anybody quotes."""
    assert check.needs_an_entry(["fixtures/scores/01_simple_printed.jpg"]) == [
        "fixtures/scores/01_simple_printed.jpg"
    ]


def test_every_unrecorded_file_is_named_not_just_the_first(check) -> None:
    """The message has to be actionable: "you changed the product" is not, and
    a list of what went unrecorded is."""
    changed = [
        "mobile/src/App.tsx",
        "backend/app/main.py",
        "docs/notes.md",
    ]

    assert check.needs_an_entry(changed) == [
        "backend/app/main.py",
        "mobile/src/App.tsx",
    ]


def test_the_check_would_have_caught_the_commit_that_caused_it(check) -> None:
    """`3d47e77` — tooling changed, no entry, and the `git commit` in the same
    shell command succeeded after the script writing the entry had already
    failed on a relative path."""
    assert check.needs_an_entry(
        ["tools/homr-bench.py", "tools/pipeline-check.py"]
    ) == ["tools/homr-bench.py", "tools/pipeline-check.py"]

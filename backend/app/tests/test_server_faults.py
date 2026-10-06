"""A server fault reaches the musician as a sentence, and the log as a diagnostic.

The app shows a 5xx's `detail` as it arrives, so every 5xx this API raises is
read by a person. "failed to persist score", "Failed to provision user row" and
"Supabase service-role client is not configured" were, word for word, until
2026-10-06 — and calibration passed through whatever `httpx` said about the
network. `app.errors.server_fault` keeps the diagnostic for the log.
"""

from __future__ import annotations

import ast
import logging
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.errors import server_fault

APP = Path(__file__).resolve().parents[1]


def test_server_fault_logs_the_diagnostic_and_says_the_sentence(caplog: pytest.LogCaptureFixture) -> None:
    log = logging.getLogger("intempo.test")
    with caplog.at_level(logging.ERROR, logger="intempo.test"):
        exc = server_fault(log, "failed to persist score", "The piece couldn't be saved. Try again.")

    assert isinstance(exc, HTTPException)
    assert exc.status_code == 500
    assert exc.detail == "The piece couldn't be saved. Try again."
    assert "failed to persist score" in caplog.text
    assert "failed to persist score" not in str(exc.detail)


def _status_of(call: ast.Call) -> int | None:
    for keyword in call.keywords:
        if keyword.arg != "status_code":
            continue
        value = keyword.value
        if isinstance(value, ast.Constant) and isinstance(value.value, int):
            return value.value
        if isinstance(value, ast.Attribute) and value.attr.startswith("HTTP_"):
            return int(value.attr.split("_")[1])
    return None


def _five_hundreds() -> list[tuple[str, int, str]]:
    """Every literal `detail` of a 5xx `HTTPException` or `server_fault` sentence."""
    found: list[tuple[str, int, str]] = []
    for path in sorted(APP.rglob("*.py")):
        if "tests" in path.parts:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        # Module-level string constants, so a sentence named once and raised
        # in two places (`PHOTO_UNREACHABLE`) is still read.
        constants = {
            target.id: stmt.value.value
            for stmt in tree.body
            if isinstance(stmt, (ast.Assign, ast.AnnAssign))
            and isinstance(stmt.value, ast.Constant)
            and isinstance(stmt.value.value, str)
            for target in (stmt.targets if isinstance(stmt, ast.Assign) else [stmt.target])
            if isinstance(target, ast.Name)
        }
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = getattr(node.func, "id", None) or getattr(node.func, "attr", None)
            if name == "HTTPException":
                status = _status_of(node)
                detail = next((k.value for k in node.keywords if k.arg == "detail"), None)
                if status is None or status < 500 or detail is None:
                    continue
            elif name == "server_fault" and len(node.args) >= 3:
                detail = node.args[2]
            else:
                continue
            if isinstance(detail, ast.Name):
                text = constants.get(detail.id)
            elif isinstance(detail, ast.Constant):
                text = detail.value
            else:
                text = None
            if isinstance(text, str):
                found.append((str(path.relative_to(APP)), node.lineno, text))
            else:
                found.append((str(path.relative_to(APP)), node.lineno, "<not a literal>"))
    return found


def test_the_check_finds_the_faults_it_is_about() -> None:
    # An AST walk that matched nothing would pass every assertion below.
    assert len(_five_hundreds()) >= 20


@pytest.mark.parametrize("where, line, detail", _five_hundreds())
def test_every_5xx_says_a_sentence(where: str, line: int, detail: str) -> None:
    # Literal, so it can be read here; capitalised and ended, so it reads as
    # something written for a person rather than a log line.
    assert detail != "<not a literal>", f"{where}:{line} builds its 5xx detail at run time"
    assert detail[:1].isupper(), f"{where}:{line} {detail!r}"
    assert detail.rstrip().endswith((".", "?")), f"{where}:{line} {detail!r}"

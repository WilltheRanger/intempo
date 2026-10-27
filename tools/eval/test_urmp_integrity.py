"""Tests for the URMP integrity check (JERA-578).

No real URMP data here — it is eval-only and never committed, per the
program's data-rights rule — so these write their own tiny files and their
own manifest. The one test that touches the real `urmp_checksums.txt` only
reads it, and checks it covers exactly what `fetch_urmp.py` fetches.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

_EVAL = Path(__file__).resolve().parent
if str(_EVAL) not in sys.path:
    sys.path.insert(0, str(_EVAL))

import fetch_urmp
from urmp_integrity import (
    CHECKSUMS_PATH,
    Integrity,
    check_file,
    check_tree,
    load_checksums,
    summarize,
    unusable,
)


def _write(path: Path, body: bytes) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return hashlib.sha256(body).hexdigest()


def _manifest(tmp_path: Path, entries: dict[str, str]) -> Path:
    path = tmp_path / "manifest.txt"
    lines = ["# a comment, and a blank line follows", ""]
    lines += [f"{digest}  {name}" for name, digest in entries.items()]
    path.write_text("\n".join(lines) + "\n")
    return path


def test_load_checksums_skips_comments_and_blanks(tmp_path):
    path = _manifest(tmp_path, {"a/b.wav": "0" * 64})
    assert load_checksums(path) == {"a/b.wav": "0" * 64}


def test_matching_bytes_are_verified_and_usable(tmp_path):
    digest = _write(tmp_path / "piece/AuSep_1_vn_x.wav", b"bowed string")
    check = check_file(
        tmp_path / "piece/AuSep_1_vn_x.wav",
        "piece/AuSep_1_vn_x.wav",
        {"piece/AuSep_1_vn_x.wav": digest},
    )
    assert check.status is Integrity.VERIFIED
    assert check.usable


def test_changed_bytes_are_a_mismatch_and_unusable(tmp_path):
    """The case the manifest exists for: the mirror serves something else."""
    _write(tmp_path / "piece/Notes_1_vn_x.txt", b"1.0\t440.0\t0.5\n")
    check = check_file(
        tmp_path / "piece/Notes_1_vn_x.txt",
        "piece/Notes_1_vn_x.txt",
        {"piece/Notes_1_vn_x.txt": "f" * 64},
    )
    assert check.status is Integrity.MISMATCH
    assert not check.usable
    assert check.expected_sha256 == "f" * 64
    assert check.actual_sha256 and check.actual_sha256 != check.expected_sha256


def test_file_absent_from_the_manifest_is_unverified_not_an_error(tmp_path):
    _write(tmp_path / "new_piece/AuSep_1_vn_y.wav", b"a piece nobody has checked")
    check = check_file(
        tmp_path / "new_piece/AuSep_1_vn_y.wav", "new_piece/AuSep_1_vn_y.wav", {}
    )
    assert check.status is Integrity.UNVERIFIED
    assert not check.usable
    assert check.actual_sha256 is None  # no point hashing what nothing describes


def test_missing_file_reports_missing(tmp_path):
    check = check_file(tmp_path / "gone.wav", "gone.wav", {"gone.wav": "0" * 64})
    assert check.status is Integrity.MISSING
    assert not check.usable


def test_check_tree_and_unusable_cover_the_whole_directory(tmp_path):
    good = _write(tmp_path / "p/Sco_p.mid", b"MThd fake")
    _write(tmp_path / "p/AuSep_1_vn_p.wav", b"audio")
    _write(tmp_path / "q/AuSep_1_vn_q.wav", b"unlisted")
    checks = check_tree(
        tmp_path,
        {"p/Sco_p.mid": good, "p/AuSep_1_vn_p.wav": "a" * 64},
    )
    assert {c.relative_path: c.status for c in checks} == {
        "p/AuSep_1_vn_p.wav": Integrity.MISMATCH,
        "p/Sco_p.mid": Integrity.VERIFIED,
        "q/AuSep_1_vn_q.wav": Integrity.UNVERIFIED,
    }
    assert unusable(checks) == {"p/AuSep_1_vn_p.wav", "q/AuSep_1_vn_q.wav"}
    assert summarize(checks) == "1 mismatch, 1 unverified, 1 verified"


def test_the_real_manifest_covers_every_file_fetch_urmp_fetches():
    """The manifest and `PIECES` have to stay in step: a piece added to the
    fetch without a hash is a take that silently leaves the baseline."""
    expected = load_checksums(CHECKSUMS_PATH)
    assert len(expected) == 18
    assert all(len(digest) == 64 for digest in expected.values())

    wanted = set()
    for piece, violin_numbers in fetch_urmp.PIECES:
        stem = "_".join(piece.split("_")[:2])
        wanted.add(f"{piece}/Sco_{piece}.mid")
        for n in violin_numbers:
            wanted.add(f"{piece}/AuSep_{n}_vn_{stem}.wav")
            wanted.add(f"{piece}/Notes_{n}_vn_{stem}.txt")
    assert wanted == set(expected)

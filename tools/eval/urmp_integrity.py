"""Checks URMP files against the official release's hashes (JERA-578).

`urmp_checksums.txt` holds the `sha256` of every file `fetch_urmp.py`
fetches, taken from the authors' own archival deposit of URMP rather than
from the mirror the fetch actually uses — see that file's header for how it
was produced, and `fetch_urmp.py`'s docstring for why the mirror is in use
at all. The point of the split is that the manifest is independent of the
mirror: if the mirror's bytes ever stop matching it, the fetch fails and the
harness drops the take, instead of a baseline moving for a reason nobody
sees.

Three outcomes per file, and the third is the one worth naming: `VERIFIED`
(hash matches the manifest), `MISMATCH` (the manifest has this file and the
bytes are different — refuse it), and `UNVERIFIED` (the manifest says
nothing about this file, because somebody added a piece to `PIECES` without
extending the manifest). An `UNVERIFIED` file is not an error — it is just
not evidence yet, so it stays out of the numbers until someone checks it the
same way the first eighteen were checked.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

CHECKSUMS_PATH = Path(__file__).resolve().parent / "urmp_checksums.txt"


class Integrity(str, Enum):
    VERIFIED = "verified"
    MISMATCH = "mismatch"
    UNVERIFIED = "unverified"
    MISSING = "missing"


@dataclass(frozen=True)
class FileCheck:
    relative_path: str
    status: Integrity
    expected_sha256: str | None
    actual_sha256: str | None

    @property
    def usable(self) -> bool:
        """Whether a take built from this file belongs in the harness's
        numbers. Only a hash that matches the official release does."""
        return self.status is Integrity.VERIFIED


def load_checksums(path: Path = CHECKSUMS_PATH) -> dict[str, str]:
    """`{relative path: sha256}` from a `sha256sum`-format manifest with
    `#` comments."""
    expected: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        digest, _, name = line.partition("  ")
        if not name:
            raise ValueError(f"{path}: cannot read manifest line {line!r}")
        expected[name.strip()] = digest.strip()
    return expected


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        # URMP's AuSep wavs run to ~19 MB; read in chunks rather than whole.
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def check_file(path: Path, relative_path: str, expected: dict[str, str]) -> FileCheck:
    want = expected.get(relative_path)
    if not path.is_file():
        return FileCheck(relative_path, Integrity.MISSING, want, None)
    if want is None:
        return FileCheck(relative_path, Integrity.UNVERIFIED, None, None)
    got = file_sha256(path)
    status = Integrity.VERIFIED if got == want else Integrity.MISMATCH
    return FileCheck(relative_path, status, want, got)


def check_tree(root: Path, expected: dict[str, str] | None = None) -> list[FileCheck]:
    """Every file under `root` (an `intempo-eval-data/urmp/`), checked."""
    if expected is None:
        expected = load_checksums()
    paths = sorted(p for p in root.rglob("*") if p.is_file())
    return [check_file(p, p.relative_to(root).as_posix(), expected) for p in paths]


def unusable(checks: list[FileCheck]) -> set[str]:
    """The relative paths a caller must not build a take from."""
    return {c.relative_path for c in checks if not c.usable}


def summarize(checks: list[FileCheck]) -> str:
    counts: dict[str, int] = {}
    for check in checks:
        counts[check.status.value] = counts.get(check.status.value, 0) + 1
    return ", ".join(f"{n} {status}" for status, n in sorted(counts.items()))

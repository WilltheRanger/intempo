"""Every extension the app can propose is one the server accepts.

`POST /v1/upload/{score-image,avatar,audio}` each refuse a filename whose
extension is not on their list, **before** the bytes move. That refusal is a
400 with a server rule string in it, shown to a musician about a photograph or
a recording that never left their phone — the exact failure CLAUDE.md records
the score upload having shipped once, when an unrecognised name declared
`image/jpeg` and filed the object as `page.heif`.

Four places in the app decide an extension, and **not one of them was compared
with the list it has to satisfy**:

    lib/scan/uploadPage.ts    EXT_BY_MIME + FALLBACK.ext   → score-image
    data/hooks/useProfile.ts  extensionFor's map + '??'    → avatar
    lib/audio/types.ts        takeFilename                 → audio
    lib/scan/uploadPage.test.ts  ALLOWED                   → score-image

The last is the one that makes the gap invisible: it is a **hand-copied**
transcript of `_ALLOWED_IMAGE_EXTS`, with a comment pointing at
`routers/upload.py`. So the client has a test that reads like coverage of the
server's rule and would go on passing if the server changed it.

**The dangerous direction is the server tightening its list.** The app's own
tests all pass, the backend's all pass, and a page or a picture is refused in a
musician's hands. For the avatar that is worse than an inconvenience:
onboarding requires a photograph and has no Skip, so a drift there locks a new
musician out of the app entirely.

The three lists are deliberately different — an avatar takes no HEIC, because
it is handed to an `<img>` and browsers cannot display one — so this compares
each producer against **its own** endpoint's list, never the three with each
other.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.routers.upload import (
    _ALLOWED_AUDIO_EXTS,
    _ALLOWED_AVATAR_EXTS,
    _ALLOWED_IMAGE_EXTS,
)

REPO = Path(__file__).resolve().parents[3]
MOBILE_SRC = REPO / "mobile" / "src"


def _source(relative: str) -> str:
    path = MOBILE_SRC / relative
    assert path.exists(), f"the app no longer has {relative}"
    return path.read_text()


def _object_values(source: str, declaration: str) -> set[str]:
    """The values of a `const NAME: Record<string, string> = { … }` literal.

    Read from the app's source rather than from a copy here, which is the whole
    point: a copy is the thing that goes stale.
    """
    start = source.index(declaration)
    body = source[start + len(declaration) : source.index("}", start)]
    values = set(re.findall(r":\s*'([a-z0-9]+)'", body))
    assert values, f"no values parsed out of {declaration!r}"
    return values


def test_every_extension_a_page_can_be_filed_under_is_accepted() -> None:
    """`EXT_BY_MIME` plus the fallback: everything `uploadPage` can send."""
    source = _source("lib/scan/uploadPage.ts")
    proposed = _object_values(source, "const EXT_BY_MIME: Record<string, string> = {")

    fallback = re.search(r"const FALLBACK = \{[^}]*ext: '([a-z0-9]+)'", source)
    assert fallback, "uploadPage.ts no longer declares a FALLBACK extension"
    proposed.add(fallback.group(1))

    refused = sorted(proposed - _ALLOWED_IMAGE_EXTS)

    assert not refused, (
        "the app files a page under these and POST /v1/upload/score-image "
        f"refuses them, before the bytes move: {refused}"
    )


def test_every_extension_an_avatar_can_be_filed_under_is_accepted() -> None:
    """The one where a drift locks somebody out.

    Onboarding requires a photograph and has no Skip (CLAUDE.md, the owner's
    call of 2026-08-25), so a picture the server will not sign an upload for is
    a new musician who cannot finish signing up.
    """
    source = _source("data/hooks/useProfile.ts")
    proposed = _object_values(source, "const known: Record<string, string> = {")

    fallback = re.search(r"return known\[[^\]]+\] \?\? '([a-z0-9]+)';", source)
    assert fallback, "extensionFor no longer has a literal fallback"
    proposed.add(fallback.group(1))

    refused = sorted(proposed - _ALLOWED_AVATAR_EXTS)

    assert not refused, (
        "the app files an avatar under these and POST /v1/upload/avatar "
        f"refuses them: {refused}"
    )


def test_the_extension_a_take_is_filed_under_is_accepted() -> None:
    """One extension, and it is the whole audio path.

    Both recorders name their take with `takeFilename`, so this is every
    recording the app has ever uploaded. A refusal here costs the musician the
    take they have just played.
    """
    source = _source("lib/audio/types.ts")
    match = re.search(r"return `take-\$\{stamp\}\.([a-z0-9]+)`;", source)
    assert match, "takeFilename no longer builds a literal extension"

    assert match.group(1) in _ALLOWED_AUDIO_EXTS, (
        f"the app files every take as .{match.group(1)} and "
        f"POST /v1/upload/audio accepts only {sorted(_ALLOWED_AUDIO_EXTS)}"
    )


def test_the_apps_own_test_is_not_a_stale_copy_of_the_servers_rule() -> None:
    """`uploadPage.test.ts` asserts against a transcript of this list.

    Equality, not containment: a copy that has grown an extension the server
    refuses passes a client-side check about a page the server will turn away,
    and a copy that has lost one asserts a rule stricter than the real one. Both
    read as coverage.

    Held here rather than there because the app cannot import Python, and
    somewhere is better than the two lists agreeing by memory.
    """
    source = _source("lib/scan/uploadPage.test.ts")
    match = re.search(r"const ALLOWED = \[([^\]]*)\];", source)
    assert match, "uploadPage.test.ts no longer declares an ALLOWED list"

    copied = set(re.findall(r"'([a-z0-9]+)'", match.group(1)))

    assert copied == _ALLOWED_IMAGE_EXTS, (
        f"uploadPage.test.ts allows {sorted(copied)}; "
        f"_ALLOWED_IMAGE_EXTS is {sorted(_ALLOWED_IMAGE_EXTS)}"
    )


@pytest.mark.parametrize(
    ("name", "allowed"),
    [
        ("_ALLOWED_IMAGE_EXTS", _ALLOWED_IMAGE_EXTS),
        ("_ALLOWED_AVATAR_EXTS", _ALLOWED_AVATAR_EXTS),
        ("_ALLOWED_AUDIO_EXTS", _ALLOWED_AUDIO_EXTS),
    ],
)
def test_a_list_the_server_reads_is_not_empty(name: str, allowed: set[str]) -> None:
    """A set that has become empty makes every containment check above pass
    only because nothing is proposed against it — no, it fails them; it makes
    the *server* refuse everything. Either way it is not a state to reach
    quietly."""
    assert allowed, f"{name} accepts nothing at all"

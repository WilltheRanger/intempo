"""Every route this API serves, and whether any client can reach it.

**Two features were finished on the server and had no client at all**, found
one at a time by reading routers nobody had opened in a while:

- `POST /v1/analyses/:id/corrections` — the verdict feedback loop, whose own
  docstring calls it *"the only route out of the position Batch 3 is currently
  stuck in"*: thresholds still on the spec's starting values because tuning
  needs real ears on real recordings. It is owner-scoped, append-only, tested,
  inventoried by the account export and taken by account deletion, and
  `verdict_corrections` is empty for every account because nothing posts to it.
- `POST /v1/calibration` — infer a target BPM from a short clip (spec §4).
  `bpm_source` carries `calibration_clip` for it and `submitTake.ts` says, in
  the present tense, that it "is for the flow where a short clip infers it
  instead". There is no such flow.

Neither was noticed by anything, because a finished endpoint looks exactly like
a used one from the server side: it has tests, they pass, and the router file
reads as complete. The gap is only visible from *across* the wire, which is
where this file stands — the same place `test_client_enums.py` stands, and the
same technique: read the app's TypeScript from Python and compare.

**The `NOT_WIRED` list is the dangerous part of this file, and it is written to
resist going stale.** An exclusion list with a reason attached is exactly what
`fixtures/timeline/parity.json` had, where a reason that had quietly stopped
being true kept real coverage out for a release and a test *asserted* the
exclusion. So this one is checked in both directions: an entry that names a
route the app has since started calling fails, and so does an entry naming a
route that no longer exists. You cannot leave a wired route on the list, and
you cannot leave a deleted one there either.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.tests.served_routes import served_paths

REPO = Path(__file__).resolve().parents[3]
APP_SRC = REPO / "mobile" / "src"

#: Paths with no client, and why. Delete an entry when you wire one up — the
#: test below will tell you to.
#:
#: **Keyed by path, not by (method, path)**, because that is the granularity
#: the check actually has: the method lives in the fetch options rather than
#: beside the URL, so a path the app builds reads as reached whichever verb it
#: uses. Keying by method would let an entry claim a precision the matcher
#: cannot deliver — `GET /v1/analyses/{id}/corrections` sat here for exactly
#: one commit after the POST beside it was wired, and read as "actually wired"
#: because its path is the same string.
#:
#: A reason here is a claim about the product, not an excuse. "Not built yet"
#: is a real reason; "probably fine" is not. Anything on this list is a
#: feature a musician cannot use.
NOT_WIRED: dict[str, str] = {
    "/v1/calibration": (
        "No clip-to-tempo flow; the record screen sets the tempo directly. "
        "§2 gate."
    ),
    # The teacher tier's six endpoints. The backend half is complete and
    # tested; every screen that would call them — a teacher's studio list, an
    # assignment detail, the student's Today card for assigned work — is
    # user-facing, and §2 reserves that to the owner. A data-layer module with
    # no screen behind it would also trip `check-dead-exports.py`, so the
    # client arrives with the screens or not at all.
    "/v1/assignments": "Teacher tier; no studio or assignment screens yet. §2 gate.",
    "/v1/assignments/{assignment_id}": (
        "Teacher tier; no assignment detail screen yet. §2 gate."
    ),
    "/v1/assignments/{assignment_id}/submit": (
        "Teacher tier; the student's verdict screen has no 'send to my teacher' "
        "action yet. §2 gate."
    ),
    "/v1/assignments/{assignment_id}/review": (
        "Teacher tier; no review screen yet. §2 gate."
    ),
    "/v1/assignments/{assignment_id}/takes": (
        "Teacher tier; the takes-over-time view is the one genuinely new screen "
        "the loop needs, and it is unbuilt. §2 gate."
    ),
}


def _routes() -> list[tuple[str, str]]:
    """Every `/v1` route the running app serves, as (method, path template).

    From `served_paths()`, which reads the OpenAPI schema. This walked
    `app.routes` directly until FastAPI 0.141 stopped putting prefixed paths
    there — see `served_routes.py`.
    """
    out: list[tuple[str, str]] = []
    for path, methods in served_paths().items():
        if not path.startswith("/v1"):
            continue
        for method in sorted(methods - {"HEAD", "OPTIONS"}):
            out.append((method, path))
    return sorted(out)


def strip_comments(source: str) -> str:
    """TypeScript with its comments removed, strings left intact.

    **A URL named in a comment is not a call**, and this file learned that the
    hard way: the first version searched raw source, and the very commit that
    documented `/v1/calibration` as unreachable made it read as reached. The
    check reported the fix as the feature.

    A scanner rather than a regex because `https://` lives inside strings all
    over this tree, and any rule that deletes from `//` to end of line without
    knowing it is inside a string truncates the string — quietly, and in the
    direction that hides a real call.
    """
    out: list[str] = []
    index = 0
    length = len(source)
    quote: str | None = None
    while index < length:
        char = source[index]
        if quote is not None:
            out.append(char)
            if char == "\\" and index + 1 < length:
                out.append(source[index + 1])
                index += 2
                continue
            if char == quote:
                quote = None
            index += 1
            continue
        if char in "\"'`":
            quote = char
            out.append(char)
            index += 1
            continue
        if source.startswith("//", index):
            end = source.find("\n", index)
            index = length if end == -1 else end
            continue
        if source.startswith("/*", index):
            end = source.find("*/", index + 2)
            index = length if end == -1 else end + 2
            continue
        out.append(char)
        index += 1
    return "".join(out)


def _client_source() -> str:
    """Every non-test line of the app, comments removed, as one searchable string."""
    return "\n".join(
        strip_comments(path.read_text(errors="ignore"))
        for path in sorted(APP_SRC.rglob("*.ts*"))
        if ".test." not in path.name
    )


def _calls(path: str, source: str) -> bool:
    """Whether the app builds this route's URL anywhere.

    A path parameter is written `${...}` in a template literal, so the route
    template is turned into a regex with each `{param}` standing for one
    interpolation, anchored on the quote that opens the string. Comments are
    gone before this runs.

    A helper that assembled a URL from fragments would read as unreached here,
    and that is the safer direction to be wrong in — it asks for a second look
    rather than quietly passing.
    """
    parts = re.split(r"\{[^}]+\}", path)
    pattern = "".join(
        re.escape(part) if index == 0 else r"\$\{[^}]+\}" + re.escape(part)
        for index, part in enumerate(parts)
    )
    # Anchored on the opening quote, so the path has to be the start of a
    # string the app builds rather than text that merely contains it.
    return re.search(r"[\"'`]" + pattern, source) is not None


def test_every_route_is_reachable_from_the_app_or_listed_as_not() -> None:
    """A new endpoint with no client fails here, on the commit that adds it."""
    source = _client_source()
    unreachable = [
        route for route in _routes() if not _calls(route[1], source) and route[1] not in NOT_WIRED
    ]

    assert not unreachable, (
        "these routes are served and no client calls them: "
        + ", ".join(f"{method} {path}" for method, path in unreachable)
        + " — wire one up, or add it to NOT_WIRED with the reason a musician "
        "cannot use it"
    )


def test_nothing_on_the_not_wired_list_is_actually_wired() -> None:
    """The half that stops the list rotting.

    Without this, wiring up a feature leaves its entry sitting there saying it
    is unbuilt — and the next person to read the list believes it.
    """
    source = _client_source()
    now_wired = [path for path in NOT_WIRED if _calls(path, source)]

    assert not now_wired, (
        "these are on NOT_WIRED but the app calls them now: "
        + ", ".join(sorted(now_wired))
        + " — delete the entries"
    )


@pytest.mark.parametrize("path", sorted(NOT_WIRED))
def test_the_not_wired_list_names_routes_that_exist(path: str) -> None:
    """A renamed or deleted route must not leave a ghost behind."""
    assert path in {served for _, served in _routes()}, (
        f"{path} is on NOT_WIRED but is not served"
    )


def _urls_the_app_builds() -> dict[str, set[str]]:
    """Every `/v1` URL the app writes, and the files each appears in.

    Taken from the start of a string, which is where a URL is written here —
    the same anchor `_calls` uses from the other side.
    """
    found: dict[str, set[str]] = {}
    for path in sorted(APP_SRC.rglob("*.ts*")):
        if ".test." in path.name:
            continue
        source = strip_comments(path.read_text(errors="ignore"))
        for match in re.finditer(r"""["'`](/v1/[^"'`\s]*)""", source):
            found.setdefault(match.group(1), set()).add(path.name)
    return found


def _is_served(url: str, served: set[str]) -> bool:
    """Whether a URL the app builds resolves to a route template.

    The query string is dropped — `/v1/scores?${query}` is a call to
    `/v1/scores`. The match is anchored at both ends, so a URL with a stray
    segment does not pass by prefix.
    """
    bare = url.split("?")[0]
    for template in served:
        pattern = (
            "^"
            + "".join(
                re.escape(part) if index == 0 else r"\$\{[^}]+\}" + re.escape(part)
                for index, part in enumerate(re.split(r"\{[^}]+\}", template))
            )
            + "$"
        )
        if re.match(pattern, bare):
            return True
    return False


def test_every_url_the_app_builds_is_a_route_this_api_serves() -> None:
    """The other direction, and the one a musician feels.

    A route with no client is a feature nobody can reach. A *client* with no
    route is a 404 in someone's hands — a screen that spins and then says
    something went wrong, for a URL that was mistyped or renamed on one side
    only. Nothing else here would catch it: there is no integration test
    against a running server, and both suites pass with the app pointed at an
    endpoint that does not exist.

    **Paths only, not methods.** The method lives in the fetch options rather
    than beside the URL, so this says the path is served, not that it accepts
    the verb used. That is the half that catches a typo, which is the failure
    this is for.
    """
    served = {path for _, path in _routes()}
    unserved = {
        url: sorted(files)
        for url, files in _urls_the_app_builds().items()
        if not _is_served(url, served)
    }

    assert not unserved, (
        "the app builds URLs this API does not serve: "
        + ", ".join(f"{url} ({', '.join(files)})" for url, files in sorted(unserved.items()))
    )


def test_the_app_url_check_can_tell_the_difference() -> None:
    """Vacuity guard for the direction above."""
    served = {path for _, path in _routes()}

    assert _is_served("/v1/scores/${id}/accept", served)
    assert _is_served("/v1/scores?${query}", served), "a query string broke the match"
    assert not _is_served("/v1/scores/${id}/accept/extra", served), "matched by prefix"
    assert not _is_served("/v1/nope", served)
    assert _urls_the_app_builds(), "found no URLs at all — the scan is broken"


def test_the_check_can_tell_the_difference() -> None:
    """The guard against a vacuous pass.

    If `_calls` matched everything, the first test would pass with every route
    unreachable and this file would be decoration.
    """
    source = _client_source()

    assert _calls("/v1/scores/{score_id}/accept", source), "a wired route read as unreached"
    assert not _calls("/v1/scores/{score_id}/definitely-not-a-route", source), (
        "an invented route read as reached"
    )


def test_a_route_named_only_in_a_comment_does_not_count_as_a_call() -> None:
    """The failure that produced `strip_comments`.

    Documenting an unreachable endpoint must not mark it reachable, or the
    check reports the note as the fix. Both comment forms, and a `https://`
    inside a string to prove the scanner does not truncate one.
    """
    line = strip_comments("// see POST '/v1/ghost' for why\nconst a = 1;")
    block = strip_comments("/* '/v1/ghost' */ const b = 2;")

    assert "/v1/ghost" not in line
    assert "/v1/ghost" not in block
    assert "const a = 1;" in line and "const b = 2;" in block

    kept = strip_comments("const url = 'https://example.test/v1/ghost'; // gone")
    assert "https://example.test/v1/ghost" in kept, "the scanner truncated a string"
    assert "gone" not in kept

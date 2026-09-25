"""That a failure a musician is shown is one they can act on.

`_FAILURE_REASONS` turns whatever went wrong into a sentence on the score
screen. Its default is *"a flatter, better-lit shot of the page usually fixes
it"* — advice, and advice that only helps when the photograph is the problem.
For a fault on our side the musician will follow it, and it will fail again,
and again.

**That has now been got wrong three times**, each recorded in the table's own
comments: `homr is not installed in this container` matched nothing;
`AuthenticationError: invalid x-api-key` matched nothing because hyphens were
not flattened; and three of the four server-side needles reached the default
when they were first measured against the running service.

Each fix added needles. **Nothing checked that the next raise site would get
one**, which is the same shape of hole `REQUIRED_COLUMNS` had, and `NOT_WIRED`
had, and `_HUMAN_STAGES` had. This closes it: every message the read path
raises either matches a needle, or is named below with a reason why the default
really is the right sentence.

Measured when this went in, four templates were landing on the default that
should not have been, and each is now a needle:

    unknown provider 'gpt4v'          a typo in OCR_PROVIDER_CHAIN, while its
                                      two siblings already had needles
    RuntimeError: CUDA out of memory  the predictable failure of a reader that
                                      peaks at 1350 MB
    not parseable as XML              homr's *own* output, unreadable
    nothing to join                   an internal invariant
"""

from __future__ import annotations

import re
from pathlib import Path

from app.workers.transcription_runner import _UNKNOWN_REASON, _why_it_failed

OCR = Path(__file__).resolve().parents[1] / "services" / "ocr"

#: Templates whose failures really are about the photograph, or which carry no
#: text of their own to match on.
#:
#: **Checked in both directions**, for the reason `NOT_WIRED` is: an entry that
#: has since gained a needle fails, and so does one whose message no longer
#: exists. An exclusion list whose reasons rot is exactly what
#: `fixtures/timeline/parity.json` was.
DEFAULT_IS_RIGHT: dict[str, str] = {
    "{self.name}: {type(exc).__name__}: {exc}": (
        "Carries no words of its own — whatever the library raised. The known "
        "contents are needled ('out of memory', 'api key', 'authentication', "
        "'rate limit'); the rest genuinely is unknown, and a sentence "
        "pretending otherwise would be worse than the honest default."
    ),
    "{self.name}: {exc}": (
        "The same, wrapping a MusicXMLError from homr's own output. Its "
        "contents are needled by 'not parseable as xml'."
    ),
    "{name}: found no bars of music on this page": (
        "homr read the page and there were no bars on it. A flatter, "
        "better-lit shot is the honest next step."
    ),
    "{self.name}: found no staves on this page": (
        "homr found no staves, after the sideways retry has already been "
        "tried. A better photograph is the thing that helps."
    ),
    "{self.name}: no content parts": (
        "A vision model answered with nothing. Re-reading a better photograph "
        "is the honest next step, and the vision chain is off by the owner's "
        "decision of 2026-08-24 in any case."
    ),
    "{self.name}: first content part has no text": (
        "As above — a vision model answered with nothing usable."
    ),
    "{self.name}: empty response text": (
        "As above, from the other vision provider."
    ),
    "{self.name}: no text in the answer": (
        "Raised only by `ClaudeProvider.ask`, whose one caller is "
        "`tempo_marks.read_tempo_marks`: it catches everything and keeps the "
        "reading as it was, so this never becomes a sentence on a score."
    ),
    "no <part> element — this is not a MusicXML score": (
        "The import route's words about a musician's own file, answered as a "
        "422 by `POST /v1/scores/import`. It never reaches this table; homr's "
        "output cannot lack a part element, because homr writes it."
    ),
    "no part matching {wanted!r}; this file has: {available}": (
        "Import route, 422. The app picks the part from a list it read out of "
        "the same file, so this is a client bug rather than a scan failure."
    ),
    "this file has {len(parts)} parts and none was chosen: {available}. "
    "Pick the one you play.": (
        "Import route, 422, and the sentence already names what to do."
    ),
    "no notes found: ; ": (
        "`NoMusicFound` — every crop came back with no music on it. The page "
        "reached the reader and had nothing readable, so the photograph is "
        "the thing to change."
    ),
    "all providers failed: ; ": (
        "A wrapper: the needles match against the whole string, so an inner "
        "reason that has one is found through it. Only a chain whose every "
        "provider failed for an unneedled reason lands here."
    ),
}

_RAISE = re.compile(r"raise\s+(\w+)\(")
_LITERAL = re.compile(r'f?"((?:[^"\\]|\\.)*)"')


def _raised_templates() -> dict[str, list[str]]:
    """Every message the read path raises, as written in the source.

    Keyed by the joined string literals — the f-string template, braces and
    all — because that is what is greppable and what stays stable when a
    variable is renamed. A raise with no literal at all (re-raising a caught
    exception) has nothing to check and is skipped.
    """
    found: dict[str, list[str]] = {}
    for path in sorted(OCR.glob("*.py")):
        text = path.read_text()
        for match in _RAISE.finditer(text):
            start = match.end() - 1
            depth, end = 0, start
            while end < len(text):
                if text[end] == "(":
                    depth += 1
                elif text[end] == ")":
                    depth -= 1
                    if depth == 0:
                        break
                end += 1
            parts = _LITERAL.findall(text[start : end + 1])
            if parts:
                found.setdefault("".join(parts), []).append(path.name)
    return found


def test_every_failure_the_reader_raises_has_a_sentence_or_a_reason() -> None:
    unhandled = sorted(
        (template, sorted(set(files)))
        for template, files in _raised_templates().items()
        if _why_it_failed(template) == _UNKNOWN_REASON
        and template not in DEFAULT_IS_RIGHT
    )

    assert not unhandled, (
        "these land on 'a flatter, better-lit shot of the page usually fixes "
        "it'. Add a needle to `_FAILURE_REASONS` if the fault is ours, or an "
        "entry to `DEFAULT_IS_RIGHT` saying why the photograph really is the "
        "thing to change: "
        + "; ".join(f"{t!r} in {f}" for t, f in unhandled)
    )


def test_no_excluded_message_has_quietly_gained_a_needle() -> None:
    """A stale exclusion is the failure mode this list is most likely to have.

    An entry that now matches means somebody wrote the needle and left the
    reason behind, and the next reader believes a case is uncovered when it is
    not — which is how the timeline fixture kept real coverage out for a
    release.
    """
    covered = sorted(
        template
        for template in DEFAULT_IS_RIGHT
        if _why_it_failed(template) != _UNKNOWN_REASON
    )

    assert not covered, (
        "these now match a needle, so their entry in `DEFAULT_IS_RIGHT` is "
        "wrong: " + "; ".join(repr(t) for t in covered)
    )


def test_no_excluded_message_has_stopped_existing() -> None:
    """The other half. A reason kept for a message nobody raises any more is
    dead weight that reads like live coverage."""
    raised = set(_raised_templates())

    gone = sorted(t for t in DEFAULT_IS_RIGHT if t not in raised)

    assert not gone, (
        "nothing raises these any more; drop their entries: "
        + "; ".join(repr(t) for t in gone)
    )


def test_the_default_still_says_what_this_file_assumes_it_says() -> None:
    """Everything above is about one sentence. If it stops being advice about
    the photograph, the whole argument here needs rereading rather than
    quietly continuing to pass."""
    assert "photograph" in _UNKNOWN_REASON
    assert "flatter" in _UNKNOWN_REASON

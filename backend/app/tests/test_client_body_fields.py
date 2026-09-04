"""The field names in a body, both directions, between the two trees.

`test_client_reachability.py` holds the **paths**; `test_client_enums.py` holds
the **vocabularies**. This is the third of the same family and the one that was
missing: the **field names** in a request body.

**It matters here more than it would in most APIs, because these models forbid
extras.** `ConfigDict(extra="forbid")` turns one unknown key into a 422, on
*every* request through that endpoint — so a field added to
`CreateAnalysisInput` and not to `CreateAnalysisRequest` does not degrade a
feature, it stops every take being submitted. The reverse fails just as hard: a
new **required** field on the server rejects every request an installed build
makes. Neither is visible in either tree alone.

The seam is the app's own typed interfaces — the same shape of contract the
enum tests read, and one that stays greppable when a variable is renamed.

**The response direction fails the other way, and worse: silently.** A server
field the app reads under a name the server no longer sends comes back
`undefined`, and the adapters have fallbacks. `api.ts` maps
`score.transcription_status ?? 'done'`, so renaming that one field makes every
piece in the library read as finished the moment it is created — no progress
bar, a failed scan shown as done with no notes, and nothing raising.

Measured: renaming `ScoreResponse.transcription_status` to
`transcription_state` passes **1992 backend tests and 1478 mobile tests**.
Nothing in either tree could see it. That is the case this half exists for.

Measured on the request side, all eight pairs agree, every required server
field is declared non-optionally in the app, and no app field is unknown to
its model. That half is a fence rather than a repair.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.models.user import MeResponse, UpdateMeRequest, UsageResponse
from app.routers.analyses import AnalysisResponse, CreateAnalysisRequest
from app.routers.corrections import Correction
from app.routers.scores import (
    AttachScorePagesRequest,
    CreateScoreRequest,
    ImportScoreRequest,
    MeasureConcern,
    ScoreResponse,
    UpdateScoreRequest,
)
from app.routers.upload import UploadResponse
from app.services.analysis import AnalysisResult, PerMeasure, PerNote, Tolerance
from app.services.score_schema import Measure, Note, Repeat, ScoreJson

REPO = Path(__file__).resolve().parents[3]
MOBILE_SRC = REPO / "mobile" / "src"
BACKEND_APP = REPO / "backend" / "app"

#: (file under `mobile/src`, TypeScript interface, the model it is sent to).
PAIRS: tuple[tuple[str, str, type], ...] = (
    ("data/api/analyses.ts", "CreateAnalysisInput", CreateAnalysisRequest),
    ("data/api/me.ts", "UpdateMeInput", UpdateMeRequest),
    ("data/api/scores.ts", "TranscribedScoreInput", CreateScoreRequest),
    ("data/api/scores.ts", "HandEnteredScoreInput", CreateScoreRequest),
    ("data/api/scores.ts", "AttachScorePagesInput", AttachScorePagesRequest),
    ("data/api/scores.ts", "UpdateScoreInput", UpdateScoreRequest),
    ("data/api/scores.ts", "ImportScoreInput", ImportScoreRequest),
    # Not in `data/api/`: `postCorrections` takes the element type from
    # `data/types.ts` and wraps it itself. The wrapper is covered below.
    ("data/types.ts", "CorrectionInput", Correction),
)

#: Models that forbid extras and have no interface of their own, with why.
#:
#: **Both directions**, the doctrine `NOT_WIRED` was given after an exclusion
#: list rotted: an entry naming a model that no longer forbids extras fails,
#: and so does one that has since gained a pair above.
NO_CLIENT_INTERFACE: dict[str, str] = {
    "CalibrationRequest": (
        "POST /v1/calibration has no client at all — the one entry in "
        "`test_client_reachability.NOT_WIRED`. A field check against nothing "
        "would pass for ever and say nothing."
    ),
    "CreateCorrectionsRequest": (
        "A one-field wrapper, `{corrections: [...]}`, which `postCorrections` "
        "writes as a literal rather than through an interface. Its element "
        "type is `CorrectionInput`, which is paired above — and the wrapper "
        "itself is asserted separately, because one literal key is exactly "
        "the sort of thing that gets renamed."
    ),
}

#: `class Name(BaseModel):` … then the **assignment** that forbids extras.
#:
#: **Matched as an assignment, not as text in the body**, and that is a
#: correction rather than fastidiousness. The first version searched the whole
#: class body for the string, which `score_schema._Strict` contains — in a
#: docstring, arguing at length for why it sets `extra="ignore"` instead,
#: because forbidding "cost whole pages". A scan that reads prose as code
#: reported the one model that deliberately does the opposite.
_CLASS = re.compile(r"^class\s+(\w+)\s*\([^)]*BaseModel[^)]*\):", re.M)
_FORBIDS = re.compile(r'^\s*model_config\s*=\s*ConfigDict\([^)]*extra="forbid"', re.M)


def _models_that_forbid_extras() -> set[str]:
    found: set[str] = set()
    for path in sorted(BACKEND_APP.rglob("*.py")):
        if "tests" in path.parts:
            continue
        text = path.read_text()
        starts = [(m.start(), m.group(1)) for m in _CLASS.finditer(text)]
        for index, (at, name) in enumerate(starts):
            end = starts[index + 1][0] if index + 1 < len(starts) else len(text)
            if _FORBIDS.search(text[at:end]):
                found.add(name)
    return found


def _interface_fields(relative: str, name: str) -> dict[str, bool]:
    """Field name → whether the app declares it optional (`?:`).

    Brace-matched rather than line-counted, and comments stripped first: these
    interfaces carry long docstrings, and `//` inside one would otherwise be
    read as a field.
    """
    source = (MOBILE_SRC / relative).read_text()
    start = source.index(f"interface {name} {{")
    opening = source.index("{", start)
    depth, end = 0, opening
    while end < len(source):
        if source[end] == "{":
            depth += 1
        elif source[end] == "}":
            depth -= 1
            if depth == 0:
                break
        end += 1
    body = source[opening : end + 1]
    body = re.sub(r"/\*.*?\*/", "", body, flags=re.S)
    body = re.sub(r"//.*", "", body)
    return {m.group(1): m.group(2) == "?" for m in re.finditer(r"^\s*(\w+)(\??):", body, re.M)}


@pytest.mark.parametrize(
    "relative,interface,model", PAIRS, ids=[name for _, name, _ in PAIRS]
)
def test_the_app_sends_no_field_the_endpoint_would_refuse(
    relative: str, interface: str, model: type
) -> None:
    """One unknown key is a 422 on every request, not a degraded feature."""
    declared = _interface_fields(relative, interface)

    unknown = sorted(field for field in declared if field not in model.model_fields)

    assert not unknown, (
        f"{interface} declares {unknown}, which {model.__name__} does not have. "
        f"It forbids extras, so every request carrying one is refused."
    )


@pytest.mark.parametrize(
    "relative,interface,model", PAIRS, ids=[name for _, name, _ in PAIRS]
)
def test_the_app_declares_every_field_the_endpoint_requires(
    relative: str, interface: str, model: type
) -> None:
    """And declares it as required, not optional.

    A required server field the app marks `?:` typechecks, compiles, and 422s
    at run time on whichever call site left it out — which is the same failure
    as not having it at all, arriving later and further from the cause.
    """
    declared = _interface_fields(relative, interface)
    required = sorted(
        name for name, field in model.model_fields.items() if field.is_required()
    )

    missing = sorted(name for name in required if name not in declared)
    optional = sorted(name for name in required if declared.get(name) is True)

    assert not missing, (
        f"{model.__name__} requires {missing}; {interface} does not declare them"
    )
    assert not optional, (
        f"{model.__name__} requires {optional}; {interface} marks them optional"
    )


def test_the_corrections_wrapper_key_is_the_one_the_client_writes() -> None:
    """The one body in the app built as a literal rather than from a type.

    `postCorrections` writes `{ corrections }` by hand, so nothing above can
    see it. One key, and renaming either side is a 422 on every correction a
    musician sends — on the endpoint whose own docstring calls itself the only
    route out of Batch 3's untuned thresholds.
    """
    from app.routers.corrections import CreateCorrectionsRequest

    source = (MOBILE_SRC / "data" / "api" / "corrections.ts").read_text()
    keys = set(re.findall(r"body:\s*JSON\.stringify\(\{\s*(\w+)", source))

    assert keys == set(CreateCorrectionsRequest.model_fields), (
        f"the client sends {sorted(keys)}; the endpoint declares "
        f"{sorted(CreateCorrectionsRequest.model_fields)}"
    )


def test_every_model_that_forbids_extras_is_paired_or_excused() -> None:
    """The anti-rot half.

    A new request model with `extra="forbid"` and a new client interface is
    exactly the change this file exists for, and it would arrive with nothing
    comparing the two. Discovery is by source scan rather than a hand-written
    list, so the list cannot be the thing that goes stale.
    """
    paired = {model.__name__ for _, _, model in PAIRS}

    unpaired = sorted(
        name
        for name in _models_that_forbid_extras()
        if name not in paired and name not in NO_CLIENT_INTERFACE
    )

    assert not unpaired, (
        "these forbid extra fields and nothing compares them with a client: "
        + ", ".join(unpaired)
        + ". Add a row to PAIRS, or an entry to NO_CLIENT_INTERFACE saying why "
        "there is nothing to compare."
    )


def test_no_excuse_outlives_its_reason() -> None:
    """An entry for a model that no longer forbids extras, or that has since
    been paired, is a reason nobody re-read — which is what
    `fixtures/timeline/parity.json`'s exclusion list was."""
    forbidding = _models_that_forbid_extras()
    paired = {model.__name__ for _, _, model in PAIRS}

    gone = sorted(name for name in NO_CLIENT_INTERFACE if name not in forbidding)
    both = sorted(name for name in NO_CLIENT_INTERFACE if name in paired)

    assert not gone, f"nothing forbids extras under these names any more: {gone}"
    assert not both, f"these are excused and also paired: {both}"

#: (TypeScript interface in `data/types.ts`, the model that fills it).
#:
#: Every one of these is a *response*, so the direction that matters is the
#: reverse of the request pairs above: a field the **app** declares and the
#: server does not send arrives as `undefined`. The other way round — a server
#: field the app ignores — is ordinary and there are four of them today
#: (`page_count`, `page_image_retained_at`, `from_measure`, `skip_long_rests`).
RESPONSE_PAIRS: tuple[tuple[str, type], ...] = (
    ("MeResponse", MeResponse),
    ("UsageResponse", UsageResponse),
    ("ScoreResponse", ScoreResponse),
    ("AnalysisResponse", AnalysisResponse),
    ("UploadResponse", UploadResponse),
)


@pytest.mark.parametrize(
    "interface,model", RESPONSE_PAIRS, ids=[name for name, _ in RESPONSE_PAIRS]
)
def test_the_app_reads_no_field_the_endpoint_never_sends(
    interface: str, model: type
) -> None:
    """The silent half.

    A request the server refuses answers 422 and something breaks visibly. A
    response field that stopped being sent answers `undefined`, and the
    adapters have fallbacks — `transcription_status ?? 'done'` is one — so the
    app carries on and is confidently wrong about every piece in the library.

    Measured before this existed: renaming that one field passed the entire
    backend suite and the entire mobile suite.
    """
    declared = _interface_fields("data/types.ts", interface)

    ghosts = sorted(field for field in declared if field not in model.model_fields)

    assert not ghosts, (
        f"{interface} reads {ghosts}, which {model.__name__} does not send. "
        "The app sees undefined and its fallback answers for it."
    )


def test_the_create_analysis_reply_is_read_under_the_names_it_is_sent_under() -> None:
    """The one reply the app types inline rather than in `data/types.ts`.

    `createAnalysis` declares its own `{ analysis_id, status }`, so the pairs
    above cannot see it — and it is the reply that carries the id every poll
    of a take is made against. Read as text for the same reason
    `describeError.test.ts` reads sentences out of `client.ts`.
    """
    from app.routers.analyses import CreateAnalysisResponse

    source = (MOBILE_SRC / "data" / "api" / "analyses.ts").read_text()
    inline = re.search(
        r"createAnalysis\([^)]*\):\s*Promise<\{(?P<body>[^}]*)\}>", source, re.S
    )
    assert inline, "createAnalysis no longer declares its reply inline"

    read = {m.group(1) for m in re.finditer(r"(\w+)\s*:", inline.group("body"))}

    assert read <= set(CreateAnalysisResponse.model_fields), (
        f"the app reads {sorted(read)}; the endpoint sends "
        f"{sorted(CreateAnalysisResponse.model_fields)}"
    )

#: The objects *inside* a body, which no route declares and both trees read.
#:
#: **Two of these travel in both directions and the schema forgives extras.**
#: `score_json` goes out on every `ScoreResponse` and comes back on
#: `UpdateScoreRequest` when the bar editor saves a correction, and `ScoreJson`
#: sets `extra="ignore"` — deliberately, and for a good reason recorded in its
#: own docstring: forbidding cost whole pages, because one unexpected key from
#: a model that noticed something the schema cannot hold failed the entire
#: score. The cost of that kindness is this: a field the app writes and the
#: server does not declare is **dropped in silence**, so a correction a
#: musician made never persists and the screen shows it saved.
#:
#: The verdict half is looser still. `AnalysisResponse.result_json` is typed
#: `dict[str, Any]` on purpose — `data/types.ts` says a second copy of that
#: schema would go stale silently — but the *producer* is four Pydantic models,
#: so the comparison is available even though the transport does not make it.
#: The app reads nine keys out of `per_measure` alone; rename one and every bar
#: on the verdict screen reads as undefined.
NESTED_PAIRS: tuple[tuple[str, type], ...] = (
    ("ScoreNote", Note),
    ("ScoreMeasure", Measure),
    ("ScoreRepeat", Repeat),
    ("ScoreJson", ScoreJson),
    ("MeasureConcern", MeasureConcern),
    ("PerNoteResult", PerNote),
    ("PerMeasureResult", PerMeasure),
    ("Tolerance", Tolerance),
    ("AnalysisResultJson", AnalysisResult),
)


@pytest.mark.parametrize(
    "interface,model", NESTED_PAIRS, ids=[name for name, _ in NESTED_PAIRS]
)
def test_the_app_reads_no_nested_field_that_is_never_written(
    interface: str, model: type
) -> None:
    """The same direction as the response pairs, one level in.

    Measured when this went in: not one ghost field across nine objects. What
    the server writes and the app ignores is ordinary and there are five —
    `Measure.system` and `PerNote.timed` are layout and bookkeeping, and
    `Repeat.start_inferred` with `ScoreJson.unclosed_repeat_starts` are the two
    facts that carry across a page join and are read by nothing on a screen.
    """
    declared = _interface_fields("data/types.ts", interface)

    ghosts = sorted(field for field in declared if field not in model.model_fields)

    assert not ghosts, (
        f"{interface} reads {ghosts}; {model.__name__} has no such field. "
        "Going out that is `undefined`; coming back on a corrected score it is "
        "dropped, and the correction never persists."
    )

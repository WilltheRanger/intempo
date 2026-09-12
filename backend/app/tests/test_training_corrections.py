"""Keeping what a musician fixed — the rules, and the two paths that use them.

Every scan this app has read has been corrected by a person and then thrown
away: the corrected bar overwrites the misread one and keeps nothing about what
it replaced, and accepting deletes the photograph. The pair (what the reader
said, what it should have said) is the asset that cannot be bought, and it was
being destroyed at the moment it was created.

The rules live in `services/training.py` so they can be tested without a
database, which is most of this file. The rest exercises the two request paths
that act on them, because the rule being right and the handler calling it are
different claims.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, call
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app import db as db_module
from app.main import app
from app.routers import scores as scores_module
from app.services import display_urls
from app.services.page_image import display_key_for
from app.services.score_schema import Measure, Note, ScoreJson
from app.services.training import (
    Correction,
    corrections_between,
    may_keep_corrections,
    rows_for,
)
from app.tests.fake_supabase import FakeSupabase


# --- consent, which fails closed -------------------------------------------


@pytest.mark.parametrize(
    "row",
    [
        None,
        {},
        {"training_consent_at": None},
        {"training_consent_at": ""},
        # A database without 013 has no such key at all, which is the shape
        # this will actually meet first.
        {"email": "a@b.c"},
        # Not a row.
        "yes",
        42,
        [],
    ],
)
def test_anything_short_of_a_timestamp_is_not_consent(row: Any) -> None:
    """**The opposite default from `shouldOnboard`, deliberately.**

    A missing onboarding answer opens the app, because guessing wrong there
    costs one screen shown twice. Guessing wrong here keeps a person's
    photographs without being told to, so every uncertainty is a no.
    """
    assert may_keep_corrections(row) is False


def test_a_timestamp_is_consent_whatever_shape_the_driver_returns_it_in() -> None:
    """String or datetime — the driver decides, and this must not care."""
    from datetime import datetime, timezone

    assert may_keep_corrections({"training_consent_at": "2026-08-29T10:00:00Z"})
    assert may_keep_corrections({"training_consent_at": datetime.now(timezone.utc)})


# --- what changed ----------------------------------------------------------


def _measure(number: int, *pitches: str, duration: str = "quarter") -> Measure:
    return Measure(
        measure_number=number,
        notes=[Note(pitch=p, duration=duration) for p in pitches],
    )


def _score(*measures: Measure, **fields: Any) -> ScoreJson:
    return ScoreJson(
        time_signature=fields.pop("time_signature", "4/4"),
        key_signature=fields.pop("key_signature", "C major"),
        clef=fields.pop("clef", "treble"),
        measures=list(measures),
        ocr_confidence=fields.pop("ocr_confidence", 0.9),
        **fields,
    )


def test_saving_a_score_back_unchanged_is_not_a_correction() -> None:
    """The ordinary case, and the one that decides whether this is usable.

    Renaming a piece, favouriting it, or an app that saves the whole score on
    every screen all reach the same endpoint. A corpus where most rows say
    nothing changed is worse than no corpus, because the noise is
    indistinguishable from the signal without re-deriving the diff.
    """
    score = _score(_measure(1, "C4", "D4"), _measure(2, "E4"))
    assert corrections_between(score, score) == []


def test_a_rewritten_bar_is_one_correction_naming_that_bar() -> None:
    before = _score(_measure(1, "C4", "D4"), _measure(2, "E4"))
    after = _score(_measure(1, "C4", "D#4"), _measure(2, "E4"))

    (correction,) = corrections_between(before, after)
    assert correction.measure_number == 1
    assert [n["pitch"] for n in correction.before["notes"]] == ["C4", "D4"]
    assert [n["pitch"] for n in correction.after["notes"]] == ["C4", "D#4"]
    assert "pitches" in correction.summary


def test_a_bar_the_reader_missed_has_no_before() -> None:
    """**The interesting case, and the reason neither side is NOT NULL.**

    Writing an empty measure instead would say the reader emitted a bar with no
    notes in it, which is a different mistake with a different fix.
    """
    before = _score(_measure(1, "C4"))
    after = _score(_measure(1, "C4"), _measure(2, "E4"))

    (correction,) = corrections_between(before, after)
    assert correction.measure_number == 2
    assert correction.before is None
    assert correction.after is not None
    assert "missing from the reading" in correction.summary


def test_a_bar_the_reader_invented_has_no_after() -> None:
    """A rehearsal mark counted as a measure, which this pipeline has done."""
    before = _score(_measure(1, "C4"), _measure(2, "E4"))
    after = _score(_measure(1, "C4"))

    (correction,) = corrections_between(before, after)
    assert correction.measure_number == 2
    assert correction.after is None
    assert "not in the music" in correction.summary


def test_an_inserted_bar_does_not_report_the_rest_of_the_page_as_corrected() -> None:
    """**Matched by number, not position.**

    Inserting a bar shifts every index after it. Diffing by position would call
    the whole rest of the page a correction, which is both a lie about what the
    musician did and a flood of rows that would drown the real one.
    """
    before = _score(_measure(1, "C4"), _measure(2, "D4"), _measure(3, "E4"))
    after = _score(_measure(1, "C4"), _measure(2, "D4"), _measure(3, "E4"), _measure(4, "F4"))

    corrections = corrections_between(before, after)
    assert [c.measure_number for c in corrections] == [4]


def test_a_clef_correction_names_no_bar() -> None:
    """A misread clef is the most damaging pitch error there is, and it belongs
    to the page rather than to any measure."""
    before = _score(_measure(1, "C4"), clef="treble")
    after = _score(_measure(1, "C4"), clef="bass")

    (correction,) = corrections_between(before, after)
    assert correction.measure_number is None
    assert correction.before == {"clef": "treble"}
    assert correction.after == {"clef": "bass"}


def test_the_readers_own_commentary_is_not_a_correction() -> None:
    """`ocr_confidence` and `notes_to_human` are the reader talking about
    itself. They change on every re-read and are claims about nothing on the
    page, so a change to one is not something a musician corrected."""
    before = _score(_measure(1, "C4"), ocr_confidence=0.2, notes_to_human="unsure")
    after = _score(_measure(1, "C4"), ocr_confidence=0.9, notes_to_human="")
    assert corrections_between(before, after) == []


def test_the_row_carries_the_reader_that_made_the_mistake() -> None:
    rows = rows_for(
        [Correction(measure_number=3, before={"a": 1}, after={"a": 2}, summary="x")],
        user_id="u",
        score_id="s",
        reader="homr",
        page_image_key="u/page.png",
    )
    assert rows == [
        {
            "user_id": "u",
            "score_id": "s",
            "measure_number": 3,
            "before": {"a": 1},
            "after": {"a": 2},
            "reader": "homr",
            "page_image_key": "u/page.png",
        }
    ]


# --- the paths that use them ------------------------------------------------


USER = "11111111-1111-1111-1111-111111111111"
SCORE = "22222222-2222-2222-2222-222222222222"
PAGE = f"{USER}/page-one.png"
PAGE_URL = (
    f"https://proj.supabase.co/storage/v1/object/sign/score-images/{PAGE}?token=t"
)


def _reading(*pitches: str) -> dict[str, Any]:
    return _score(_measure(1, *pitches)).model_dump(mode="json")


@pytest.fixture()
def db(monkeypatch: pytest.MonkeyPatch) -> FakeSupabase:
    fake = FakeSupabase()
    fake.seed(
        "scores",
        [
            {
                "id": SCORE,
                "user_id": USER,
                "title": "Study",
                "score_json": _reading("C4", "D4"),
                "source_image_url": PAGE_URL,
                "source_image_urls": [PAGE_URL],
                "transcription_status": "done",
                "transcription_reader": "homr",
                "transcription_accepted_at": None,
                "page_image_discarded_at": None,
                "page_image_retained_at": None,
                "ocr_confidence": 0.9,
                "created_at": "2026-08-29T00:00:00Z",
                "updated_at": "2026-08-29T00:00:00Z",
            }
        ],
    )
    fake.storage = MagicMock()
    monkeypatch.setattr(db_module, "get_service_client", lambda: fake)
    display_urls.reset_cache()
    return fake


def _consenting(db: FakeSupabase, yes: bool) -> None:
    db.seed(
        "users",
        [
            {
                "id": USER,
                "email": "player@example.com",
                "tier": "free",
                "role": "student",
                "training_consent_at": "2026-08-29T09:00:00Z" if yes else None,
            }
        ],
    )


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def _patch_score(client: TestClient, token: str, body: dict[str, Any]):
    return client.patch(
        f"/v1/scores/{SCORE}", json=body, headers={"Authorization": f"Bearer {token}"}
    )


def test_a_correction_is_kept_when_the_musician_agreed(
    db: FakeSupabase, client: TestClient, make_token
) -> None:
    _consenting(db, True)
    response = _patch_score(
        client, make_token(sub=USER), {"score_json": _reading("C4", "D#4")}
    )
    assert response.status_code == 200

    (row,) = db.table("training_corrections").rows
    assert row["score_id"] == SCORE
    assert row["user_id"] == USER
    assert row["measure_number"] == 1
    assert row["reader"] == "homr"
    # The page it was read from, as a key rather than a signed URL — a URL
    # expires, so storing one stores something that stops working.
    assert row["page_image_key"] == PAGE
    assert [n["pitch"] for n in row["before"]["notes"]] == ["C4", "D4"]
    assert [n["pitch"] for n in row["after"]["notes"]] == ["C4", "D#4"]


def test_nothing_is_kept_without_consent(
    db: FakeSupabase, client: TestClient, make_token
) -> None:
    """The default, and it has to be a real no rather than an empty table that
    happens to have nothing in it yet."""
    _consenting(db, False)
    assert (
        _patch_score(
            client, make_token(sub=USER), {"score_json": _reading("C4", "D#4")}
        ).status_code
        == 200
    )
    assert db.table("training_corrections").rows == []


def test_a_save_that_changes_nothing_writes_no_correction(
    db: FakeSupabase, client: TestClient, make_token
) -> None:
    _consenting(db, True)
    assert (
        _patch_score(
            client, make_token(sub=USER), {"score_json": _reading("C4", "D4")}
        ).status_code
        == 200
    )
    assert db.table("training_corrections").rows == []


def test_a_rename_is_not_a_correction(
    db: FakeSupabase, client: TestClient, make_token
) -> None:
    _consenting(db, True)
    assert (
        _patch_score(client, make_token(sub=USER), {"title": "New name"}).status_code
        == 200
    )
    assert db.table("training_corrections").rows == []


def test_the_save_still_succeeds_when_the_correction_cannot_be_written(
    db: FakeSupabase, client: TestClient, make_token, monkeypatch
) -> None:
    """**The musician asked for their bar to be stored, and it has been.**

    Losing a training row costs something nobody was promised. Failing the save
    to record one would cost the thing they actually asked for.
    """
    _consenting(db, True)
    monkeypatch.setattr(
        scores_module,
        "rows_for",
        MagicMock(side_effect=RuntimeError("no such table")),
    )
    response = _patch_score(
        client, make_token(sub=USER), {"score_json": _reading("C4", "D#4")}
    )
    assert response.status_code == 200
    assert [n["pitch"] for n in db.table("scores").rows[0]["score_json"]["measures"][0]["notes"]] == [
        "C4",
        "D#4",
    ]


# --- accepting -------------------------------------------------------------


def _accept(client: TestClient, token: str):
    return client.post(
        f"/v1/scores/{SCORE}/accept", headers={"Authorization": f"Bearer {token}"}
    )


def test_accepting_still_discards_the_photograph_without_consent(
    db: FakeSupabase, client: TestClient, make_token
) -> None:
    """007's behaviour, unchanged. No consent and nothing about this differs."""
    _consenting(db, False)
    assert _accept(client, make_token(sub=USER)).status_code == 200

    row = db.table("scores").rows[0]
    assert row["page_image_discarded_at"] is not None
    assert row["page_image_retained_at"] is None
    assert row["source_image_url"] is None
    # Two calls, not one: the photograph, then its display copy. A musician
    # withdrawing consent has not agreed to a 1568px version of the page
    # staying in the bucket, and the derivative is deleted separately so a page
    # that never had one (every scan before `store_display_copy`) cannot make
    # the discard report failure.
    # Both objects, in whichever order the path takes them: a page that has
    # been read is two objects, and a musician who did not consent to their
    # photograph being kept did not consent to a 1568px copy of it either.
    assert sorted(
        c.args[0][0] for c in db.storage.from_.return_value.remove.call_args_list
    ) == sorted([PAGE, display_key_for(PAGE)])


def test_accepting_keeps_the_photograph_when_the_musician_agreed(
    db: FakeSupabase, client: TestClient, make_token
) -> None:
    _consenting(db, True)
    assert _accept(client, make_token(sub=USER)).status_code == 200

    row = db.table("scores").rows[0]
    assert row["transcription_accepted_at"] is not None
    assert row["page_image_retained_at"] is not None
    assert row["page_image_discarded_at"] is None
    assert row["source_image_url"] == PAGE_URL
    db.storage.from_.return_value.remove.assert_not_called()


def test_a_kept_photograph_is_distinguishable_from_a_delete_that_failed(
    db: FakeSupabase, client: TestClient, make_token
) -> None:
    """**The reason `page_image_retained_at` exists at all.**

    Both states are an accepted row whose photograph is still in the bucket, and
    they want opposite things done about them: one is finished, the other needs
    retrying.
    """
    _consenting(db, False)
    db.storage.from_.return_value.remove.side_effect = RuntimeError("storage down")
    assert _accept(client, make_token(sub=USER)).status_code == 200

    row = db.table("scores").rows[0]
    assert row["page_image_discarded_at"] is None
    assert row["page_image_retained_at"] is None
    assert row["source_image_url"] == PAGE_URL


# --- consent, granted and taken back ---------------------------------------


def _patch_me(client: TestClient, token: str, body: dict[str, Any]):
    return client.patch(
        "/v1/me", json=body, headers={"Authorization": f"Bearer {token}"}
    )


def test_agreeing_records_when(db: FakeSupabase, client: TestClient, make_token) -> None:
    _consenting(db, False)
    response = _patch_me(client, make_token(sub=USER), {"training_consent": True})

    assert response.status_code == 200
    assert response.json()["training_consent"] is True
    assert db.table("users").rows[0]["training_consent_at"] is not None


def test_agreeing_again_keeps_the_original_timestamp(
    db: FakeSupabase, client: TestClient, make_token
) -> None:
    """**A consent record answers "when did they agree to this".**

    Re-stamping it every time a screen saves its own state back would make the
    answer the date of the last save, which is exactly the question it cannot
    then answer once the wording changes.
    """
    _consenting(db, True)
    original = db.table("users").rows[0]["training_consent_at"]

    response = _patch_me(client, make_token(sub=USER), {"training_consent": True})
    assert response.status_code == 200
    assert db.table("users").rows[0]["training_consent_at"] == original


def test_withdrawing_deletes_the_corrections_and_the_photographs(
    db: FakeSupabase, client: TestClient, make_token
) -> None:
    """**The only part of this feature that has to actually work.**

    Failing to record a correction costs a row nobody was promised. A switch
    that turns off while the data it authorised stays is not a withdrawal, it is
    a cosmetic control over somebody's photographs.
    """
    _consenting(db, True)
    db.table("scores").rows[0]["page_image_retained_at"] = "2026-08-29T10:00:00Z"
    db.seed(
        "training_corrections",
        [{"id": str(uuid4()), "user_id": USER, "score_id": SCORE, "measure_number": 1}],
    )

    response = _patch_me(client, make_token(sub=USER), {"training_consent": False})
    assert response.status_code == 200
    assert response.json()["training_consent"] is False

    assert db.table("users").rows[0]["training_consent_at"] is None
    assert db.table("training_corrections").rows == []

    row = db.table("scores").rows[0]
    # Two calls, not one: the photograph, then its display copy. A musician
    # withdrawing consent has not agreed to a 1568px version of the page
    # staying in the bucket, and the derivative is deleted separately so a page
    # that never had one (every scan before `store_display_copy`) cannot make
    # the discard report failure.
    assert db.storage.from_.return_value.remove.call_args_list == [
        call([PAGE]),
        call([display_key_for(PAGE)]),
    ]
    assert row["page_image_retained_at"] is None
    assert row["page_image_discarded_at"] is not None
    assert row["source_image_url"] is None


def test_withdrawing_leaves_a_photograph_storage_would_not_delete_findable(
    db: FakeSupabase, client: TestClient, make_token
) -> None:
    """Storage refusing must not produce a row claiming the file is gone.

    The request still succeeds — the switch is off and the corrections are
    deleted — and `page_image_retained_at` stays set, so a later attempt can
    still find the photograph. A row saying "discarded" over a file still in the
    bucket is the one outcome that makes it unreachable forever.
    """
    _consenting(db, True)
    db.table("scores").rows[0]["page_image_retained_at"] = "2026-08-29T10:00:00Z"
    db.storage.from_.return_value.remove.side_effect = RuntimeError("storage down")

    assert (
        _patch_me(client, make_token(sub=USER), {"training_consent": False}).status_code
        == 200
    )
    row = db.table("scores").rows[0]
    assert row["page_image_retained_at"] == "2026-08-29T10:00:00Z"
    assert row["page_image_discarded_at"] is None
    assert row["source_image_url"] == PAGE_URL


def test_withdrawing_when_never_consenting_deletes_nothing(
    db: FakeSupabase, client: TestClient, make_token
) -> None:
    """A switch already off, turned off. Not an error, and not a reason to go
    looking through somebody's scores for photographs to delete."""
    _consenting(db, False)
    assert (
        _patch_me(client, make_token(sub=USER), {"training_consent": False}).status_code
        == 200
    )
    db.storage.from_.return_value.remove.assert_not_called()
    assert db.table("scores").rows[0]["source_image_url"] == PAGE_URL

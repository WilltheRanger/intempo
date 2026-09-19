"""Tests for /v1/analyses — enqueue, poll, the worker, and the sweeper."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app import db as db_module
from app.main import app
from app.routers import analyses as analyses_module
from app.tests.audio_helpers import evenly_spaced, synth_click_track
from app.tests.fake_supabase import FakeSupabase
from app.workers import analysis_runner, dispatch
from app.workers.analysis_runner import sweep_stuck_analyses

PROJECT_HOST = "https://test.supabase.invalid"

GOOD_SCORE_JSON = {
    "clef": "treble",
    "time_signature": "4/4",
    "key_signature": None,
    "tempo_marking": None,
    "bpm_hint": None,
    "measures": [
        {"measure_number": 1, "notes": [{"pitch": "A4", "duration": "quarter"}] * 4, "slurs": []},
        {"measure_number": 2, "notes": [{"pitch": "A4", "duration": "quarter"}] * 4, "slurs": []},
    ],
    "repeats": [],
    "ocr_confidence": 0.9,
    "notes_to_human": "",
}


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def _audio_url(user_id: UUID) -> str:
    # Every real /upload/audio call creates a new object key. A fixed filename
    # makes two independent test takes look like one retried submission now
    # that enqueue correctly deduplicates one uploaded object.
    return (
        f"{PROJECT_HOST}/storage/v1/object/sign/audio-uploads/"
        f"{user_id}/{uuid4()}.wav?token=x"
    )


def _wav_bytes(bpm: float = 120.0, n: int = 8) -> bytes:
    import io

    import soundfile as sf

    y = synth_click_track(evenly_spaced(n, bpm), sr=22050)
    buf = io.BytesIO()
    sf.write(buf, y, 22050, format="WAV")
    return buf.getvalue()


def _install(monkeypatch: pytest.MonkeyPatch, fake: FakeSupabase) -> None:
    # Router and worker must share the SAME fake so the enqueue→run→poll
    # flow is consistent.
    monkeypatch.setattr(db_module, "get_service_client", lambda: fake)
    monkeypatch.setattr(analysis_runner, "get_service_client", lambda: fake)
    # Storage signing itself is covered in test_audio_storage. This fake models
    # database state only, so worker-flow tests keep their supplied readable URL.
    monkeypatch.setattr(
        analysis_runner, "readable_audio_url", lambda _client, reference: reference
    )


# ---- auth / validation ----------------------------------------------------


def test_post_unauthenticated_returns_401(client: TestClient) -> None:
    res = client.post("/v1/analyses", json={
        "score_id": str(uuid4()), "audio_url": "x", "target_bpm": 120, "bpm_source": "manual",
    })
    assert res.status_code == 401


def test_post_rejects_foreign_audio_url(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    fake = FakeSupabase()
    _install(monkeypatch, fake)
    res = client.post(
        "/v1/analyses",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
        json={
            "score_id": str(uuid4()),
            "audio_url": "https://evil.example.com/steal.wav",
            "target_bpm": 120,
            "bpm_source": "manual",
        },
    )
    assert res.status_code == 403


def test_post_unknown_score_returns_404(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    fake = FakeSupabase()  # no score seeded
    _install(monkeypatch, fake)
    monkeypatch.setattr(analysis_runner, "run_analysis", lambda _id: None)
    res = client.post(
        "/v1/analyses",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
        json={
            "score_id": str(uuid4()),
            "audio_url": _audio_url(user_id),
            "target_bpm": 120,
            "bpm_source": "manual",
        },
    )
    assert res.status_code == 404


# ---- enqueue + poll -------------------------------------------------------


def test_post_enqueues_and_returns_202(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    score_id = uuid4()
    fake = FakeSupabase()
    fake.seed("scores", [{"id": str(score_id), "user_id": str(user_id), "score_json": GOOD_SCORE_JSON}])
    _install(monkeypatch, fake)

    # Spy on the background worker instead of running it here.
    called: list[str] = []
    monkeypatch.setattr(
        analyses_module, "start_analysis", lambda aid: called.append(aid)
    )

    res = client.post(
        "/v1/analyses",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
        json={
            "score_id": str(score_id),
            "audio_url": _audio_url(user_id),
            "target_bpm": 120,
            "bpm_source": "manual",
        },
    )
    assert res.status_code == 202
    body = res.json()
    assert body["status"] == "queued"
    assert called == [body["analysis_id"]]  # background task got the new id


def test_audio_key_is_stored_durably_and_retry_is_idempotent(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """A lost POST response must not upload, charge or enqueue the take twice."""
    user_id = uuid4()
    score_id = uuid4()
    fake = FakeSupabase()
    fake.seed(
        "scores",
        [{"id": str(score_id), "user_id": str(user_id), "score_json": GOOD_SCORE_JSON}],
    )
    _install(monkeypatch, fake)
    called: list[str] = []
    monkeypatch.setattr(
        analyses_module, "start_analysis", lambda aid: called.append(aid)
    )
    headers = {"Authorization": f"Bearer {make_token(sub=user_id)}"}
    body = {
        "score_id": str(score_id),
        "audio_key": f"{user_id}/take.wav",
        "target_bpm": 120,
        "bpm_source": "manual",
    }

    first = client.post("/v1/analyses", headers=headers, json=body)
    second = client.post("/v1/analyses", headers=headers, json=body)

    assert first.status_code == second.status_code == 202
    assert first.json()["analysis_id"] == second.json()["analysis_id"]
    assert len(fake.table("analyses").rows) == 1
    stored = fake.table("analyses").rows[0]["audio_url"]
    assert f"/object/authenticated/audio-uploads/{user_id}/take.wav" in stored
    assert "token=" not in stored
    assert called == [first.json()["analysis_id"]]


def test_post_rejects_another_accounts_audio_key(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    fake = FakeSupabase()
    _install(monkeypatch, fake)

    res = client.post(
        "/v1/analyses",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
        json={
            "score_id": str(uuid4()),
            "audio_key": f"{uuid4()}/take.wav",
            "target_bpm": 120,
            "bpm_source": "manual",
        },
    )

    assert res.status_code == 403


def test_full_flow_queued_to_done(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    score_id = uuid4()
    fake = FakeSupabase()
    fake.seed("scores", [{"id": str(score_id), "user_id": str(user_id), "score_json": GOOD_SCORE_JSON}])
    _install(monkeypatch, fake)
    # Real worker runs, on `dispatch`'s pool; only stub the storage fetch so
    # the real pipeline analyzes real audio. `_analysed()` below is what waits
    # for it — see that helper for why the wait is now explicit.
    monkeypatch.setattr(analysis_runner, "download_audio", lambda _url: _wav_bytes())

    # The object the take was uploaded to, so the end of this flow has
    # something real to delete. Seeded rather than assumed: the last thing
    # `run_analysis` does is swap this WAV for an Opus, and until the fake
    # modelled storage that call raised `AttributeError` into the worker
    # pool's catch-all and this test passed anyway.
    audio_url = _audio_url(user_id)
    wav_key = f"{user_id}/{audio_url.rsplit('/', 1)[1].split('?')[0]}"
    fake.put_object("audio-uploads", wav_key, _wav_bytes())

    token = make_token(sub=user_id)
    post = client.post(
        "/v1/analyses",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "score_id": str(score_id),
            "audio_url": audio_url,
            "target_bpm": 120,
            "bpm_source": "manual",
        },
    )
    assert post.status_code == 202
    analysis_id = post.json()["analysis_id"]
    _analysed()

    got = client.get(f"/v1/analyses/{analysis_id}", headers={"Authorization": f"Bearer {token}"})
    assert got.status_code == 200
    body = got.json()
    assert body["status"] == "done"
    assert body["result_json"]["status"] == "ok"
    assert body["alignment_quality"] is not None
    assert body["finished_at"] is not None

    # And the take now costs a fraction of what it did. This is the only test
    # that reaches `keep_playback_copy` through the worker rather than calling
    # it directly, so it is the only one that can show the verdict and the
    # archiving are one path: the WAV is gone, the Opus is beside it, and the
    # row names the Opus.
    opus_key = f"{wav_key.removesuffix('.wav')}.opus"
    assert fake.object_keys("audio-uploads") == {opus_key}
    assert fake.table("analyses").rows[0]["playback_key"] == opus_key


def test_worker_marks_failed_when_audio_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    user_id, score_id = uuid4(), uuid4()
    fake = FakeSupabase()
    fake.seed("scores", [{"id": str(score_id), "user_id": str(user_id), "score_json": GOOD_SCORE_JSON}])
    analysis_id = str(uuid4())
    fake.seed("analyses", [{
        "id": analysis_id, "user_id": str(user_id), "score_id": str(score_id),
        "audio_url": _audio_url(user_id), "target_bpm": 120, "bpm_source": "manual",
        "status": "queued",
    }])
    monkeypatch.setattr(analysis_runner, "get_service_client", lambda: fake)

    def _boom(_url):
        raise analysis_runner.AudioFetchError("gone")

    monkeypatch.setattr(analysis_runner, "download_audio", _boom)

    analysis_runner.run_analysis(analysis_id)

    row = fake.table("analyses").rows[0]
    assert row["status"] == "failed"
    assert row["failure_reason"] == "audio_unavailable"


def test_get_unknown_analysis_returns_404(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    fake = FakeSupabase()
    _install(monkeypatch, fake)
    res = client.get(
        f"/v1/analyses/{uuid4()}",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 404


# ---- list ------------------------------------------------------------------


def _analysis_row(user_id: UUID, score_id: UUID, **over: Any) -> dict:
    now = datetime.now(tz=timezone.utc).isoformat()
    row = {
        "id": str(uuid4()),
        "user_id": str(user_id),
        "score_id": str(score_id),
        "audio_url": _audio_url(user_id),
        "status": "done",
        "target_bpm": 96.0,
        "bpm_source": "manual",
        "metronome_mode": "off",
        "result_json": {"verdict": {"text": "Steady"}},
        "alignment_quality": 0.9,
        "created_at": now,
        "updated_at": now,
        "finished_at": now,
    }
    row.update(over)
    return row


def test_recording_playback_is_private_and_short_lived(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    mine, theirs = uuid4(), uuid4()
    mine_row = _analysis_row(mine, uuid4())
    their_row = _analysis_row(theirs, uuid4())
    fake = FakeSupabase()
    fake.seed("analyses", [mine_row, their_row])
    _install(monkeypatch, fake)
    seen: list[str] = []

    def _sign(_client: Any, reference: str) -> str:
        seen.append(reference)
        return "https://storage.test/signed/take.wav?token=short-lived"

    monkeypatch.setattr(analyses_module, "readable_audio_url", _sign)
    headers = {"Authorization": f"Bearer {make_token(sub=mine)}"}

    response = client.get(
        f"/v1/analyses/{mine_row['id']}/recording", headers=headers
    )
    assert response.status_code == 200
    assert response.json() == {
        "url": "https://storage.test/signed/take.wav?token=short-lived",
        "expires_in": analyses_module.SIGNED_AUDIO_DOWNLOAD_TTL_SECONDS,
    }
    assert response.headers["cache-control"] == "private, no-store"
    assert seen == [mine_row["audio_url"]]

    # The same response covers an unknown id and another musician's id. The
    # endpoint must not reveal that the latter recording exists.
    hidden = client.get(
        f"/v1/analyses/{their_row['id']}/recording", headers=headers
    )
    assert hidden.status_code == 404
    assert len(seen) == 1

    # A row scoped to this account but pointing at somebody else's storage is
    # corrupt data, not permission to sign that object.
    corrupt = _analysis_row(
        mine,
        uuid4(),
        audio_url=f"{PROJECT_HOST}/storage/v1/object/authenticated/audio-uploads/{theirs}/take.wav",
    )
    fake.table("analyses").rows.append(corrupt)
    refused = client.get(
        f"/v1/analyses/{corrupt['id']}/recording", headers=headers
    )
    assert refused.status_code == 404
    assert len(seen) == 1


def test_recording_playback_requires_a_session(client: TestClient) -> None:
    assert client.get(f"/v1/analyses/{uuid4()}/recording").status_code == 401


def test_recording_playback_reports_a_temporary_storage_failure(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    row = _analysis_row(user_id, uuid4())
    fake = FakeSupabase()
    fake.seed("analyses", [row])
    _install(monkeypatch, fake)

    def _unavailable(_client: Any, _reference: str) -> str:
        raise analyses_module.AudioStorageError("storage is down")

    monkeypatch.setattr(analyses_module, "readable_audio_url", _unavailable)
    response = client.get(
        f"/v1/analyses/{row['id']}/recording",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert response.status_code == 503
    assert response.json()["detail"] == "recording is temporarily unavailable"


def test_a_reclaimed_recording_is_gone_rather_than_temporarily_unavailable(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """A failed take whose WAV the sweep reclaimed a day later.

    `audio_url` still names the upload the row was created from — 018 says at
    length why that column keeps meaning that — so without the mark this falls
    through to signing a key that no longer exists, and a failed signature is
    reported as **503, temporarily** unavailable. It is not temporary: the
    object was deleted on purpose and is never coming back. 404 is what 018
    already names as the answer for a take whose audio is gone, and it is the
    difference between a player that retries forever and one that stops.
    """
    user_id = uuid4()
    row = _analysis_row(
        user_id,
        uuid4(),
        status="failed",
        failure_reason="internal_error",
        audio_reclaimed_at=datetime.now(tz=timezone.utc).isoformat(),
    )
    fake = FakeSupabase()
    fake.seed("analyses", [row])
    _install(monkeypatch, fake)

    def _must_not_sign(_client: Any, _reference: str) -> str:
        raise AssertionError("signed a key the sweep deleted")

    monkeypatch.setattr(analyses_module, "readable_audio_url", _must_not_sign)
    response = client.get(
        f"/v1/analyses/{row['id']}/recording",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "recording not found"


def test_a_judged_take_still_plays_after_its_wav_was_replaced(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The other side of the branch above, which is the one that could break
    playback for every analysed take: `playback_key` names an Opus that is
    really there, and `audio_reclaimed_at` has nothing to say about it."""
    user_id = uuid4()
    row = _analysis_row(user_id, uuid4(), playback_key=f"{user_id}/take.opus")
    fake = FakeSupabase()
    fake.seed("analyses", [row])
    _install(monkeypatch, fake)
    monkeypatch.setattr(
        analyses_module,
        "readable_audio_url",
        lambda _client, reference: f"https://storage.test/{reference}?token=x",
    )

    response = client.get(
        f"/v1/analyses/{row['id']}/recording",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )

    assert response.status_code == 200
    assert response.json()["url"].endswith(f"{user_id}/take.opus?token=x")


def test_list_returns_only_the_callers_analyses(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The owner filter is the whole point — Insights reads this endpoint."""
    mine, theirs = uuid4(), uuid4()
    score = uuid4()
    fake = FakeSupabase()
    fake.seed(
        "analyses",
        [
            _analysis_row(mine, score),
            _analysis_row(mine, score),
            _analysis_row(theirs, uuid4()),
        ],
    )
    _install(monkeypatch, fake)

    res = client.get(
        "/v1/analyses", headers={"Authorization": f"Bearer {make_token(sub=mine)}"}
    )
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 2
    assert {row["user_id"] for row in body} == {str(mine)}


def test_list_filters_by_score_and_status(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    wanted, other = uuid4(), uuid4()
    fake = FakeSupabase()
    fake.seed(
        "analyses",
        [
            _analysis_row(user_id, wanted, status="done"),
            _analysis_row(user_id, wanted, status="queued"),
            _analysis_row(user_id, other, status="done"),
        ],
    )
    _install(monkeypatch, fake)
    headers = {"Authorization": f"Bearer {make_token(sub=user_id)}"}

    by_score = client.get(f"/v1/analyses?score_id={wanted}", headers=headers)
    assert by_score.status_code == 200
    assert len(by_score.json()) == 2

    done_only = client.get(f"/v1/analyses?score_id={wanted}&status=done", headers=headers)
    assert done_only.status_code == 200
    assert [row["status"] for row in done_only.json()] == ["done"]


def test_the_list_carries_the_analysis_by_default(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Insights reads `result_json` off this endpoint, so the default may not
    change without changing that with it."""
    user_id = uuid4()
    fake = FakeSupabase()
    fake.seed("analyses", [_analysis_row(user_id, uuid4(), status="done")])
    _install(monkeypatch, fake)

    res = client.get(
        "/v1/analyses", headers={"Authorization": f"Bearer {make_token(sub=user_id)}"}
    )

    assert res.status_code == 200
    assert res.json()[0]["result_json"] is not None


def test_include_result_false_does_not_fetch_the_analysis(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """**Not fetched, not merely hidden**, and that distinction is the feature.

    `result_json` is by far the largest thing in the row — measured against the
    real response models at **214 bytes per note**, so a 200-note take is 52 KB
    and a page of 200 takes is 10 MB. The app's "when did I last play this" map
    reads two fields out of that on every Library open.

    Dropping the field after Postgres has already sent it would leave the
    expensive half of the transfer exactly where it was; the database read is
    billed too. `FakeSupabase` applies the projection, so a row that still
    carried the field here would mean the narrowing never reached the query.
    """
    user_id = uuid4()
    fake = FakeSupabase()
    fake.seed("analyses", [_analysis_row(user_id, uuid4(), status="done")])
    _install(monkeypatch, fake)

    res = client.get(
        "/v1/analyses?include_result=false",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )

    assert res.status_code == 200
    [row] = res.json()
    assert row["result_json"] is None
    # Everything the caller actually asked for survives — a projection that
    # dropped `created_at` would make the map it feeds silently empty.
    assert row["score_id"] and row["created_at"] and row["status"] == "done"


def test_the_light_projection_names_every_other_field(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """A field added to `AnalysisResponse` and forgotten in the projection
    would come back null from this path and be perfectly valid — which is why
    the column list is derived from the model rather than typed out. This is
    the check that the derivation is complete rather than merely plausible.

    **The row is built from the model, and the first assertion is why.** An
    earlier version of this test seeded `_analysis_row`, which does not set
    `instrument`, `skip_long_rests`, `from_measure` or `failure_reason` — so
    those four were null on both sides and dropping one from the projection
    changed nothing the comparison could see. Measured: removing `instrument`
    from the derivation left this test passing. A field with no distinguishing
    value is a field this cannot check, so the row must carry one for every
    field and must fail rather than skip when it does not.
    """
    from app.routers.analyses import AnalysisResponse

    distinctive: dict[str, Any] = {
        "instrument": "double_bass",
        "skip_long_rests": True,
        "from_measure": 17,
        "failure_reason": "the take was silent",
        # Added with the field itself, because this test fails rather than
        # skips when a response field has no distinguishing value — which is
        # how it caught `assignment_id` arriving in the model. A fixed id
        # rather than `uuid4()`: the assertion only needs it to be non-null and
        # a stable one reads the same in every failure message.
        "assignment_id": "6bd3f2e1-0000-4000-8000-00000000a551",
    }
    user_id = uuid4()
    row = _analysis_row(user_id, uuid4(), status="done", **distinctive)
    unseeded = [
        name
        for name in AnalysisResponse.model_fields
        if row.get(name) in (None, "", [], {})
    ]
    assert not unseeded, (
        f"{unseeded} have no value in the seeded row, so this comparison cannot "
        "tell a projection that keeps them from one that drops them. Give each "
        "a distinctive value above."
    )

    fake = FakeSupabase()
    fake.seed("analyses", [row])
    _install(monkeypatch, fake)
    headers = {"Authorization": f"Bearer {make_token(sub=user_id)}"}

    full = client.get("/v1/analyses", headers=headers).json()[0]
    light = client.get("/v1/analyses?include_result=false", headers=headers).json()[0]

    differing = {k for k in full if full[k] != light.get(k)}
    assert differing == {"result_json"}, differing


def test_the_list_is_newest_first(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """**A documented contract with no test, which the app does not believe.**

    The docstring has said "newest first" since this endpoint was written, and
    `FakeSupabase.order` accepted the call and discarded it — so nothing here
    ever checked it. The app sorts the list again on arrival, with a comment
    saying the ordering "is settled here rather than assumed of the server",
    which is the reasonable thing to do about a promise nothing holds.

    It is worth testing because paging depends on it: an offset into an
    unordered list is not a page of anything.
    """
    user_id, score_id = uuid4(), uuid4()
    fake = FakeSupabase()
    fake.seed(
        "analyses",
        [
            _analysis_row(user_id, score_id, created_at="2026-03-02T09:00:00+00:00"),
            _analysis_row(user_id, score_id, created_at="2026-09-01T09:00:00+00:00"),
            _analysis_row(user_id, score_id, created_at="2026-06-14T09:00:00+00:00"),
        ],
    )
    _install(monkeypatch, fake)

    res = client.get(
        "/v1/analyses", headers={"Authorization": f"Bearer {make_token(sub=user_id)}"}
    )

    assert [row["created_at"] for row in res.json()] == [
        "2026-09-01T09:00:00+00:00",
        "2026-06-14T09:00:00+00:00",
        "2026-03-02T09:00:00+00:00",
    ]


def test_paging_walks_the_list_without_repeating_or_skipping(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """`range(offset, offset + limit - 1)` is inclusive at both ends.

    Off by one in either direction and a caller paging through either sees a
    row twice or never sees it at all — and until `FakeSupabase.range` did
    anything, both were invisible here.
    """
    user_id, score_id = uuid4(), uuid4()
    fake = FakeSupabase()
    fake.seed(
        "analyses",
        [
            _analysis_row(user_id, score_id, created_at=f"2026-01-{day:02d}T09:00:00+00:00")
            for day in range(1, 8)
        ],
    )
    _install(monkeypatch, fake)
    headers = {"Authorization": f"Bearer {make_token(sub=user_id)}"}

    def page(offset: int, limit: int) -> list[str]:
        res = client.get(f"/v1/analyses?limit={limit}&offset={offset}", headers=headers)
        assert res.status_code == 200
        return [row["created_at"] for row in res.json()]

    first, second, third = page(0, 3), page(3, 3), page(6, 3)

    assert len(first) == 3 and len(second) == 3 and len(third) == 1
    walked = first + second + third
    assert len(set(walked)) == 7, "a page repeated a row"
    # Newest first, all the way through, and every row exactly once.
    assert walked == sorted(walked, reverse=True)


def test_list_unauthenticated_returns_401(client: TestClient) -> None:
    assert client.get("/v1/analyses").status_code == 401


# ---- crash-recovery sweeper ----------------------------------------------


def test_sweeper_recovers_stuck_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeSupabase()
    old = (datetime.now(tz=timezone.utc) - timedelta(minutes=15)).isoformat()
    fresh = datetime.now(tz=timezone.utc).isoformat()
    fake.seed("analyses", [
        {"id": "1", "status": "processing", "updated_at": old},
        {"id": "2", "status": "queued", "updated_at": old},
        {"id": "3", "status": "processing", "updated_at": fresh},  # too recent — leave it
        {"id": "4", "status": "done", "updated_at": old},  # already terminal
    ])

    swept = sweep_stuck_analyses(fake)

    assert swept == 2
    by_id = {r["id"]: r for r in fake.table("analyses").rows}
    assert by_id["1"]["status"] == "failed_recoverable"
    assert by_id["2"]["status"] == "failed_recoverable"
    assert by_id["3"]["status"] == "processing"
    assert by_id["4"]["status"] == "done"


def _analysed() -> None:
    """Wait for the in-process pool to drain.

    **The 202 is now genuinely a 202.** These tests used to rely on
    `TestClient` running FastAPI's background tasks inline before returning
    from `post()`, so the analysis was finished by the time the next line ran.
    The work goes to `dispatch`'s bounded pool instead — a queue and its own
    threads — because `BackgroundTasks` gave forty of them a shared, uncounted
    forty-thread pool at ~460 MB a take.

    So the test waits where the app polls. A drain of an empty queue is a
    no-op, which is what the tests that stub `start_analysis` get.
    """
    dispatch._analysing._pending.join()


def _submit(
    client: TestClient,
    token: str,
    user_id: UUID,
    score_id: UUID,
    **extra: object,
) -> str:
    res = client.post(
        "/v1/analyses",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "score_id": str(score_id),
            "audio_url": _audio_url(user_id),
            "target_bpm": 120,
            "bpm_source": "manual",
            **extra,
        },
    )
    assert res.status_code == 202, res.text
    _analysed()
    return res.json()["analysis_id"]


@pytest.mark.parametrize(
    ("instrument", "expected_flag"),
    [
        ("double_bass", True),
        ("cello", False),
        ("violin", False),
        (None, False),
    ],
)
def test_the_instrument_decides_the_double_bass_setting(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
    instrument: str | None,
    expected_flag: bool,
) -> None:
    """`analyze()`'s `double_bass` flag had no caller that ever set it.

    It turns on a high-pass filter and a lower onset threshold for the register
    where attacks are softest — and every bass player was analysed without it,
    in an app whose spec names double bass as its initial instrument focus.
    This is the test that the flag is reachable at all.

    Cello is here deliberately: it reads bass clef and it is *not* a double
    bass. Its low C is around 65 Hz, under the 80 Hz high-pass, so treating the
    two alike would filter away the fundamental of the notes a cellist most
    needs heard.
    """
    user_id = uuid4()
    score_id = uuid4()
    fake = FakeSupabase()
    fake.seed(
        "scores",
        [{"id": str(score_id), "user_id": str(user_id), "score_json": GOOD_SCORE_JSON}],
    )
    _install(monkeypatch, fake)
    monkeypatch.setattr(analysis_runner, "download_audio", lambda _url: _wav_bytes())

    seen: list[bool] = []
    real = analysis_runner.analyze

    def spy(audio, score, target_bpm, **kwargs):
        seen.append(bool(kwargs.get("double_bass")))
        return real(audio, score, target_bpm, **kwargs)

    monkeypatch.setattr(analysis_runner, "analyze", spy)

    token = make_token(sub=user_id)
    extra = {} if instrument is None else {"instrument": instrument}
    _submit(client, token, user_id, score_id, **extra)

    assert seen == [expected_flag]


def test_the_instrument_is_stored_and_read_back(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Stored as the instrument, not as a derived flag — how each instrument
    should be treated is still being tuned, and a column holding today's
    conclusion could never answer "how did the cellists do"."""
    user_id = uuid4()
    score_id = uuid4()
    fake = FakeSupabase()
    fake.seed(
        "scores",
        [{"id": str(score_id), "user_id": str(user_id), "score_json": GOOD_SCORE_JSON}],
    )
    _install(monkeypatch, fake)
    monkeypatch.setattr(analyses_module, "start_analysis", lambda _id: None)

    token = make_token(sub=user_id)
    analysis_id = _submit(client, token, user_id, score_id, instrument="double_bass")

    got = client.get(
        f"/v1/analyses/{analysis_id}", headers={"Authorization": f"Bearer {token}"}
    )
    assert got.status_code == 200
    assert got.json()["instrument"] == "double_bass"


def test_an_unknown_instrument_is_refused_rather_than_ignored(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """A closed enum, so a typo cannot quietly become "not stated"."""
    user_id = uuid4()
    score_id = uuid4()
    fake = FakeSupabase()
    fake.seed(
        "scores",
        [{"id": str(score_id), "user_id": str(user_id), "score_json": GOOD_SCORE_JSON}],
    )
    _install(monkeypatch, fake)

    res = client.post(
        "/v1/analyses",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
        json={
            "score_id": str(score_id),
            "audio_url": _audio_url(user_id),
            "target_bpm": 120,
            "bpm_source": "manual",
            "instrument": "theremin",
        },
    )
    assert res.status_code == 422


# --------------------------------------------------------------------------
# Skipping the long rests
#
# The flag has to reach the worker: skipping a rest the timeline still contains
# takes an otherwise perfect take from quality 1.000 to 0.000. See
# `test_long_rest_parity.py` for that measurement and migration 012 for why the
# key is written only when it is true.
# --------------------------------------------------------------------------


def _post_take(client, token: str, user_id: UUID, score_id, **extra) -> Any:
    return client.post(
        "/v1/analyses",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "score_id": str(score_id),
            "audio_url": _audio_url(user_id),
            "target_bpm": 96,
            "bpm_source": "manual",
            **extra,
        },
    )


def test_a_take_that_skipped_the_rests_says_so_on_the_row(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    score_id = uuid4()
    fake = FakeSupabase()
    fake.seed("scores", [{"id": str(score_id), "user_id": str(user_id), "score_json": GOOD_SCORE_JSON}])
    _install(monkeypatch, fake)
    monkeypatch.setattr(analysis_runner, "run_analysis", lambda _id: None)

    res = _post_take(
        client, make_token(sub=user_id), user_id, score_id, skip_long_rests=True
    )

    assert res.status_code == 202, res.text
    assert fake.table("analyses").rows[0]["skip_long_rests"] is True


def test_a_take_that_did_not_skip_writes_no_key_at_all(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """**So a deployment without migration 012 is untouched until it matters.**

    Writing `false` on every take would break every insert on a table that
    predates the column — for a fact that is only ever interesting when true.
    """
    user_id = uuid4()
    score_id = uuid4()
    fake = FakeSupabase()
    fake.seed("scores", [{"id": str(score_id), "user_id": str(user_id), "score_json": GOOD_SCORE_JSON}])
    _install(monkeypatch, fake)
    monkeypatch.setattr(analysis_runner, "run_analysis", lambda _id: None)

    assert (
        _post_take(client, make_token(sub=user_id), user_id, score_id).status_code == 202
    )
    assert "skip_long_rests" not in fake.table("analyses").rows[0]

    assert (
        _post_take(
            client, make_token(sub=user_id), user_id, score_id, skip_long_rests=False
        ).status_code
        == 202
    )
    assert "skip_long_rests" not in fake.table("analyses").rows[1]


# ---------------------------------------------------------------------------
# Recording from a chosen bar on a database that cannot store one
# ---------------------------------------------------------------------------


def _install_insert_that_lacks_from_measure(monkeypatch, fake) -> None:
    """A table whose `analyses` predates migration 015.

    The real client raises from `execute()` with PostgREST's message naming
    the column. Only an insert that *carries* the key fails — every other take
    is unaffected, which is what a missing nullable column actually does.
    """
    table = fake.table("analyses")
    real_insert = table.insert

    def insert(payload):
        if isinstance(payload, dict) and "from_measure" in payload:
            class _Boom:
                def execute(self):
                    raise RuntimeError(
                        'column "from_measure" of relation "analyses" does not exist'
                    )

            return _Boom()
        return real_insert(payload)

    monkeypatch.setattr(table, "insert", insert)


def test_a_chosen_bar_on_a_pre_015_database_is_refused_with_advice(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """**The bar is refused, not the take, and not quietly.**

    Dropping the key and analysing from bar 1 would be the misalignment this
    feature exists to prevent, reintroduced by a missing column. A raw 500 —
    the 012 precedent — shows "something went wrong" for a request that was
    entirely reasonable. The refusal names the one thing the musician can
    change, and the picker lets them change it.
    """
    user_id = uuid4()
    score_id = uuid4()
    fake = FakeSupabase()
    fake.seed(
        "scores",
        [{"id": str(score_id), "user_id": str(user_id), "score_json": GOOD_SCORE_JSON}],
    )
    _install(monkeypatch, fake)
    _install_insert_that_lacks_from_measure(monkeypatch, fake)
    monkeypatch.setattr(analyses_module, "start_analysis", lambda *_: None)

    res = client.post(
        "/v1/analyses",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
        json={
            "score_id": str(score_id),
            "audio_url": _audio_url(user_id),
            "target_bpm": 120,
            "bpm_source": "manual",
            "from_measure": 2,
        },
    )

    assert res.status_code == 400
    assert "bar 1" in res.json()["detail"]
    assert len(fake.table("analyses").rows) == 0


def test_a_take_from_the_start_still_works_on_a_pre_015_database(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The column is nullable and the key is only sent when a bar was chosen,
    so every take that does not choose one is untouched by the migration."""
    user_id = uuid4()
    score_id = uuid4()
    fake = FakeSupabase()
    fake.seed(
        "scores",
        [{"id": str(score_id), "user_id": str(user_id), "score_json": GOOD_SCORE_JSON}],
    )
    _install(monkeypatch, fake)
    _install_insert_that_lacks_from_measure(monkeypatch, fake)
    monkeypatch.setattr(analyses_module, "start_analysis", lambda *_: None)

    res = client.post(
        "/v1/analyses",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
        json={
            "score_id": str(score_id),
            "audio_url": _audio_url(user_id),
            "target_bpm": 120,
            "bpm_source": "manual",
        },
    )

    assert res.status_code == 202
    assert len(fake.table("analyses").rows) == 1

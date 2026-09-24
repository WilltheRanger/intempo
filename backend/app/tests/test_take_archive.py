"""Keeping a take without keeping 96 KB a second of it.

A recording is uploaded as 48 kHz mono 16-bit WAV and nothing ever deleted one
— only deleting the piece or the account did. Measured on the live project: an
active musician with twenty two-minute takes carries about 230 MB, so 1 GB of
free storage is about four people.

These tests are about the two things that make replacing it safe rather than
clever: that the *order* of operations can never leave a musician with no
audio, and that both copies are found again when the piece or the account is
deleted.

**And, from the bottom of the file down, the takes that never got a verdict.**
That replacement runs on one path — after a row is written `done` — so a take
that ended `failed` kept its WAV, claimed by a row finished with it and swept
by nothing. `sweep_unjudged_takes` is that path; the cases below are about it
taking the right recordings and, twice over, about it not taking the wrong ones.
"""

from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest
import soundfile as sf

from app.services import take_archive
from app.services.take_archive import keep_playback_copy, playback_key_for, to_opus
from app.tests.fake_supabase import FakeSupabase


def _wav(seconds: float = 1.0, rate: int = 48_000) -> bytes:
    t = np.linspace(0, seconds, int(rate * seconds), endpoint=False, dtype="float32")
    out = io.BytesIO()
    sf.write(out, (0.3 * np.sin(2 * np.pi * 440 * t)).astype("float32"), rate,
             subtype="PCM_16", format="WAV")
    return out.getvalue()


class _Bucket:
    def __init__(self, *, upload_fails: bool = False, remove_fails: bool = False) -> None:
        self.uploaded: list[tuple[str, int]] = []
        self.removed: list[list[str]] = []
        self._upload_fails = upload_fails
        self._remove_fails = remove_fails

    def upload(self, key, data, options=None):  # noqa: ANN001, ARG002
        if self._upload_fails:
            raise RuntimeError("storage said no")
        self.uploaded.append((key, len(data)))

    def remove(self, keys):  # noqa: ANN001
        if self._remove_fails:
            raise RuntimeError("storage said no")
        self.removed.append(list(keys))


class _Client:
    def __init__(self, bucket: _Bucket, *, update_fails: bool = False) -> None:
        self._bucket = bucket
        self._update_fails = update_fails
        self.patches: list[dict] = []

    def storage_from(self, _name):  # pragma: no cover - shape only
        return self._bucket

    @property
    def storage(self):
        client = self

        class _Storage:
            def from_(self, _name):  # noqa: ANN001
                return client._bucket

        return _Storage()

    def table(self, _name):  # noqa: ANN001
        return self

    def update(self, patch):  # noqa: ANN001
        if self._update_fails:
            raise RuntimeError("row said no")
        self.patches.append(patch)
        return self

    def eq(self, *_a):
        return self

    def execute(self):
        return type("R", (), {"data": []})()


# ---- the encoding ----------------------------------------------------------


def test_opus_is_a_fraction_of_the_wav() -> None:
    """The whole reason this exists, asserted rather than assumed.

    A pure sine is close to the worst case a codec can be handed — no silence,
    no decay, nothing to predict — so a real take does better than this.
    """
    wav = _wav(seconds=2.0)
    opus = to_opus(wav)

    assert len(opus) < len(wav) / 5, f"{len(wav)} -> {len(opus)} is not worth doing"


def test_the_copy_still_decodes_to_the_same_length() -> None:
    """Smaller is only useful if it is still the take."""
    wav = _wav(seconds=1.0)
    data, rate = sf.read(io.BytesIO(to_opus(wav)))

    assert rate == 48_000
    # Opus pads to its frame size, so this is "the same recording", not "the
    # same sample count".
    assert 0.9 < len(data) / 48_000 < 1.2


def test_a_rate_opus_refuses_is_resampled_rather_than_failing() -> None:
    """A device that insists on 44.1 kHz must not lose its playback copy.

    Opus accepts a fixed set of rates and 44,100 is not among them, so the
    encoder raises rather than resampling for us. That would have been a
    warning in the log and a WAV kept forever, on exactly the phones that are
    hardest to test.
    """
    opus = to_opus(_wav(seconds=1.0, rate=44_100))
    _, rate = sf.read(io.BytesIO(opus))

    assert rate == 48_000


# ---- the key ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("reference", "expected"),
    [
        ("user-1/take.wav", "user-1/take.opus"),
        ("audio-uploads/user-1/take.wav", "user-1/take.opus"),
        ("user-1/no-extension", "user-1/no-extension.opus"),
    ],
)
def test_the_copy_sits_beside_the_original(reference: str, expected: str) -> None:
    """Same key, new extension — so the owner prefix survives.

    `owned_audio_key` re-checks that prefix at every read boundary, so a key
    built any other way would be refused by the endpoint this exists to serve.
    """
    assert playback_key_for(reference) == expected


def test_a_reference_with_no_key_in_it_is_refused() -> None:
    assert playback_key_for("https://elsewhere.test/take.wav") is None


# ---- the ordering ----------------------------------------------------------


def test_the_copy_is_stored_and_recorded_and_the_wav_is_left_for_the_sweep() -> None:
    """**Not deleted here any more.** The verdict screen asks for its recording
    the moment the verdict arrives, which can be before this has written the
    Opus into the row — so it is handed a link to the WAV, and a WAV deleted
    a few hundred milliseconds later answered that link with a 400 (measured
    in the storage logs, 2026-09-24). `sweep_judged_originals` removes it once
    every link it could have been given has expired."""
    bucket = _Bucket()
    client = _Client(bucket)

    key = keep_playback_copy(client, "a1", "user-1/take.wav", _wav())

    assert key == "user-1/take.opus"
    assert [name for name, _ in bucket.uploaded] == ["user-1/take.opus"]
    assert client.patches == [{"playback_key": "user-1/take.opus"}]
    assert bucket.removed == []


def test_a_failed_upload_leaves_the_wav_alone() -> None:
    """The take is what matters; the copy is an optimisation.

    Every failure here has to fall on the side of costing storage rather than
    costing a recording, which is why this runs after the verdict is written
    and never raises.
    """
    bucket = _Bucket(upload_fails=True)
    client = _Client(bucket)

    assert keep_playback_copy(client, "a1", "user-1/take.wav", _wav()) is None
    assert bucket.removed == [], "the original was deleted after a failed copy"
    assert client.patches == []


def test_a_failed_row_write_leaves_the_wav_alone() -> None:
    """The dangerous one: the object exists but nothing points at it.

    Deleting the WAV here would leave a row naming an object that is gone and
    an object nothing names — a take that cannot be played back by anything.
    """
    bucket = _Bucket()
    client = _Client(bucket, update_fails=True)

    assert keep_playback_copy(client, "a1", "user-1/take.wav", _wav()) is None
    assert bucket.removed == [], "the original was deleted with the row still naming it"


def test_an_unusable_reference_touches_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    bucket = _Bucket()
    client = _Client(bucket)

    assert keep_playback_copy(client, "a1", "https://elsewhere.test/x.wav", _wav()) is None
    assert bucket.uploaded == []
    assert bucket.removed == []


def test_audio_that_will_not_decode_is_a_warning_not_a_crash(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """`run_analysis` calls this after the row is already `done`.

    An exception escaping here would propagate out of a function whose work is
    finished, and the only thing it could achieve is a traceback in the log
    where a warning belongs.
    """
    bucket = _Bucket()
    client = _Client(bucket)

    with caplog.at_level("WARNING"):
        assert keep_playback_copy(client, "a1", "user-1/take.wav", b"not audio") is None

    assert bucket.uploaded == []
    assert "a1" in caplog.text


def test_it_is_reachable_from_the_runner() -> None:
    """The defect this repository keeps finding: written, tested, never called.

    `check-dead-exports` cannot see this one — the import is real, so the
    export is referenced whether or not anything invokes it.
    """
    from app.workers import analysis_runner

    assert analysis_runner.keep_playback_copy is take_archive.keep_playback_copy
    source = (
        __import__("pathlib").Path(analysis_runner.__file__).read_text(encoding="utf-8")
    )
    assert "keep_playback_copy(client, analysis_id" in source, (
        "imported but never called — the copy would never be made"
    )


# ---- the takes that never got a verdict ------------------------------------
#
# `keep_playback_copy` above runs on one path: `run_analysis`, after the row is
# written `done`. Everything below is about the other endings, which kept their
# WAV forever — claimed by a row that is finished with it, so `pending_uploads`
# will not sweep it, and never reaching the one thing that deletes one.


def _failed_take(
    *,
    key: str = "user-1/take.wav",
    status: str = "failed",
    updated: str = "2026-09-01T00:00:00+00:00",
    **extra,
) -> dict:
    return {
        "id": "a1",
        "status": status,
        "audio_url": f"audio-uploads/{key}",
        "updated_at": updated,
        **extra,
    }


def _seeded(rows: list[dict], objects: list[str]) -> FakeSupabase:
    fake = FakeSupabase()
    fake.seed("analyses", rows)
    for key in objects:
        fake.put_object(take_archive.AUDIO_BUCKET, key, b"a take")
    return fake


#: Comfortably past `RECLAIM_AFTER` from the timestamps above.
NOW = datetime(2026, 9, 30, tzinfo=timezone.utc)


def test_a_failed_take_loses_the_recording_nothing_will_ever_read_again() -> None:
    """The whole point: ~3 MB per failed take, reclaimed by something.

    Before this, the only path that deleted a WAV ran after a verdict was
    written, and a take that never got one was swept by nothing at all.
    """
    fake = _seeded([_failed_take()], ["user-1/take.wav"])

    assert take_archive.sweep_unjudged_takes(fake, now=NOW) == 1
    assert fake.object_keys(take_archive.AUDIO_BUCKET) == set()
    assert fake.table("analyses").rows[0]["audio_reclaimed_at"] is not None


def test_a_take_swept_up_as_stuck_is_reclaimed_too() -> None:
    """`failed_recoverable` is where a take whose worker never ran ends up.

    `sweep_stuck_analyses` moves a row that is still `queued` or `processing`
    after ten minutes into this state, so covering it is what makes "never
    analysed" part of this sweep rather than a third case with no owner.
    """
    fake = _seeded([_failed_take(status="failed_recoverable")], ["user-1/take.wav"])

    assert take_archive.sweep_unjudged_takes(fake, now=NOW) == 1
    assert fake.object_keys(take_archive.AUDIO_BUCKET) == set()


def test_a_take_keeps_its_recording_while_the_grace_period_runs() -> None:
    """The failure screen draws a player under a failed take.

    It says the analysis failed and the musician's playing was not the problem,
    and the recording is the only thing on that screen worth having. Deleting
    it as the row turns `failed` would take it away in the minutes they are
    most likely to use it — so this waits a day, and this is the assertion that
    the waiting is real rather than a constant nothing reads.
    """
    recent = (NOW - take_archive.RECLAIM_AFTER / 2).isoformat()
    fake = _seeded([_failed_take(updated=recent)], ["user-1/take.wav"])

    assert take_archive.sweep_unjudged_takes(fake, now=NOW) == 0
    assert fake.object_keys(take_archive.AUDIO_BUCKET) == {"user-1/take.wav"}


def test_a_judged_take_is_never_touched() -> None:
    """Its key holds the Opus by now, and playback is the only thing left.

    Deleting here would take the audio of a take that *has* a verdict, which is
    the one direction this module is written never to fail in.
    """
    fake = _seeded(
        [_failed_take(status="done", playback_key="user-1/take.opus")],
        ["user-1/take.opus"],
    )

    assert take_archive.sweep_unjudged_takes(fake, now=NOW) == 0
    assert fake.object_keys(take_archive.AUDIO_BUCKET) == {"user-1/take.opus"}


def test_a_judged_take_whose_transcode_failed_keeps_its_wav() -> None:
    """`done` with no `playback_key` is the third of 018's three nulls.

    The encode failed, so the WAV is not a leftover — it is the recording the
    verdict screen falls back to, for a take with a verdict. The filter is on
    the status, not on the absence of an Opus, and this is why.
    """
    fake = _seeded([_failed_take(status="done")], ["user-1/take.wav"])

    assert take_archive.sweep_unjudged_takes(fake, now=NOW) == 0
    assert fake.object_keys(take_archive.AUDIO_BUCKET) == {"user-1/take.wav"}


def test_a_take_with_an_opus_is_left_alone_whatever_its_status_says() -> None:
    """Defensive, and deliberately so — no path writes this row today.

    `keep_playback_copy` runs only after a row is written `done`, and nothing
    moves a `done` row back, so a `failed` take with a `playback_key` cannot
    currently exist. The filter is there because of what it would cost if one
    ever could: `audio_url` and `playback_key` differ only in their extension,
    and the key this sweep deletes is built from the former. A status this set
    happens to name would take the Opus of a take that has a verdict — the one
    direction this module is written never to fail in.
    """
    fake = _seeded(
        [_failed_take(status="failed", playback_key="user-1/take.opus")],
        ["user-1/take.opus"],
    )

    assert take_archive.sweep_unjudged_takes(fake, now=NOW) == 0
    assert fake.object_keys(take_archive.AUDIO_BUCKET) == {"user-1/take.opus"}


def test_a_take_still_being_analysed_is_left_alone() -> None:
    """`run_analysis` is about to download this. Ten minutes from now the
    stuck-row sweeper may call it failed, and then it is this sweep's."""
    fake = _seeded([_failed_take(status="processing")], ["user-1/take.wav"])

    assert take_archive.sweep_unjudged_takes(fake, now=NOW) == 0
    assert fake.object_keys(take_archive.AUDIO_BUCKET) == {"user-1/take.wav"}


def test_a_reclaimed_take_is_not_offered_to_the_next_pass() -> None:
    """The reason `audio_reclaimed_at` exists rather than nothing.

    A sweep with a `limit` and no memory fills its batch with takes it has
    already reclaimed, and the newest ones are never reached — a sweeper that
    stops sweeping without ever failing. One pass, then a second that finds
    nothing to do.
    """
    fake = _seeded([_failed_take()], ["user-1/take.wav"])

    assert take_archive.sweep_unjudged_takes(fake, now=NOW) == 1
    assert take_archive.sweep_unjudged_takes(fake, now=NOW) == 0


def test_a_reference_with_no_key_is_marked_rather_than_retried_forever() -> None:
    """Nothing to delete, and it must not be looked at again.

    A row whose `audio_url` names storage this service does not own has no
    object to reclaim — `durable_audio_reference` makes that impossible for new
    rows, so this is history — and leaving it unmarked hands it to every future
    pass, which is the same starvation as the case above.
    """
    fake = FakeSupabase()
    fake.seed("analyses", [dict(_failed_take(), audio_url="https://elsewhere.test/x.wav")])

    assert take_archive.sweep_unjudged_takes(fake, now=NOW) == 1
    assert fake.table("analyses").rows[0]["audio_reclaimed_at"] is not None


def test_a_storage_failure_leaves_the_row_for_the_next_pass() -> None:
    """The object first, then the mark — the same ordering rule as
    `pending_uploads.sweep_unclaimed`, and for the same reason. A row marked
    before its object is deleted leaks the object permanently and silently,
    which is the bug this exists to fix reintroduced one level down."""
    fake = _seeded([_failed_take()], ["user-1/take.wav"])

    def _refuse(_keys):
        raise RuntimeError("storage said no")

    fake.storage.from_(take_archive.AUDIO_BUCKET).remove = _refuse

    assert take_archive.sweep_unjudged_takes(fake, now=NOW) == 0
    assert fake.table("analyses").rows[0].get("audio_reclaimed_at") is None


def test_a_broken_query_costs_one_pass_and_not_the_loop() -> None:
    """It runs every five minutes for the life of the process, beside three
    other sweeps. One bad pass has to cost one pass."""
    class _Broken:
        storage = None

        def table(self, _name):
            raise RuntimeError("supabase said no")

    assert take_archive.sweep_unjudged_takes(_Broken(), now=NOW) == 0


def test_it_is_reachable_from_the_sweeper_loop() -> None:
    """The defect this repository keeps finding: written, tested, never called.

    `check-dead-exports` cannot see it — `main` imports the module, so the
    export is referenced whether or not the loop ever invokes it. That is
    exactly how `ReadingRate.forget_expired` went eleven days without a caller.
    """
    from pathlib import Path

    from app import main

    assert main.take_archive.sweep_unjudged_takes is take_archive.sweep_unjudged_takes
    source = Path(main.__file__).read_text(encoding="utf-8")
    assert "take_archive.sweep_unjudged_takes" in source, (
        "imported but never swept — every failed take would keep its WAV"
    )
    assert "take_archive.sweep_judged_originals" in source, (
        "imported but never swept — every judged take would keep its WAV"
    )


# ---- the originals of takes that were judged --------------------------------
#
# `keep_playback_copy` no longer deletes the WAV: a link to it may already be
# in a phone's hands. These are about the sweep that does, an hour later.


def _judged_take(*, finished: str = "2026-09-01T00:00:00+00:00", **extra) -> dict:
    return {
        "id": "a1",
        "status": "done",
        "audio_url": "audio-uploads/user-1/take.wav",
        "playback_key": "user-1/take.opus",
        "finished_at": finished,
        **extra,
    }


def test_a_judged_takes_wav_goes_once_no_link_to_it_can_play() -> None:
    fake = _seeded([_judged_take()], ["user-1/take.wav", "user-1/take.opus"])

    assert take_archive.sweep_judged_originals(fake, now=NOW) == 1
    assert fake.object_keys(take_archive.AUDIO_BUCKET) == {"user-1/take.opus"}
    assert fake.table("analyses").rows[0]["audio_reclaimed_at"] is not None


def test_a_link_handed_out_at_the_verdict_still_plays_until_it_expires() -> None:
    """The case this exists for. A link to the WAV can be minted a moment
    after `finished_at`, and it lives `SIGNED_AUDIO_DOWNLOAD_TTL_SECONDS`; the
    WAV has to outlive every such link."""
    from app.services.audio_storage import SIGNED_AUDIO_DOWNLOAD_TTL_SECONDS

    just_expired = NOW - timedelta(seconds=SIGNED_AUDIO_DOWNLOAD_TTL_SECONDS)
    fake = _seeded(
        [_judged_take(finished=just_expired.isoformat())],
        ["user-1/take.wav", "user-1/take.opus"],
    )

    assert take_archive.sweep_judged_originals(fake, now=NOW) == 0
    assert "user-1/take.wav" in fake.object_keys(take_archive.AUDIO_BUCKET)
    assert take_archive.RELEASE_AFTER > timedelta(seconds=SIGNED_AUDIO_DOWNLOAD_TTL_SECONDS)


def test_a_judged_take_with_no_opus_keeps_its_wav() -> None:
    """The transcode failed, so the WAV is the recording its verdict plays."""
    fake = _seeded([_judged_take(playback_key=None)], ["user-1/take.wav"])

    assert take_archive.sweep_judged_originals(fake, now=NOW) == 0
    assert fake.object_keys(take_archive.AUDIO_BUCKET) == {"user-1/take.wav"}


def test_an_unjudged_take_is_left_to_its_own_sweep() -> None:
    fake = _seeded(
        [_judged_take(status="failed", playback_key=None)], ["user-1/take.wav"]
    )

    assert take_archive.sweep_judged_originals(fake, now=NOW) == 0
    assert fake.object_keys(take_archive.AUDIO_BUCKET) == {"user-1/take.wav"}


def test_the_backlog_of_takes_whose_wav_already_went_is_marked_and_forgotten() -> None:
    """Every judged take before this lost its WAV at the verdict. The first
    passes find nothing behind them, mark them, and never offer them again."""
    fake = _seeded([_judged_take()], ["user-1/take.opus"])

    assert take_archive.sweep_judged_originals(fake, now=NOW) == 1
    assert take_archive.sweep_judged_originals(fake, now=NOW) == 0
    assert fake.object_keys(take_archive.AUDIO_BUCKET) == {"user-1/take.opus"}


def test_it_never_deletes_the_copy_a_take_plays_from() -> None:
    """`audio_url` and `playback_key` differ only in their extension. A row
    whose two named one object must not lose its only recording to a tidy-up."""
    fake = _seeded(
        [_judged_take(audio_url="audio-uploads/user-1/take.opus")], ["user-1/take.opus"]
    )

    assert take_archive.sweep_judged_originals(fake, now=NOW) == 0
    assert fake.object_keys(take_archive.AUDIO_BUCKET) == {"user-1/take.opus"}


def test_a_broken_query_costs_the_release_one_pass() -> None:
    class _Broken:
        storage = None

        def table(self, _name):
            raise RuntimeError("supabase said no")

    assert take_archive.sweep_judged_originals(_Broken(), now=NOW) == 0

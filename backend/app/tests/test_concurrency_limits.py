"""What happens when several people scan at the same time.

**The question this answers is "would it work if multiple people run it", and
before these limits the answer was no.** `BackgroundTasks` runs sync work in
Starlette's threadpool, which holds **40** threads. Forty simultaneous scans is
therefore a reachable state, not a hypothetical one, and it costs:

    ~81 MB   per in-flight scan on the vision path (Pillow decode buffers —
             a 12 MP photograph is ~36 MB as RGB before anything copies it)
    ~328 MB  per Audiveris run, reading a page system by system

Forty of the first is 3.2 GB; two of the second is 656 MB. The instance has
512 MB, and an OOM kill takes the **whole process** down — every other
musician's scan with it — not just the one that asked for too much.

So both are bounded, and the tests below are about the bound holding under
actual threads rather than in principle.
"""

from __future__ import annotations

import threading
import time

import pytest

from app.config import settings
from app.services.ocr.base import OCRProviderError
from app.workers import transcription_runner as runner


class _Recorder:
    """Counts how many callers are inside at once."""

    def __init__(self) -> None:
        self.live = 0
        self.peak = 0
        self._lock = threading.Lock()

    def enter(self) -> None:
        with self._lock:
            self.live += 1
            self.peak = max(self.peak, self.live)

    def leave(self) -> None:
        with self._lock:
            self.live -= 1


# ---- reading pages ---------------------------------------------------------


def test_only_so_many_pages_are_read_at_once(monkeypatch: pytest.MonkeyPatch) -> None:
    """Forty threads, and never more than the configured number inside.

    Without the semaphore this peaks at the number of threads offered, which
    on a real server is forty and about 3.2 GB.
    """
    seen = _Recorder()

    def fake_read(_client, _score_id, _image_url):
        seen.enter()
        time.sleep(0.05)
        seen.leave()

    monkeypatch.setattr(runner, "_read_page", fake_read)
    monkeypatch.setattr(runner, "get_service_client", lambda: _Client())
    monkeypatch.setattr(runner, "_fetch_score", lambda *_: {"source_image_url": "u"})

    threads = [threading.Thread(target=runner.run_transcription, args=("id",)) for _ in range(40)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert seen.peak <= settings.TRANSCRIPTION_MAX_CONCURRENT
    assert seen.peak > 0, "nothing ran at all"


def test_every_page_still_gets_read(monkeypatch: pytest.MonkeyPatch) -> None:
    """A limit that dropped work would be worse than no limit — the point is
    to make them wait, not to lose them."""
    done = []
    lock = threading.Lock()

    def fake_read(_client, _score_id, _image_url):
        with lock:
            done.append(1)

    monkeypatch.setattr(runner, "_read_page", fake_read)
    monkeypatch.setattr(runner, "get_service_client", lambda: _Client())
    monkeypatch.setattr(runner, "_fetch_score", lambda *_: {"source_image_url": "u"})

    threads = [threading.Thread(target=runner.run_transcription, args=("id",)) for _ in range(12)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(done) == 12


def test_a_slot_is_returned_even_when_the_page_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    """A leaked permit is a server that stops reading pages and never says why.

    Worth its own test because the failure is silent, permanent, and looks
    exactly like the queue being busy.
    """

    def explodes(_client, _score_id, _image_url):
        raise RuntimeError("boom")

    monkeypatch.setattr(runner, "_read_page", explodes)
    monkeypatch.setattr(runner, "get_service_client", lambda: _Client())
    monkeypatch.setattr(runner, "_fetch_score", lambda *_: {"source_image_url": "u"})

    for _ in range(settings.TRANSCRIPTION_MAX_CONCURRENT + 2):
        with pytest.raises(RuntimeError):
            runner.run_transcription("id")

    # Still acquirable: the permits came back.
    assert runner._scan_slots.acquire(timeout=1)
    runner._scan_slots.release()


# ---- running the engine ----------------------------------------------------


def test_only_one_engine_run_at_a_time() -> None:
    """328 MB each. Two at once is 656 MB on a 512 MB box."""
    from app.services.ocr import omr_provider

    seen = _Recorder()

    def worker():
        assert omr_provider._engine_slots.acquire(timeout=5)
        try:
            seen.enter()
            time.sleep(0.05)
            seen.leave()
        finally:
            omr_provider._engine_slots.release()

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert seen.peak <= settings.OMR_MAX_CONCURRENT


def test_waiting_too_long_for_the_engine_skips_the_second_opinion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Giving up here costs the second opinion and nothing else.

    The caller logs it and the vision chain answers alone — which is exactly
    what happens on every install with no engine at all. Blocking forever would
    instead hold one of forty threadpool threads behind a queue that may never
    drain.
    """
    from app.services.ocr import omr_provider

    monkeypatch.setattr(settings, "OMR_QUEUE_TIMEOUT_S", 0.05)
    provider = omr_provider.OMRProvider(command="does-not-matter")
    monkeypatch.setattr(provider, "_resolve_command", lambda: "does-not-matter")

    omr_provider._engine_slots.acquire()
    try:
        with pytest.raises(OCRProviderError) as caught:
            provider._parse_one(b"x")
        assert "busy" in str(caught.value)
    finally:
        omr_provider._engine_slots.release()


def test_the_engine_slot_is_returned_after_a_failed_run(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services.ocr import omr_provider

    provider = omr_provider.OMRProvider(command="definitely-not-installed-omr")
    for _ in range(3):
        with pytest.raises(OCRProviderError):
            provider.parse(b"x")
    assert omr_provider._engine_slots.acquire(timeout=1)
    omr_provider._engine_slots.release()


class _Client:
    def table(self, _name):
        return self

    def select(self, *_a):
        return self

    def eq(self, *_a):
        return self

    def limit(self, *_a):
        return self

    def update(self, *_a):
        return self

    def execute(self):
        return type("R", (), {"data": [{"source_image_url": "u"}]})()

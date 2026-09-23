"""Compile the analysis pipeline before a musician's take has to.

    python -m app.workers.warmup

**What it cost, measured on 2026-09-23.** A twelve-second take recorded on the
live app spent **123 s** in `decoding` and **38 s** in `listening`, and the
median finished analysis that month took 152 s. Neither number is the work.
The same take analyses in a quarter of a second in a process that has done one
before; the fast analyses in production were exactly the ones that followed
another take within minutes.

The rest is numba. librosa compiles its inner loops the first time a process
needs them: importing `librosa.util.utils` — which `librosa.load` does, to mix
to mono — compiles twenty ufuncs on the spot, and onset detection and
alignment compile a few more on first call. That is 16 s of one core on a
development machine, and production ran it about eight times slower.

**librosa marks every one of those `cache=True`**, so numba writes what it
compiled to disk and reads it back the next time. Production never had a next
time. Every deploy, and every wake from the free plan's fifteen-minute sleep,
starts a fresh container from the image, and whatever the last one wrote went
with it.

So the compiling happens once, while the image is built, and the image carries
the result. Two settings make that work, and both images set them:

- `NUMBA_CACHE_DIR`, a directory inside the image, so the cache is somewhere
  the build writes and the container reads.
- `NUMBA_CPU_NAME=generic`. Numba keys its cache on the CPU model and feature
  set of the machine that compiled it (`CPUCodegen.magic_tuple`), and the
  machine that builds an image is not the one that runs it. With the host's
  CPU in the key, every entry misses and the container compiles anyway —
  silently, which is the failure this module exists to prevent. `generic`
  makes the key the same everywhere. Measured on the six-clip corpus: results
  byte-identical to host-tuned code, and no slower.

With the cache in the image, the first take in a new process went from 19 s to
1.4 s on the development machine (decode 15.7 → 0.9 s, listen 3.2 → 0.5 s).
The 1.4 s is reading the cache back. `warm_in_background` spends it at boot,
while the musician is still opening the app, rather than after they press stop.

**What it has to cover.** Each numba function compiles once per argument type,
not once per function, so warming "the pipeline" means walking every path that
calls one with a different signature. Three takes do it, and each is here for
a reason `test_warmup.py` found:

- **a whole take**, the common case;
- **half of one**, which aligns by subsequence DTW and backtracks from a start
  index a whole take does not have — a second compiled variant;
- **one note**, which makes a one-row cost matrix. Numba compiles a contiguous
  array separately from a sliced one, and a single row is the only slice that
  comes out contiguous. The corpus's long open string is exactly this.

`test_warmup.py` runs the corpus after the warm-up and fails if anything
compiles, which is how this list stays complete.
"""

from __future__ import annotations

import io
import logging
import threading
import time

import numpy as np

log = logging.getLogger("intempo.analysis")

#: What the app's recorder writes: 16-bit mono PCM at the audio context's rate,
#: which is 48 kHz on every phone this has been measured on. A different rate
#: would skip the resampling a real take goes through.
_TAKE_RATE = 48_000

_BPM = 120.0

#: Eight quarter notes on E2. Short, so the warm-up is quick; two bars, so half
#: a take is a real partial one.
_NOTES = 8
_SCORE = {
    "time_signature": "4/4",
    "key_signature": None,
    "tempo_marking": None,
    "bpm_hint": int(_BPM),
    "clef": "bass",
    "repeats": [],
    "ocr_confidence": 1.0,
    "notes_to_human": "Warm-up take, not a musician's.",
    "measures": [
        {
            "measure_number": number,
            "notes": [{"pitch": "E2", "duration": "quarter"}] * 4,
            "slurs": [],
        }
        for number in (1, 2)
    ],
}


def synthetic_take(notes: int) -> bytes:
    """A WAV of the first `notes` of `_SCORE`, played in time.

    Struck tones with a second harmonic and a faded release, the same model as
    `fixtures/audio/make_synthetic.py`, so the detector finds one onset per
    note and the alignment has something to align.
    """
    import soundfile as sf

    beat = 60.0 / _BPM
    lead_in = 0.25
    ring = 0.4
    total = lead_in + notes * beat + ring
    y = np.zeros(int(total * _TAKE_RATE), dtype=np.float32)

    t = np.arange(int(ring * _TAKE_RATE)) / _TAKE_RATE
    envelope = np.exp(-t * 9.0)
    fade = int(0.04 * _TAKE_RATE)
    envelope[-fade:] *= 0.5 * (1 + np.cos(np.linspace(0, np.pi, fade)))
    tone = np.sin(2 * np.pi * 82.4 * t) + 0.3 * np.sin(2 * np.pi * 164.8 * t)
    note = (0.7 * envelope * tone).astype(np.float32)

    for index in range(notes):
        start = int((lead_in + index * beat) * _TAKE_RATE)
        y[start : start + note.size] += note[: y.size - start]

    buffer = io.BytesIO()
    sf.write(buffer, y, _TAKE_RATE, format="WAV", subtype="PCM_16")
    return buffer.getvalue()


#: Set on the thread running the warm-up takes, and only while it runs them.
_warming = threading.local()


class _QuietWhileWarming(logging.Filter):
    """Drop what the pipeline says about the warm-up's own takes.

    The one-note take is refused by design, and the pipeline says so at
    WARNING — "analysis: refused, quality=0.125" — which in the API's logs, at
    every boot, reads as a musician's take going wrong. Per thread, so a real
    take analysed alongside keeps every line it would have had. Errors still
    pass: a warm-up that breaks is worth hearing about.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        return not getattr(_warming, "active", False) or record.levelno >= logging.ERROR


log.addFilter(_QuietWhileWarming())


def warm_up() -> float:
    """Decode and analyse the three takes above. Returns seconds taken.

    The real `load_audio_bytes` and the real `analyze`, not a list of librosa
    calls: a list would be a second description of the pipeline, and the first
    librosa call someone added to the real one would be missing from it.
    """
    from app.services import audio as audio_svc
    from app.services.analysis import analyze
    from app.services.score_schema import ScoreJson

    started = time.perf_counter()
    score = ScoreJson.model_validate(_SCORE)
    _warming.active = True
    try:
        for notes in (_NOTES, _NOTES // 2, 1):
            y, sr = audio_svc.load_audio_bytes(synthetic_take(notes))
            analyze((y, sr), score, _BPM)
    finally:
        _warming.active = False
    return time.perf_counter() - started


_started = False
_lock = threading.Lock()


def warm_in_background() -> None:
    """Warm the pipeline on a thread of its own, once per process. Never raises.

    For the API, where analyses run in the web process: reading the cache back
    costs about as much CPU as a small request, and paying it at boot keeps it
    off the first take. A failure here costs nothing that was not already
    going to happen — that take compiles what it needs, as every take did
    before this existed.
    """
    global _started
    with _lock:
        if _started:
            return
        _started = True

    def run() -> None:
        try:
            seconds = warm_up()
        except Exception:  # noqa: BLE001 — a warm-up must never take the API down
            log.exception("analysis warm-up failed; the first take will compile instead")
            return
        log.info("analysis pipeline warm in %.1fs", seconds)

    threading.Thread(target=run, name="analysis-warmup", daemon=True).start()


def main() -> None:
    from app.logging_config import configure_logging

    configure_logging()
    seconds = warm_up()
    log.info("analysis pipeline compiled in %.1fs", seconds)


if __name__ == "__main__":
    main()

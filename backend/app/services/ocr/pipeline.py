"""Pipeline orchestration: try providers in order, fall through on failure.

Public API (re-exported by `app.services.ocr.__init__`):
- `parse_sheet_music(image_bytes, *, media_type, providers) -> ScoreJson`
- `OCRError` — raised when every provider in the chain fails.

Provider chain semantics:
- Each provider is called once per image. If it raises (validation,
  SDK error, etc.), the next provider is tried.
- A provider that returns a `ScoreJson` with `ocr_confidence >= 0.7`
  is the winner — pipeline returns immediately.
- A provider that returns a low-confidence result is remembered but
  not returned yet — we keep trying for someone better. If everyone
  else fails or also comes back low-confidence, the first parseable
  low-confidence result is returned (per spec §6 + Batch 2 — a
  parseable-but-uncertain parse beats nothing for the human-correction
  flow).
- Only when nothing parseable comes back do we raise `OCRError`.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Callable

from pydantic import ValidationError

from app.services.ocr.base import OCRProvider, OCRProviderError, OCRResponse
from app.services.ocr.claude_provider import (
    claude_opus_provider,
    claude_sonnet_provider,
)
from app.services.page_image import crop_systems
from app.services.ocr.validate import (
    TOLERANCE,
    beats_per_measure,
    numbering_gaps,
)
from app.services.ocr.validate import problems as beat_problems
from app.services.ocr.gemini_provider import (
    gemini_flash_provider,
    gemini_pro_provider,
)
from app.services.ocr.confirm import retry_with_arithmetic
from app.services.score_schema import (
    DURATION_BEATS,
    Measure,
    Repeat,
    ScoreJson,
    TempoChange,
)

log = logging.getLogger("intempo.ocr")

CONFIDENCE_THRESHOLD = 0.7


class OCRError(Exception):
    """Raised when every provider in the chain fails to produce a usable parse."""


class NoMusicFound(OCRError):
    """Every provider read the image and found no notes on it.

    Distinct from the general failure because it means something different for
    one crop of a page than for a page. A page with no notes on it is a failed
    read — `_read_any_music` exists because two real scans came back `done`
    with nothing on them. **A crop can legitimately hold no music**: the crops
    tile the whole photograph, so the first and last of them cover the page's
    margin, its title block, and whatever the page was lying on. Measured on
    the real page: twelve crops, ten holding one system each and the first and
    last holding the desk.

    A subclass rather than a flag, so a caller that does not know about it
    treats it exactly as the failure it is.
    """


# Built-in registry — bake-off and pipeline both look providers up here.
PROVIDER_REGISTRY: dict[str, OCRProvider] = {
    claude_sonnet_provider.name: claude_sonnet_provider,
    claude_opus_provider.name: claude_opus_provider,
    gemini_flash_provider.name: gemini_flash_provider,
    gemini_pro_provider.name: gemini_pro_provider,
}


def get_provider(name: str) -> OCRProvider:
    if name not in PROVIDER_REGISTRY:
        raise OCRError(
            f"unknown provider {name!r}; known: {sorted(PROVIDER_REGISTRY)}"
        )
    return PROVIDER_REGISTRY[name]


#: Names in `OCR_PROVIDER_CHAIN` that this build does not know.
#:
#: Read by `/v1/ready` so a stale name is *reported* rather than merely
#: survived. Recomputed on every `_default_chain()` call, because the setting
#: is read fresh each time.
unknown_provider_names: list[str] = []


def _default_chain() -> list[OCRProvider]:
    """The configured chain, minus any name this build has never heard of.

    **Skips rather than raises, and that is a deliberate reversal.** It used to
    raise, and the consequence was found the hard way: the shipped default read
    `claude-sonnet-4-6,claude-opus-4-7`, both names from the previous Claude
    generation, so the very first scan died with "unknown provider" and no page
    could be read whatever keys were set. One stale name in a list of three
    took down a feature that had two working models in it.

    A model being renamed is a fact of life and should cost that model, not the
    feature. What must not happen is losing it *silently*, so the names are
    logged at warning and kept in `unknown_provider_names` for `/v1/ready` to
    report. An empty result still raises — a chain with nothing usable in it is
    a configuration error with no fallback left.
    """
    # Read when called, not bound at import. This resolves configuration, and
    # a snapshot taken at import time is a different thing — true in production
    # where nothing reloads, and quietly wrong anywhere it does.
    from app.config import settings

    raw = settings.OCR_PROVIDER_CHAIN.strip()
    if not raw:
        return [claude_sonnet_provider, claude_opus_provider]

    names = [n.strip() for n in raw.split(",") if n.strip()]
    chain: list[OCRProvider] = []
    unknown: list[str] = []
    for name in names:
        if name in PROVIDER_REGISTRY:
            chain.append(PROVIDER_REGISTRY[name])
        else:
            unknown.append(name)

    unknown_provider_names[:] = unknown
    if unknown:
        log.warning(
            "OCR_PROVIDER_CHAIN names %s are not known to this build and were "
            "skipped; usable chain is %s",
            unknown,
            [p.name for p in chain] or "empty",
        )
    if not chain:
        raise OCRError(
            f"OCR_PROVIDER_CHAIN has no usable provider; unknown: {unknown}; "
            f"known: {sorted(PROVIDER_REGISTRY)}"
        )
    return chain


#: A step the pipeline actually took, reported as it happens.
#:
#: Every value is an event the pipeline observes, never an estimate of how far
#: through it is — there is no such number. The chain's length is known but a
#: provider's duration is not, and the second one is only reached when the
#: first has failed. Anything smoother than this would be invented.
Stage = str

STAGE_CONFIRMING = "rereading"
#: Reading with a named provider, e.g. `reading:claude-sonnet-4-6`.
STAGE_READING = "reading"
#: Cutting the page into its staff systems, before any of them is read.
#:
#: Reported because it is now a real step that takes real time — decoding a
#: 12-megapixel photograph, projecting it, and re-encoding a crop per system —
#: and because `TranscribingPanel` has had a position for "Finding the staves"
#: since the OMR engine that used to report it was removed. Nothing has emitted
#: it since. The pipeline genuinely finds staves now.
STAGE_SPLITTING = "splitting"



def _is_truncation(exc: Exception) -> bool:
    """Whether a provider failed by running out of output room.

    Matched on the providers' own phrase rather than an exception type, because
    both of them raise plain `OCRProviderError` and adding a subclass would put
    the knowledge in two places. `claude_provider` and `gemini_provider` both
    say "cut off"; that string is the contract and the tests hold all three to
    it.
    """
    return "cut off" in str(exc).lower()



def renumber(score: ScoreJson) -> ScoreJson:
    """Number the measures 1..N in the order they were read.

    **The program is better at this than a model and it is not close.** The
    numbers are positional — first bar on the page is 1 — so deriving them is
    counting, and counting is what a program does without ever having a bad
    minute. Asking for them instead bought the single most common failure this
    pipeline has: a boxed rehearsal mark reading **49** came back as measure
    **409**, which inserted an empty measure and renumbered the rest of the
    line.

    The anomaly is *reported before it is normalised*, not hidden by it.
    `numbering_gaps` is what catches a rehearsal mark being counted as a bar,
    and silently renumbering would destroy exactly that signal — the numbers
    would come out 1..N and look immaculate while a spurious measure sat in the
    middle of them. So the gap is logged and named in `notes_to_human`, and
    then the numbering is made positional.

    Deliberately not a no-op when the numbers already run 1..N: it must be safe
    to call on every reading, or it will not be called on the one that needed
    it.
    """
    gaps = numbering_gaps(score)
    if gaps:
        described = ", ".join(f"{g.after}→{g.next}" for g in gaps)
        log.info("measure numbers skip (%s); renumbering positionally", described)

    renumbered = [
        measure.model_copy(update={"measure_number": position})
        for position, measure in enumerate(score.measures, start=1)
    ]
    note = score.notes_to_human
    if gaps:
        gap_note = (
            f"The measure numbers read from the page skipped ({described}), which "
            "usually means a rehearsal mark was counted as a bar. They have been "
            "renumbered from 1 — check the bar count against your copy."
        )
        note = f"{note}\n{gap_note}".strip() if note else gap_note
    return score.model_copy(update={"measures": renumbered, "notes_to_human": note})


def _read_any_music(score: ScoreJson) -> bool:
    """Whether this transcription contains a single note.

    **A page with no notes on it is not a reading, and it used to count as
    one.** Measured against a real library: of six scans, two came back
    `done` — one with a single empty measure and one with four notes for a
    whole page — both at 0.2 confidence, and both were shown to the musician
    as a finished piece. The screen had nothing to draw, so it drew nothing.

    Nothing else in the loop catches it. The clef is present, so the clef check
    passes. A measure with no notes contradicts no time signature it can
    establish, so the beat check passes. The confidence is low, so it is kept
    as the fallback — and the fallback exists for a *bad* reading, which is
    better than none, not for an *absent* one, which is worse: it costs the
    musician the "try reading it again" they would otherwise be offered.
    """
    return any(measure.notes for measure in score.measures)


#: The most systems worth reading one at a time.
#:
#: **A bill ceiling, and nothing else any more.** It used to carry the argument
#: that beyond sixteen bands the detector had almost certainly split something
#: that is not a system. That job now belongs to `_cuts_are_quiet`, which asks
#: whether the page can be cut at all rather than counting how many times.
#:
#: Sixteen was too low, and the cost of being over it changed. Falling back
#: means reading the page whole, which on the one real page measured here is the
#: read that finds two systems out of ten. Meanwhile the crops **tile** the
#: photograph, so a page carries two bands the music does not — the margin above
#: the first system and below the last. Measured by pasting one fixture band
#: down a page at closing spacings, the detector tracks exactly: 7, 10, 11, 13,
#: 15 and 16 systems, never over-counting. A part with fifteen systems on it
#: therefore produces seventeen bands and, at the old ceiling, silently went
#: back to the read that does not work.
#:
#: Twenty-four covers any single-staff part that is still legible on one sheet,
#: with both margins, and bounds a pathological detection — a photograph of
#: something that is not music at all — at twenty-four calls.
_MAX_SYSTEMS_TO_READ = 24

#: How many systems are read at the same time.
#:
#: **A latency fix for a bug that was never about speed, and then became
#: about speed.** `run_transcription` runs in `BackgroundTasks`, which is to
#: say in the web process, so anything that ends the process ends the read —
#: and the one that actually happened is a free-tier instance spinning down
#: after fifteen minutes idle, which is exactly what leaving the screen brings
#: about, because the polling that was keeping it awake stops with you. Reading
#: twelve systems one after another turns a thirty-second job into five
#: minutes, which is an order of magnitude more time to be interrupted in.
#:
#: **Four, not twelve.** The ceiling is the provider's rate limit, not memory:
#: a prepared crop is a couple of hundred kilobytes, so twelve in flight is
#: nothing next to the ~81 MB the page decode already costs. Twelve
#: simultaneous vision calls from one scan is how a rate limit is reached, and
#: a rate limit on one system discards every other system's work — the page
#: falls back to being read whole. Four is enough to cut a five-minute read to
#: about a minute while leaving room for other people's scans in the same
#: token bucket.
_SYSTEMS_AT_ONCE = 4


def _one_system_note(index: int, total: int) -> str:
    """What the shared prompt cannot know: this image is one line of a page.

    The prompt is written for a page — "read the page straight through, top to
    bottom, once", "the header field is the metre the piece *starts* in", a
    token budget argued from "well over a hundred notes". Handed a single
    system, every one of those framings is either wrong or over-cautious, and
    the model has no way to tell. `OCRProvider.parse` already takes a `note`
    for exactly this: a second question of the same page without a second
    prompt file drifting away from the first.

    The index is in it because line one *is* the top of the page and lines two
    onward are not, and that difference decides what a time signature printed
    at the left edge means.
    """
    return (
        f"ADDITIONAL CONTEXT: this image is ONE SYSTEM — line {index} of "
        f"{total} — cut out of a larger page. It is not the whole piece.\n"
        "\n"
        "- The crop is padded, so it may show a sliver of the staff above or "
        "below: a row of notehead tips, the ends of some stems, part of a "
        "barline. Read ONLY the complete staff in the middle. A bar picked up "
        "from a neighbouring line is read twice, once here and once when that "
        "line is read, and the page ends up longer than the music.\n"
        "- Read every bar on this line. There are only a handful, so there is "
        "room to look at each one properly — that is the entire reason the "
        "page was cut up. A whole page asked for four hundred notes in one "
        "answer and came back with a hundred.\n"
        "- Number this line's measures 1, 2, 3 … The program joins the lines "
        "in order and renumbers the whole page afterwards, so these numbers "
        "only have to be in order within this line.\n"
        "- A clef, key signature or time signature printed at the start of "
        "this line goes in the header fields as usual. The program decides "
        "whether it is the page's own header or a change of metre partway "
        "down — you cannot tell that from one line and are not being asked "
        "to.\n"
        "- If this line does not print a time signature or key signature, "
        "answer \"unknown\" for it. Do not work one out from the bars. The "
        "program checks a stated metre against what the bars add up to, so a "
        "guess that happens to fit is indistinguishable from a real change of "
        "metre and will be written into the score as one.\n"
        "- \"notes_to_human\" is about this line only."
    )


def _fits_better(measures: list[Measure], stated: float, running: float | None) -> bool:
    """Do these bars add up to `stated` more often than to `running`?

    The arbiter for whether a metre printed at the top of a line is a real
    change or a model's guess, and it is arithmetic rather than judgement for
    the same reason `confirm.retry_with_arithmetic` is: the durations are
    already on the page, so the metre that more of them add up to is the metre
    that was printed. A measure the model could not read holds no notes, sums
    to zero and so votes for neither.

    **Strictly better, and a tie is not a draw.** The metre already running is
    the one the page has been printing for however many lines; a line whose
    bars split evenly between two metres is a line that does not say, and
    switching on it hands the rest of the page to a metre half of one system
    voted for.
    """
    sums = [
        sum(DURATION_BEATS[note.duration] for note in measure.notes)
        for measure in measures
    ]
    if not sums:
        return False

    def fits(beats: float | None) -> int:
        if beats is None:
            return 0
        return sum(1 for total in sums if abs(total - beats) <= TOLERANCE)

    return fits(stated) > fits(running)


def _restate_meter_changes(parts: list[ScoreJson]) -> list[ScoreJson]:
    """A metre printed at the top of a *later* system is a change of metre.

    **This is the cost of reading a page one line at a time.** A model handed
    one system cannot know whether it is the first, so a 3/4 printed where the
    music changes to 3/4 comes back in that system's *header* field — exactly
    where the header of the page belongs. `_combine` keeps the first header and
    would drop it, and the page would be checked against its opening metre all
    the way to the last bar. The prompt's own rule says what happens then:
    "every bar after an unreported change is reported to the musician as having
    the wrong number of beats, on a page that is written and read correctly,
    with a control offered to 'fix' each one." Reading the page whole never had
    this problem, because a model that can see the whole page knows which
    metre is the first one.

    So a stated metre that differs from the one running into that system is
    moved onto the system's first measure, which is where `meters_in_force`
    reads changes from — but **only when the bars agree**. A model asked for a
    metre will often supply one whether or not the line prints it, and a guess
    promoted to a metre change is worse than a dropped one: it invalidates a
    correct reading from that bar onwards. `_fits_better` is the gate.

    Nothing is moved when the system states a metre on **any** of its measures.
    That means the model saw a change printed mid-line and reported it the
    documented way, and its header is then just the metre it read somewhere on
    the line — writing that onto the first bar puts the change a bar or two
    early and calls the bars in between wrong. The guard used to be "the first
    measure states nothing", which lets exactly that through.

    Nothing is moved for the first metre anyone states, either — there is
    nothing for it to be a change *from*, so it is the page's header and
    `_combine` picks it up. This is the ordinary case for a photograph that
    cuts the top of the page off.
    """
    out: list[ScoreJson] = []
    running: float | None = None

    for part in parts:
        stated = beats_per_measure(part.time_signature)
        if stated is not None and stated != running:
            if running is None:
                running = stated
            elif (
                part.measures
                and all(m.time_signature is None for m in part.measures)
                and _fits_better(part.measures, stated, running)
            ):
                head = part.measures[0].model_copy(
                    update={"time_signature": part.time_signature}
                )
                part = part.model_copy(update={"measures": [head, *part.measures[1:]]})
                running = stated

        # Advance through the changes this system states on its own measures,
        # mirroring `meters_in_force` exactly — including that an "unknown"
        # metre on a measure clears the running one rather than continuing it.
        for measure in part.measures:
            if measure.time_signature is not None:
                running = beats_per_measure(measure.time_signature)

        out.append(part)

    return out


def _combine(parts: list[ScoreJson]) -> ScoreJson:
    """Several systems' transcriptions, joined into one page.

    **Measure numbers are the whole job.** Each system comes back numbered from
    one, and `repeats` and `tempo_changes` point at those numbers — so joining
    without shifting them would attach a `rit.` printed in the last system to
    the second bar of the piece. `renumber` fixes the measures themselves and
    would say nothing about the two lists that reference them.

    The header is taken from the first system that states one, because that is
    where a page prints it: the clef and metre appear on system one and are not
    repeated. Later systems answering `None` are not disagreeing, they are
    reading a line that does not say.

    Confidence is the **lowest** of the systems, not the mean. The page is a
    single thing to the musician, and one line the reader was unsure of is a
    line of wrong notes wherever it sits — averaging it against nine confident
    ones hides exactly the page that most needs checking.

    A later system that states a *different* metre is not disagreeing about the
    header either — it is reading a change of metre it has no way to recognise
    as one, because it cannot see that it is not the first line. See
    `_restate_meter_changes`, which runs first.
    """
    parts = _restate_meter_changes(parts)

    measures: list[Measure] = []
    repeats: list[Repeat] = []
    tempo_changes: list[TempoChange] = []
    offset = 0

    for part in parts:
        for measure in part.measures:
            measures.append(measure.model_copy(update={"measure_number": len(measures) + 1}))
        for repeat in part.repeats:
            repeats.append(
                repeat.model_copy(
                    update={
                        "start_measure": repeat.start_measure + offset,
                        "end_measure": repeat.end_measure + offset,
                    }
                )
            )
        for change in part.tempo_changes:
            tempo_changes.append(
                change.model_copy(update={"measure_number": change.measure_number + offset})
            )
        offset += len(part.measures)

    def first(attribute: str):
        for part in parts:
            value = getattr(part, attribute)
            if value and value != "unknown":
                return value
        return None

    return parts[0].model_copy(
        update={
            "measures": measures,
            "repeats": repeats,
            "tempo_changes": tempo_changes,
            "clef": first("clef"),
            "time_signature": first("time_signature"),
            "key_signature": first("key_signature"),
            "tempo_marking": first("tempo_marking"),
            "bpm_hint": first("bpm_hint"),
            "ocr_confidence": min(part.ocr_confidence for part in parts),
        }
    )


def _read_systems(
    crops: list[bytes],
    chain: list[OCRProvider],
    *,
    retry: bool,
    stage: Callable[[Stage], None],
) -> list[ScoreJson]:
    """Read every crop and return them in page order, or nothing at all.

    **Concurrent, because sequential turned a thirty-second read into five
    minutes** and the failure this pipeline was fixing is a read being
    interrupted — see `_SYSTEMS_AT_ONCE`.

    **Nothing at all, on any failure.** A page transcribed with one system of
    ten missing is the worst outcome available: `alignment.py` accumulates
    durations, so a missing line shifts every bar after it and the musician is
    told they rushed a passage they played correctly. An empty list sends the
    page through the whole-page loop, which is merely *worse at reading*. The
    futures that have not started are cancelled, so a page that fails on its
    first system does not pay for the other nine.

    Progress is reported from **this** thread, counting completions, so the
    reports stay single-threaded and monotonic. The crops' own internal stages
    are not forwarded: they would arrive from four threads at once, and
    "checking the bar counts" for one line would walk the bar backwards while
    three other lines are still being read.

    **On failure this still waits for the systems already in flight**, because
    leaving the pool to finish in the background would have five vision calls
    out at once from one scan while the fallback reads the page whole — which
    is how a rate limit is reached, and a rate limit is the likeliest reason it
    got here. The cost is bounded by one system's duration, paid on a page
    that is falling back anyway.
    """
    total = len(crops)
    results: list[ScoreJson | None] = [None] * total
    done = 0

    with ThreadPoolExecutor(
        max_workers=min(_SYSTEMS_AT_ONCE, total), thread_name_prefix="system"
    ) as pool:
        pending = {
            pool.submit(
                parse_sheet_music,
                crop,
                media_type="image/jpeg",
                providers=chain,
                retry=retry,
                on_stage=None,
                _by_system=False,
                _note=_one_system_note(index + 1, total),
            ): index
            for index, crop in enumerate(crops)
        }
        for future in as_completed(pending):
            index = pending[future]
            try:
                results[index] = future.result()
            except NoMusicFound as exc:
                # The crops tile the whole photograph, so the first and last of
                # them cover the page's margin, its title block and whatever
                # the page was lying on. Measured on the real page: twelve
                # crops, the first holding the desk above the sheet and the
                # last a sliver below the final system. Neither is a failure,
                # and treating them as one sent the whole page back to be read
                # whole — the fallback firing on every photograph that has any
                # edge in shot, which is nearly all of them.
                #
                # **Only the first and last.** An interior crop has music above
                # it and music below it, so one that comes back with no notes is
                # a read that failed, and accepting it would put a hole in the
                # page — which shifts every bar after it against the recording.
                if index in (0, total - 1):
                    log.info(
                        "crop %d of %d holds no music, which is what the edge of "
                        "a page looks like; carrying on",
                        index + 1, total,
                    )
                    results[index] = None
                else:
                    log.info(
                        "system %d of %d holds no music but is not at the edge "
                        "of the page (%s); reading the page whole",
                        index + 1, total, exc,
                    )
                    for other in pending:
                        other.cancel()
                    return []
            except Exception as exc:  # noqa: BLE001 — any failure falls back
                log.info(
                    "system %d of %d could not be read (%s: %s); "
                    "reading the page whole",
                    index + 1, total, type(exc).__name__, exc,
                )
                for other in pending:
                    other.cancel()
                return []
            done += 1
            stage(f"{STAGE_READING}:system {done} of {total}")

    return [part for part in results if part is not None]


def parse_sheet_music(
    image_bytes: bytes,
    *,
    media_type: str = "image/jpeg",
    providers: list[OCRProvider] | None = None,
    retry: bool = True,
    on_stage: Callable[[Stage], None] | None = None,
    source: bytes | None = None,
    _by_system: bool = True,
    _note: str | None = None,
) -> ScoreJson:
    """Run the image through the configured provider chain.

    `retry=False` turns off the arithmetic re-read, for tests and for callers
    that want a single pass.

    There is one image and one chain. An `engine_bytes` parameter used to sit
    here, carrying the same page prepared at 2048px for Audiveris rather than at
    the 1568px a vision model is served — the engine reported "interline value
    of 10 pixels … resolution is too low" and read nothing at the smaller size.
    Both the parameter and the engine went with the OMR removal (DECISIONS.md,
    2026-08-25); the second opinion it fed is now `confirm.retry_with_arithmetic`,
    which has a model on both sides and needs no second copy of the page.

    `source` is the photograph as it arrived, before `prepare_for_model`
    squeezed it onto a 1568 px edge. Systems are detected on `image_bytes` —
    cheap, and every constant in the detector was measured at that scale — but
    the crops are cut from `source`, so each system gets the whole size budget
    on its own long edge instead of a slice of the page's. Measured on the real
    page: 1568×220 per system instead of 1176×165, which is 1.8× the pixels and
    fourteen pixels between staff lines instead of ten. Omitting it cuts the
    crops out of the reduced page, which is what happened until it existed and
    which throws away the entire reason for cutting the page up.

    `on_stage` is called as each step begins, for a caller that has to tell a
    human what is happening — this takes tens of seconds and a musician
    watching a spinner cannot tell it apart from a hang. It is advisory: a
    callback that raises must not lose a transcription that succeeded, so it is
    called defensively.
    """
    chain = providers if providers is not None else _default_chain()
    if not chain:
        raise OCRError("provider chain is empty")

    def stage(name: Stage) -> None:
        if on_stage is None:
            return
        try:
            on_stage(name)
        except Exception:  # noqa: BLE001 — reporting must never break reading
            log.warning("stage callback failed for %s", name, exc_info=True)

    # A transcription whose bars do not add up is *known* to be wrong — no
    # judgement, just arithmetic — and it is wrong in the way that matters
    # most, because `alignment.py` accumulates durations to build its expected
    # timeline and one bad bar shifts every bar after it.
    #
    # So instead of shrugging and keeping it as a low-confidence fallback, the
    # model is handed its own arithmetic back with the offending measures named
    # and asked to re-read those. See `confirm.py` for why a correction is
    # taken only when it is not worse.
    #
    # This replaced an OMR second opinion, which read the page with Audiveris
    # and asked a model to check it. The engine needed a 2 GB host to find
    # fewer measures than the model already found; the shape of the step was
    # right and survives here with a model on both sides.

    failures: list[str] = []
    # **First** in the chain, not highest-scoring, and deliberately so — this
    # was called `best_low_confidence`, which implied a comparison that would
    # be meaningless. `ocr_confidence` is each model's own estimate of its own
    # work; a 0.5 from one provider and a 0.4 from another are not the same
    # quantity and ranking them would be reading a number that does not exist.
    # One system at a time, when the page has more than one on it.
    #
    # **Because of how much is being asked for in one answer, not how many
    # pixels there are.** A real scan came back with 59 measures and 112 notes
    # — under two a bar — having found every system and every barline, then
    # stopped normally well inside a 16,000-token budget. A fixture in this
    # repository asks for about thirty notes; a page asks for four hundred.
    #
    # **Never worse than reading it whole.** If any system cannot be read, the
    # whole attempt is discarded and the page goes through the loop below
    # exactly as before. A page missing one system out of ten is the worst
    # outcome available: `alignment.py` accumulates durations, so a missing
    # line shifts every bar after it and the musician is told they rushed a
    # passage they played correctly.
    if _by_system:
        stage(STAGE_SPLITTING)
        crops = crop_systems(image_bytes, source=source)
        if crops and len(crops) <= _MAX_SYSTEMS_TO_READ:
            parts = _read_systems(crops, chain, retry=retry, stage=stage)
            if parts:
                combined = _combine(parts)
                log.info(
                    "read %d systems separately: %d measures, %d notes",
                    len(parts),
                    len(combined.measures),
                    sum(len(m.notes) for m in combined.measures),
                )
                return combined
        elif len(crops) > _MAX_SYSTEMS_TO_READ:
            log.info(
                "found %d systems, which is more than a page has; reading it whole",
                len(crops),
            )

    # The chain order encodes which provider is trusted more, so the first one
    # to produce anything usable is the one to keep.
    first_low_confidence: ScoreJson | None = None
    first_low_confidence_from: str | None = None

    for provider in chain:
        try:
            stage(f"{STAGE_READING}:{provider.name}")
            response: OCRResponse = provider.parse(
                image_bytes, mime_type=media_type, note=_note
            )
            # Before the beat check, the retry or the confidence gate look at
            # it: everything downstream keys off measure numbers, and the
            # program can derive them more reliably than a model can read them.
            response = response.model_copy(update={"score": renumber(response.score)})
        except (ValidationError, OCRProviderError, ValueError) as exc:
            failures.append(f"{provider.name}: {type(exc).__name__}: {exc}")
            if _is_truncation(exc):
                # Stop, rather than fall through. Running out of room is a
                # property of the *page*, not of the provider: the next one is
                # asked the identical question about the identical image and
                # stops in the same place. Falling through bought a second
                # full-price failure and an identical error message, and this
                # is the failure mode of a long page, which is exactly when
                # the response was most expensive to begin with.
                log.info("%s ran out of room; the rest of the chain would too", provider.name)
                break
            continue

        if response.score.clef is None:
            # `ScoreJson.clef` is optional so a score can exist before it has
            # been read. A provider answering without one has not read it
            # either, and the next provider deserves the page.
            failures.append(f"{provider.name}: no clef")
            log.info("%s: returned no clef, trying the next provider", provider.name)
            continue

        if not _read_any_music(response.score):
            # Not a page this provider read badly — a page it did not read.
            # Handing it on costs another call; accepting it costs the musician
            # the piece, because a score with no notes cannot be corrected,
            # practised against or told apart from a scan that never ran.
            failures.append(f"{provider.name}: no notes")
            log.info(
                "%s: returned %d measure(s) and no notes, trying the next provider",
                provider.name,
                len(response.score.measures),
            )
            continue

        # Arithmetic before self-assessment.
        #
        # `ocr_confidence` is the model marking its own homework, and the
        # bake-off shows how little that is worth: on the handwritten fixture
        # one provider reported 0.90 and the other 0.32 for the same page, and
        # the confident one is first in the shipped chain — so it clears the
        # threshold, returns, and the second opinion is never asked for.
        #
        # Whether the durations in a measure add up to the time signature is
        # not an opinion. A transcription that contradicts itself is wrong no
        # matter how sure the model is, and it is wrong in the way that matters
        # most: `alignment.py` builds its whole expected timeline from those
        # durations, so one bad measure desynchronises every measure after it.
        broken = beat_problems(response.score)
        if broken:
            failures.append(
                f"{provider.name}: {len(broken)} measure(s) do not add up "
                f"({', '.join(str(f.measure_number) for f in broken)})"
            )
            log.info(
                "%s: transcription does not add up, trying the next provider: %s",
                provider.name,
                "; ".join(f.describe() for f in broken),
            )
            if retry:
                stage(STAGE_CONFIRMING)
                corrected = retry_with_arithmetic(
                    response.score,
                    image_bytes,
                    media_type=media_type,
                    provider=provider,
                    context=_note,
                )
                if not beat_problems(corrected):
                    return corrected
                # Still broken, but possibly less so — keep the better of the
                # two as the fallback rather than the one we started with.
                response = response.model_copy(update={"score": corrected})

            # Kept as a fallback, exactly like a low-confidence result: a
            # transcription with a bad measure is still better than none for
            # the human-correction flow, and refusing outright would make a
            # single mis-read note lose the whole page.
            if first_low_confidence is None:
                first_low_confidence = response.score
                first_low_confidence_from = provider.name
            continue

        if response.score.ocr_confidence >= CONFIDENCE_THRESHOLD:
            return response.score

        failures.append(
            f"{provider.name}: low confidence {response.score.ocr_confidence:.2f}"
        )
        if first_low_confidence is None:
            first_low_confidence = response.score
            first_low_confidence_from = provider.name

    if first_low_confidence is not None:
        # Which provider's transcription the musician is about to be shown and
        # asked to correct. The name was being tracked and then dropped, so
        # nothing anywhere recorded whose reading of the page this was.
        log.info(
            "returning low-confidence transcription from %s (confidence %.2f); tried: %s",
            first_low_confidence_from,
            first_low_confidence.ocr_confidence,
            "; ".join(failures),
        )
        return first_low_confidence

    # "Nothing on it" is not the same answer as "could not read it", and only
    # the caller cutting a page into crops can tell whether that matters.
    if failures and all(reason.endswith(": no notes") for reason in failures):
        raise NoMusicFound("no notes found: " + "; ".join(failures))
    raise OCRError("all providers failed: " + "; ".join(failures))

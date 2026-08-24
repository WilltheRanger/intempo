"""A page too small to read the notation from.

**Reported as "the scan made something up."** A musician photographed an
orchestral contrabass part with a laptop webcam. It arrived as a 480x640 PNG,
and every stage that looked at it succeeded: `_bands` found the page's eight
systems, because it finds them by ink density and a row of notation is dense at
any size; `crop_systems` cut all eight; the providers were handed them and
returned a transcription. Its confidence was 0.40 and its own `notes_to_human`
called it "approximate reconstructions", and the app showed it as their score.

Nothing in the pipeline could tell that page from a good one, because at every
stage that looked, it *was* one. What it had stopped having was five
distinguishable staff lines — and until this, nothing measured those.

The floor is measured rather than picked; the table is on `_MIN_STAFF_SPACE_PX`
and in `EDIT_LOG.md`, 2026-08-24.
"""

from __future__ import annotations

import io

import pytest
from pathlib import Path

from app.services.page_image import (
    _MIN_STAFF_PERIOD,
    _STAFF_PERIOD_STRENGTH,
    _MIN_STAFF_SPACE_PX,
    _band_staff_space,
    _representative_spacing,
    staff_space_px,
    too_small_to_read,
)

pytest.importorskip("PIL")


FIXTURES = Path(__file__).resolve().parents[3] / "fixtures" / "scores"

#: A real page that reads correctly today. Measures 11 px.
READABLE = FIXTURES / "01_simple_printed.jpg"


def _scaled(path: Path, factor: float) -> bytes:
    """A real page of notation, resampled by a known factor.

    Synthetic staves were the first attempt and were the wrong subject: a
    generator's realism is exactly the thing under test, so a page it draws
    proves whatever the generator happens to do. Scaling a photograph that the
    pipeline reads correctly today gives ground truth for free — the spacing
    must come out at `factor` times the original — and it is the same
    operation a camera performs by standing further away.
    """
    from PIL import Image

    with Image.open(io.BytesIO(path.read_bytes())) as image:
        resized = image.resize(
            (max(1, round(image.width * factor)), max(1, round(image.height * factor))),
            Image.Resampling.LANCZOS,
        )
        buffer = io.BytesIO()
        resized.convert("RGB").save(buffer, format="JPEG", quality=92)
        return buffer.getvalue()


def test_it_measures_the_spacing_it_was_drawn_at() -> None:
    """The measurement has to be right before the threshold means anything.

    Halve a page and its staff lines are half as far apart. Nothing about the
    notation changes, so if the measurement tracks the scale factor it is
    measuring the ruling and not something incidental.
    """
    full = staff_space_px(READABLE.read_bytes())
    assert full is not None and full >= _MIN_STAFF_SPACE_PX, (
        f"the reference fixture measures {full}; it is supposed to be a page "
        "that reads"
    )

    for factor in (0.75, 0.5):
        measured = staff_space_px(_scaled(READABLE, factor))
        assert measured is not None, f"no staff period found at {factor}x"
        assert abs(measured - full * factor) <= 1.5, (
            f"{factor}x of a {full} px page measured {measured}"
        )


def _stacked_page(copies: int = 8) -> bytes:
    """A multi-system page, built from the single-system strips in `fixtures/`.

    The corpus is all one-system strips, and a strip is the one shape where
    the staff-fits-inside-its-band cap cannot matter — there is only one band
    and it is the whole page. The page that provoked all this had eight
    systems, and cannot be checked in: it is a copyrighted critical edition.

    Stacking the strips gives the same shape out of material that is already
    here, with real notation on it.
    """
    from PIL import Image

    strips = [
        Image.open(io.BytesIO(path.read_bytes())).convert("RGB")
        for path in sorted(FIXTURES.glob("0[1-4]*.jpg"))
    ]
    assert strips, "no fixture strips to stack"
    chosen = [strips[i % len(strips)] for i in range(copies)]

    width = max(s.width for s in chosen)
    margin = 40
    height = sum(s.height + margin for s in chosen) + margin
    page = Image.new("RGB", (width, height), "white")
    y = margin
    for strip in chosen:
        page.paste(strip, (0, y))
        y += strip.height + margin

    buffer = io.BytesIO()
    page.save(buffer, format="JPEG", quality=92)
    return buffer.getvalue()


def test_a_multi_system_page_reads_at_full_size() -> None:
    """The control for the next test: stacking the strips must not, by itself,
    make the page unreadable."""
    assert too_small_to_read(_stacked_page()) is None


def test_a_band_may_not_report_a_staff_taller_than_the_band_it_is_in() -> None:
    """The cap, and the reason there is one.

    Scaled to a webcam's resolution, the real page's bands reported a
    confident period of 28 rows — which would put a five-line staff 112 rows
    tall inside a band about 80 rows tall. Impossible, and that single
    spurious value was enough for the median to clear the floor and let a page
    with no resolvable notation through to the models.

    So a period is only believed when the four spaces it implies fit inside
    the band the lines were found in.
    """
    from PIL import Image

    big = Image.open(io.BytesIO(_stacked_page()))
    small = big.resize((480, round(big.height * 480 / big.width)), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    small.convert("RGB").save(buffer, format="JPEG", quality=92)
    page = buffer.getvalue()

    measured = staff_space_px(page)
    if measured is not None:
        # Whatever survived must at least be physically possible for a page
        # this size: eight systems of five lines cannot each be that tall.
        assert measured * 4 * 8 <= small.height, (
            f"reported a {measured} px staff space on a {small.height} px page "
            "with eight systems — the staves would not fit on it"
        )
        assert measured < _MIN_STAFF_SPACE_PX

    assert too_small_to_read(page) is not None, (
        "a webcam-resolution page of eight systems was accepted"
    )


def test_a_page_that_reads_today_is_not_refused() -> None:
    assert too_small_to_read(READABLE.read_bytes()) is None


def test_the_same_page_photographed_from_further_away_is_refused() -> None:
    """The failure, reproduced on a page known to be good. Nothing about the
    notation changed — only how many pixels it was captured with."""
    reason = too_small_to_read(_scaled(READABLE, 0.4))

    assert reason is not None, "a page with unresolvable staff lines was accepted"
    assert "too small" in reason.lower() or "staff lines" in reason.lower()


def test_the_refusal_says_how_small_and_how_small_is_enough() -> None:
    """"Too small" alone leaves someone re-shooting at random. The two numbers
    are what turn it into an instruction."""
    reason = too_small_to_read(_scaled(READABLE, 0.5)) or ""

    assert str(_MIN_STAFF_SPACE_PX) in reason, (
        f"the refusal does not say what is needed: {reason!r}"
    )


def test_a_page_whose_lines_cannot_be_resolved_at_all_is_refused() -> None:
    """The webcam case. Scaled this far there is no periodic ruling left for
    any band to report, so the measurement returns nothing rather than
    something small — and returning nothing must refuse, not pass."""
    page = _scaled(READABLE, 0.2)

    assert staff_space_px(page) is None, "expected no measurable staff period"
    reason = too_small_to_read(page)
    assert reason is not None, "a page with no resolvable staff lines was accepted"
    assert "staff lines" in reason.lower()


def test_the_advice_names_a_route_this_app_actually_has() -> None:
    """The lesson from the 413 message, which sent people to a camera setting
    that does not exist and a file importer that refuses JPEGs. A phone
    photograph, imported, is a real route and is how the pages that read got
    here."""
    reason = (too_small_to_read(_scaled(READABLE, 0.5)) or "") + (
        too_small_to_read(_scaled(READABLE, 0.2)) or ""
    )

    assert "phone" in reason.lower()
    assert "setting" not in reason.lower()


def test_the_quietest_real_staff_in_the_corpus_is_still_believed() -> None:
    """The false refusal this check shipped with, caught by the full suite.

    `04_handwritten_clean` at phone resolution reads correctly through the
    whole pipeline, and was refused: handwriting puts far more of a system's
    ink outside the five lines than engraving does, so its ruling is a quieter
    part of the signal — a correlation of 0.136 against 0.38–0.75 for the
    printed fixtures — without being any less present.

    It is the weakest true signal available, so it is the one worth pinning.
    Refusing a page the pipeline reads takes a working scan away, which is a
    worse bug than the one this check exists to fix.
    """
    from app.tests.test_scan_end_to_end import _phone_photo

    page = _phone_photo(FIXTURES / "04_handwritten_clean.jpg")

    measured = staff_space_px(page)
    assert measured is not None, "the quietest real staff in the corpus was not found"
    assert too_small_to_read(page) is None


def test_every_fixture_at_phone_resolution_is_readable() -> None:
    """All five, including `05_handwritten_messy` — which is below the floor at
    its native 1200 px and above it once blown up to what a phone produces.
    That is not a contradiction, it is the whole point: the same music
    photographed with more pixels is readable."""
    from app.tests.test_scan_end_to_end import _phone_photo

    for fixture in sorted(FIXTURES.glob("0*.jpg")):
        page = _phone_photo(fixture)
        assert too_small_to_read(page) is None, (
            f"{fixture.stem} at phone resolution was refused"
        )


# ---- what it must NOT refuse ----------------------------------------------


def test_an_undecodable_page_is_not_called_small() -> None:
    """It is a different failure with a different remedy. `prepare_for_model`
    passes bytes it cannot decode through untouched so the provider refuses
    them by name, and a confident wrong reason is worse than none — this
    project has been here with "a flatter, better-lit shot usually fixes it"."""
    assert too_small_to_read(b"\x89PNG\r\n\x1a\n") is None
    assert too_small_to_read(b"") is None


def test_a_blank_page_is_not_called_small() -> None:
    """No ink is not a resolution problem, and the reader's own "nothing was
    read from this page" is the better sentence."""
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (1200, 1600), "white").save(buffer, format="PNG")

    assert too_small_to_read(buffer.getvalue()) is None


def test_every_readable_fixture_in_the_repository_survives() -> None:
    """The regression that matters. Refusing a page the pipeline can read is a
    worse bug than the one being fixed — it takes a working scan away.

    `05_handwritten_messy.jpg` is excluded and is the reason the floor is
    where it is: it measures 5 px and yields **zero** measures, so it is the
    corpus's own example of a page too small to read.
    """
    pages = sorted(p for p in FIXTURES.glob("*.jpg") if "messy" not in p.name)
    assert pages, f"no fixture pages found under {FIXTURES}"

    for page in pages:
        assert too_small_to_read(page.read_bytes()) is None, (
            f"{page.name} reads correctly today and would now be refused"
        )


def test_the_corpus_page_that_yields_nothing_is_the_one_below_the_floor() -> None:
    """`05_handwritten_messy.jpg` produces zero measures through the whole
    pipeline. It is the only fixture under the floor, which is what makes the
    floor a measurement rather than a preference."""
    messy = FIXTURES / "05_handwritten_messy.jpg"
    if not messy.exists():  # pragma: no cover — it is checked in
        pytest.skip("fixture removed")

    assert too_small_to_read(messy.read_bytes()) is not None


# ---- the check has to actually run, in the path that reads a page ----------


def test_the_runner_refuses_before_it_spends_a_provider_call(monkeypatch) -> None:
    """A measurement nobody calls prevents nothing.

    This is the whole failure end to end: a page arrives too small to read,
    and either the providers are asked (and invent something), or they are
    not. Everything above is about getting the measurement right; this is
    about it being consulted.
    """
    from app.tests.fake_supabase import FakeSupabase
    from app.workers import transcription_runner as runner

    score_id = "11111111-1111-1111-1111-111111111111"
    fake = FakeSupabase()
    fake.seed(
        "scores",
        [
            {
                "id": score_id,
                "source_image_url": "https://example.test/page.jpg",
                "transcription_status": "queued",
                "transcription_stage": None,
                "transcription_error": None,
                "score_json": {},
            }
        ],
    )

    asked = []
    monkeypatch.setattr(runner, "get_service_client", lambda: fake)
    monkeypatch.setattr(runner, "readable_url", lambda url: url)
    monkeypatch.setattr(runner, "download_image", lambda url: _scaled(READABLE, 0.2))
    monkeypatch.setattr(
        runner,
        "parse_sheet_music",
        lambda *a, **k: asked.append(1) or (_ for _ in ()).throw(AssertionError("read")),
    )

    runner.run_transcription(score_id)

    assert asked == [], "the page went to a provider anyway"
    row = fake.table("scores").rows[0]
    assert row["transcription_status"] == "failed"
    assert "staff lines" in (row["transcription_error"] or "").lower()


# ---- the rules themselves, on the arrays they are rules about --------------
#
# These are unit tests because the rules are one-dimensional, and because the
# page that proves each of them matters is a copyrighted critical edition that
# cannot be checked in. Each was found by mutating the rule away and watching
# every image-level test still pass.


def _ruled(period: int, rows: int, *, strength: float = 1.0) -> list[float]:
    """An ink profile with lines every `period` rows."""
    return [strength if row % period == 0 else 0.0 for row in range(rows)]


def test_a_band_may_not_report_a_staff_that_would_not_fit_in_it() -> None:
    """The cap, and the measurement that says it is load-bearing.

    On the real page — a contrabass part photographed with a laptop webcam,
    480x640 — removing this cap changes `staff_space_px` from **None to 28**,
    and the verdict from refused to read. A 28-row staff space puts five lines
    across 112 rows inside a band about 80 rows tall, which is impossible; the
    single spurious value was all it took to clear the floor and send a page
    with no readable notation to the models.
    """
    # A band of 60 rows. A period of 20 would need 80 rows of staff to be real.
    band = _ruled(20, 60)

    assert _band_staff_space(band) is None, (
        "reported a staff space whose five lines do not fit in the band"
    )


def test_a_period_that_does_fit_is_reported() -> None:
    """The cap has to be able to pass, or it is just a rejection."""
    assert _band_staff_space(_ruled(10, 200)) == 10


def test_a_period_of_a_pixel_or_two_is_noise_not_a_staff() -> None:
    """JPEG ringing and the halftone of a printed page are both periodic at
    two or three rows. Believing them reports a staff space no page has and
    passes anything."""
    assert _MIN_STAFF_PERIOD >= 3
    # Not None — a period-2 signal is genuinely periodic at 4 as well, and the
    # rule is not "reject noise", it is "never report a period below this".
    # What matters downstream is that neither can clear the legibility floor.
    for noise in (_ruled(1, 200), _ruled(2, 200)):
        reported = _band_staff_space(noise)
        assert reported is None or reported >= _MIN_STAFF_PERIOD
        assert reported is None or reported < _MIN_STAFF_SPACE_PX


def test_a_periodicity_too_faint_to_be_ruling_is_not_believed() -> None:
    """The cutoff has a lower bound as well as an upper one.

    Five ruled lines are a strong periodic signal — 0.38 to 0.75 on the printed
    fixtures, and 0.136 on the quietest handwritten one. A page's incidental
    structure is not: the title and desk bands of the real page report 0.074
    and 0.082. Believing those turns anything with faint regularity in it into
    a staff, which is the direction that lets an unreadable page through.

    Constructed rather than photographed: no page in the corpus has a spurious
    weak periodicity that changes its verdict, which is exactly why mutating
    this bound to zero survived every image-level test.
    """
    import numpy as np

    rows = 400
    period = 12
    # Mostly noise, with a faint regular component buried in it. The generator
    # is seeded so the strength is the same every run.
    rng = np.random.default_rng(20260824)
    faint = rng.normal(0.0, 1.0, rows) + 0.06 * np.array(
        [1.0 if row % period == 0 else 0.0 for row in range(rows)]
    )

    centred = faint - faint.mean()
    correlation = np.correlate(centred, centred, mode="full")[rows - 1:]
    correlation = correlation / correlation[0]
    assert correlation[period] < _STAFF_PERIOD_STRENGTH, (
        "this fixture is not faint enough to test the bound any more"
    )

    reported = _band_staff_space(list(faint))
    assert reported != period, (
        f"a periodicity at {correlation[period]:.3f} was read as ruling"
    )


def test_one_small_staff_does_not_veto_the_page() -> None:
    """Why a low percentile and not the minimum.

    Orchestral parts print cue staves and ossias smaller than the main staff.
    Taking the smallest per-band period would let one of those refuse a page
    whose actual notation is perfectly legible.
    """
    page_of_good_staves_and_one_cue = [12, 12, 12, 12, 12, 12, 4]

    assert _representative_spacing(page_of_good_staves_and_one_cue) >= _MIN_STAFF_SPACE_PX


def test_a_harmonic_does_not_lift_the_page_over_the_floor() -> None:
    """Why not the median either.

    Autocorrelation peaks at every multiple of a period and never at a
    divisor, so the error only ever runs upward. Measured on a page of eight
    stacked fixture strips at webcam resolution: `[4, 13, 4, 13]`, whose
    median of 8.5 cleared the floor while nothing on the page was readable.
    """
    fundamental_and_its_double = [4, 13, 4, 13]

    assert _representative_spacing(fundamental_and_its_double) < _MIN_STAFF_SPACE_PX


def test_the_page_is_measured_as_photographed_not_as_prepared() -> None:
    """`prepare_for_model` scales the long edge down to `MODEL_MAX_EDGE`, so a
    wide page loses staff spacing on the way to the model — a 4000 px page with
    11 px staves would be handed over with 4 px ones.

    That is not a reason to refuse it, and measuring the prepared copy would.
    The crops are cut from the **photograph**, not from the prepared page,
    precisely so each system spends the whole size budget on its own long edge
    (see `crop_systems`' `source`), so what the reader actually receives is far
    better than the prepared page suggests.

    Checked at the call site rather than with a constructed image: the property
    is about which bytes are passed and in what order, and an image test of it
    turned out to be a test of `_ink_profile`'s blur radius instead.
    """
    import re

    from app.workers import transcription_runner as runner

    source = Path(runner.__file__).read_text()
    body = source.split("def _read_page(")[1].split("\ndef ")[0]
    code = re.sub(r"#[^\n]*", "", body)

    assert "too_small_to_read(image_bytes)" in code, (
        "the legibility check is not being given the photograph as downloaded"
    )
    assert code.index("too_small_to_read(") < code.index("prepare_for_model("), (
        "the page is prepared before it is judged, so a wide page that reads "
        "correctly would be refused for the spacing of a copy nothing reads"
    )

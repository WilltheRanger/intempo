"""How many times one page may be read, and what to say at the ceiling.

**The one endpoint that spends money on every call had no ceiling.** Reading a
page is a vision-model call per page. `POST /v1/scores/{id}/transcribe` is
guarded against concurrency — 006's compare-and-set stops two taps starting two
workers on the same row — and against nothing else, so an account could wait
for `done` and ask again for as long as it liked. The free tier's quota does
not reach here: `tier_limits` counts rows in `analyses`, and a re-read creates
none.

**A cap on one page, not a quota on an account**, and the distinction is the
whole reason this can ship without a pricing decision. How many pieces a free
account may hold is a product question nobody has answered. How many times it
is reasonable to re-read *the same photograph* is not: a reading still wrong on
the twelfth attempt will not come right on the thirteenth.

The rule lives here rather than in the router because a rule in a route handler
is a rule that gets tested through HTTP or not at all — and this one has an
off-by-one in it (the run about to start is not yet counted) that is worth
pinning directly.
"""

from __future__ import annotations

from typing import Any

#: Times a single page may be sent to a reader, first reading included.
#:
#: Twelve, and the number is chosen to be **invisible to a person and fatal to
#: a loop**. A musician re-reads a page when the notes came back wrong; two or
#: three attempts is a bad photograph, and the honest answer past that is a
#: better photograph rather than another model call. A script asking in a loop
#: reaches twelve in under a minute and stops there instead of running until
#: somebody reads a bill.
#:
#: Sits beside `tier_limits.FREE_MONTHLY_ANALYSES` in kind: a constant with a
#: reason written next to it, not a value in `config.toml`. That file is the
#: audio tuning surface — every change to it owes `TUNING_LOG.md` a clip-by-clip
#: regression — and a spend ceiling is not a threshold anyone tunes by ear.
MAX_RUNS_PER_PAGE = 12


def runs_so_far(row: Any) -> int:
    """Readings already spent on this page.

    Anything that is not an integer counts as **zero**, not as a refusal. The
    column is `NOT NULL DEFAULT 0` (migration 017), so a non-integer here means
    a client stand-in that does not implement the column rather than an account
    that has run out — and refusing on that would turn a missing column into a
    piece nobody can read again. `tier_limits.count_analyses_this_month` draws
    the line in the opposite direction for the opposite reason: there, guessing
    low hands out free analyses; here, guessing high withholds a reading
    somebody paid for.
    """
    if not isinstance(row, dict):
        return 0
    value = row.get("transcription_runs")
    # `isinstance(True, int)` is True, and a bool in this column would be a
    # client that answered a different question. Same care as `count` in
    # `tier_limits`, where `int(MagicMock())` returning 1 is how a brand-new
    # account once showed an analysis already used.
    if isinstance(value, bool) or not isinstance(value, int):
        return 0
    return max(0, value)


def has_room(row: Any) -> bool:
    """Whether one more reading may start on this page."""
    return runs_so_far(row) < MAX_RUNS_PER_PAGE


def next_run_count(row: Any) -> int:
    """What `transcription_runs` becomes when the reading about to start does.

    Returned rather than written as `runs + 1` at each call site: there are two
    of them — the first reading and a re-reading — and a ceiling that only one
    of them counts towards is not a ceiling.
    """
    return runs_so_far(row) + 1


#: What a musician is told at the ceiling.
#:
#: Names the next move, and the next move is not "try again": twelve readings
#: of one photograph have established that the photograph is the problem. It
#: does not mention a limit, a quota or a plan, because none of those is what
#: happened — this is not an account that ran out of something, it is a page
#: that cannot be read.
EXHAUSTED_MESSAGE = (
    "This page has been read as many times as it usefully can be. "
    "A flatter, closer, better-lit photograph will do more than another try."
)

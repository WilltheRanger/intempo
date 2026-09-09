"""How often one account may start a reading of a page.

**The one thing this service does that costs money per call.** The spec's own
cost model names it: *"Variable cost is the Claude API call per new score
uploaded — roughly $0.05–$0.15"*. Three endpoints reach `start_transcription`
— creating a photographed score, attaching pages to a scoreless one, and asking
for a re-read — and until now nothing bounded how often any of them could be
called. `scores.py` said so out loud in a comment: *"nothing here is
rate-limited"*.

**This is a cost guard, not a product limit, and the difference decides every
number below.** What a free account is *entitled* to is `tier_limits` and spec
§8, and it is the owner's to set. What this stops is a runaway client loop, a
retry storm or a script — none of which are a musician, all of which can spend
real money faster than anyone would notice. So the allowances are set where no
human can reach them and a machine hits them immediately.

**Two windows, because one cannot do both jobs.** A burst limit alone lets a
patient script sit just under it forever; an hourly limit alone lets a runaway
spend its whole hour's worth in ten seconds, which is exactly the shape of the
failure. Ten a minute stops the loop; sixty an hour caps the day.

**In memory, per process, and that is a real limitation rather than an
oversight.** A second instance doubles the effective ceiling and a restart
forgets everything. That is acceptable *for this job*: the exposure it caps is
money, not access, and halving or doubling a bound that no legitimate user
approaches changes nothing anyone experiences. It would not be acceptable for
anything security-shaped. If this service ever runs more than one instance and
the bound has to be exact, the state belongs in Redis and the interface below
does not change.

Never a `Depends`: two of the three callers only know whether a reading will
happen *after* they have parsed the body — `create_score` reads a photographed
piece and a hand-entered one through the same route — so the check has to be a
call the handler makes at the moment it knows.
"""

from __future__ import annotations

import math
import time
from collections import deque
from dataclasses import dataclass

#: An allowance and the span it covers.
@dataclass(frozen=True)
class Limit:
    allowance: int
    window_seconds: float


#: **Ten a minute** stops a loop, and no capture flow can reach it. Photographing
#: a page, cropping it and naming the piece is tens of seconds of a person's
#: attention; six seconds a piece, sustained, is not a musician.
#:
#: **Sixty an hour** caps the sustained case the burst limit cannot see. At the
#: spec's own $0.05–$0.15 a reading that is at most about $9 an hour for one
#: account, against no ceiling at all before this — and it is still more pieces
#: than anyone has photographed in a sitting.
LIMITS: tuple[Limit, ...] = (Limit(10, 60.0), Limit(60, 3600.0))

#: The longest window anything is measured over. Nothing older than this can
#: affect a decision, which is what makes forgetting it safe.
LONGEST_WINDOW = max(limit.window_seconds for limit in LIMITS)

#: What the musician is told. Names the wait, because "try again later" without
#: one is the sentence that makes people tap repeatedly.
BUSY_MESSAGE = (
    "That's a lot of pages at once. Give it a minute and add the next one."
)


@dataclass(frozen=True)
class Decision:
    allowed: bool
    #: Whole seconds until the request would be allowed. 0 when it already is.
    #: Rounded **up**, so a client that waits exactly this long is past the
    #: boundary rather than landing on it and being refused a second time.
    retry_after: int


class ReadingRate:
    """Recent readings per account, and whether another one is allowed now.

    The clock is a parameter on every method rather than read inside, so the
    tests drive it. `time.monotonic` is the default because this measures
    elapsed time and must not move when the system clock is corrected.
    """

    def __init__(self, limits: tuple[Limit, ...] = LIMITS) -> None:
        self._limits = limits
        self._longest = max(limit.window_seconds for limit in limits)
        self._seen: dict[str, deque[float]] = {}

    def check(self, key: str, now: float | None = None) -> Decision:
        """Whether `key` may start a reading, **recording it if so**.

        One method rather than a separate `check` and `record`, deliberately:
        two calls is two chances to check and forget to record, and the one
        that forgets fails open — which is the direction that costs money.
        """
        now = time.monotonic() if now is None else now
        events = self._seen.setdefault(key, deque())
        while events and events[0] <= now - self._longest:
            events.popleft()

        wait = 0.0
        for limit in self._limits:
            cutoff = now - limit.window_seconds
            # The deque is in order, so counting from the right stops as soon as
            # an event is out of the window.
            within = 0
            oldest_within = now
            for stamp in reversed(events):
                if stamp <= cutoff:
                    break
                within += 1
                oldest_within = stamp
            if within >= limit.allowance:
                # Room appears when the oldest event *inside* this window leaves
                # it. Taking the longest wait across the limits that are full
                # means the answer is right rather than merely the first one.
                wait = max(wait, oldest_within + limit.window_seconds - now)

        if wait > 0:
            if not events:
                # Nothing was recorded and nothing is left; do not keep the key.
                self._seen.pop(key, None)
            return Decision(allowed=False, retry_after=max(1, math.ceil(wait)))

        events.append(now)
        return Decision(allowed=True, retry_after=0)

    def forget_expired(self, now: float | None = None) -> int:
        """Drop accounts with nothing left in the longest window.

        **Without this the dictionary only grows.** One entry per account that
        has ever photographed a page, for the life of the process — small, and
        a leak all the same, which is the kind that is only ever found in
        production. Returns how many keys went, so a caller can log it.
        """
        now = time.monotonic() if now is None else now
        cutoff = now - self._longest
        stale = [key for key, events in self._seen.items() if not events or events[-1] <= cutoff]
        for key in stale:
            del self._seen[key]
        return len(stale)

    @property
    def tracked(self) -> int:
        """How many accounts are currently held. For tests and for logging."""
        return len(self._seen)


#: The process-wide instance the routers use.
readings = ReadingRate()

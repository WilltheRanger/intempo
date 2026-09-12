"""What a time signature says about the length of a bar.

**This was two byte-identical copies** — `validate.beats_per_measure` and
`musicxml._quarter_beats` — and the copy's own docstring gave the reason: *"kept
here rather than imported so the importer does not depend on the validator —
this module is what the validator reads, and the arrow has only ever pointed
one way."*

That concern is right, and copying is not the answer to it. `services/buckets.py`
already records the answer for a constant shared by a router and a worker: a
thing shared by two modules belongs to neither, so it lives somewhere that
imports nothing and cannot create an arrow in either direction. This module
imports nothing.

The cost of the copy was not hypothetical. `fixtures/meters/parity.json` exists
because the app and the server have to agree about `" 4 / 4 "`, and
`test_meter_parity.py` checks that fixture against **one** of the two — so the
importer, which stamps the beats the validator then checks bars against, could
have drifted without a single test firing.
"""

from __future__ import annotations


def quarter_beats(time_signature: str | None) -> float | None:
    """Quarter-note beats in one measure, or None when it cannot be known.

    Quarter-note beats rather than notated beats, to match `alignment.py`,
    where `target_bpm` is always quarter-notes-per-minute regardless of the
    time signature's lower number. So 6/8 is 3.0 quarter-beats, not 6.

    `None` covers the literal "unknown" too, which the OCR prompt authorises
    when a score's header is illegible — not an error, just nothing to check
    against.
    """
    if not time_signature or time_signature == "unknown":
        return None
    try:
        upper, lower = time_signature.split("/")
        count, unit = int(upper), int(lower)
    except (ValueError, AttributeError):
        return None
    if count <= 0 or unit <= 0:
        return None
    return count * (4.0 / unit)

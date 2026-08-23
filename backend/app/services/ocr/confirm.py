"""Have a vision model check what the OMR engine read.

The two are good at different halves of the job, measured on a real page:

  Audiveris   got the clef and the key right, found real barlines, and stopped
              at 15 measures where the page has about 25. Structure, reliably.
  A model     reads every measure on the page and invents notes when it cannot
              see them, confidently. Coverage, unreliably.

So neither is asked to do the other's job. The engine reads first, and the
model is shown the photograph *and* the engine's answer and asked to check it.
That is a much easier question than transcribing from scratch: most of the work
is already done and visible, and disagreeing with something concrete is easier
than producing something from nothing.

It is also the only arrangement where the two failure modes cancel. A model
asked to transcribe alone has nothing to contradict it; a model asked to check
has to explain away a barline that is either there or not.
"""

from __future__ import annotations

import logging

from app.services.ocr.base import OCRProvider, OCRProviderError, OCRResponse
from app.services.score_schema import ScoreJson
from app.services.ocr.validate import validate_measures

log = logging.getLogger(__name__)

_INSTRUCTION = """A rule-based OMR engine has already read this image. Its transcription is below.

It is usually right about the CLEF, the KEY SIGNATURE and where the BARLINES are — it measures those from the image rather than guessing. It is often incomplete: it drops measures it could not resolve, and it sometimes merges two measures into one when it misses a barline.

Check it against the photograph and return the corrected transcription.

  - Keep its clef, key and time signature unless the image plainly contradicts them.
  - ADD any measure that is on the page and missing from its reading.
  - SPLIT any measure whose durations add up to more than one bar — that is a missed barline, not a long bar.
  - Correct individual notes only where you can see that it is wrong. Do not rewrite a measure you merely would have read differently.
  - In notes_to_human, say what you changed and why.

Engine transcription:
"""


def confirm_reading(
    score: ScoreJson,
    image_bytes: bytes,
    *,
    media_type: str,
    provider: OCRProvider,
) -> ScoreJson:
    """Return the model's corrected version, or the original if it cannot help.

    Never raises. A confirmation pass is an improvement on something that
    already works, so a failure here must leave the engine's reading standing
    rather than lose the page — the caller has a usable transcription in hand
    and would be trading it for an exception.
    """
    note = _INSTRUCTION + score.model_dump_json(indent=1)
    try:
        response: OCRResponse = provider.parse(image_bytes, media_type, note)
    except (OCRProviderError, ValueError) as exc:
        log.info("confirmation by %s failed, keeping the engine reading: %s", provider.name, exc)
        return score

    confirmed = response.score
    if not confirmed.measures:
        log.info("confirmation by %s returned no measures, keeping the engine reading", provider.name)
        return score

    # Take the confirmed reading only if it is not *worse* by the one measure
    # that is not an opinion. A model asked to check can also decide to rewrite,
    # and a rewrite that breaks measures which previously added up has made the
    # page worse while sounding more confident about it.
    before = _broken(score)
    after = _broken(confirmed)
    if after > before:
        log.info(
            "%s's correction breaks more measures than it fixes (%d -> %d); keeping the engine reading",
            provider.name, before, after,
        )
        return score

    log.info(
        "%s confirmed the reading: %d measures -> %d, measures that do not add up %d -> %d",
        provider.name, len(score.measures), len(confirmed.measures), before, after,
    )
    return confirmed


def _broken(score: ScoreJson) -> int:
    return sum(1 for row in validate_measures(score) if row.is_problem)

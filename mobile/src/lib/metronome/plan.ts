import type { ScoreJson, ScoreMeasure } from '../../data/types';
import { timeSignaturesByMeasure } from '../notation/meter';
import { measuresInPlayOrder } from '../score/playOrder';
import { BEATS, FALLBACK_BPM } from '../score/schedule';
import { tempoClock } from '../score/tempoClock';
import { metronomePulse, type Beat } from './beats';

const UNKNOWN_DURATION_BEATS = 1;
const EPSILON = 1e-9;

export interface PlannedBeat extends Beat {
  /** Seconds from the first count-in pulse. */
  atS: number;
  /** Felt pulses in this particular bar; null when its meter is unreadable. */
  pulsesPerBar: number | null;
}

export interface MetronomePlan {
  beats: PlannedBeat[];
  /** Number of pulses before the first played downbeat. */
  countInPulses: number;
}

function durationInQuarterBeats(measure: ScoreMeasure): number {
  return (measure.notes ?? []).reduce(
    (total, note) => total + (BEATS[note.duration] ?? UNKNOWN_DURATION_BEATS),
    0,
  );
}

/**
 * Every pulse the count-in and take should produce, on the score's own clock.
 *
 * Times remain quarter-note based, exactly like playback and alignment. Meter
 * only decides how those quarters are grouped into felt pulses: 6/8 yields two
 * dotted-quarter beats, 3/4 three quarter beats, and an unreadable meter falls
 * back to unaccented quarters. Each played measure starts with a downbeat.
 *
 * Meter is looked up in written order before repeats are expanded. Returning
 * to an earlier printed bar therefore returns to the meter in force there,
 * instead of carrying a later change backwards through the repeat.
 *
 * **Each bar clicks at the tempo the page sets for it** (`tempoClock.ts`): a
 * "meno mosso · 88" clicks at 88, scaled as the take is, the way Listen plays
 * it and the analysis judges it. The count-in is at the first played bar's
 * tempo, so a take started inside the meno mosso is counted in at it.
 */
export function buildMetronomePlan(
  score: ScoreJson | null | undefined,
  bpm: number,
): MetronomePlan {
  const quarterBpm =
    Number.isFinite(bpm) && bpm > 0 ? bpm : FALLBACK_BPM;
  const clock = tempoClock(score, quarterBpm);
  const countInSecondsPerQuarter = clock.openingSecondsPerBeat;
  const beats: PlannedBeat[] = [];
  let atQuarter = 0;
  let index = 0;

  const firstMeter = score
    ? (score.measures?.[0]?.time_signature ?? score.time_signature)
    : null;
  const firstPulse = metronomePulse(firstMeter);
  const countInPulses = firstPulse?.pulsesPerBar ?? 4;
  const countInQuarterSize = firstPulse?.quarterBeats ?? 1;

  for (let pulse = 0; pulse < countInPulses; pulse += 1) {
    beats.push({
      atS: atQuarter * countInSecondsPerQuarter,
      index,
      beatInBar: firstPulse ? pulse : null,
      downbeat: pulse === 0 && firstPulse !== null,
      pulsesPerBar: firstPulse?.pulsesPerBar ?? null,
    });
    index += 1;
    atQuarter += countInQuarterSize;
  }

  if (!score) {
    return { beats, countInPulses };
  }

  // The first downbeat, and from there the page's own clock.
  const downbeatS = atQuarter * countInSecondsPerQuarter;
  atQuarter = 0;
  const meters = timeSignaturesByMeasure(score);
  for (const measure of measuresInPlayOrder(score)) {
    const duration = durationInQuarterBeats(measure);
    if (duration <= 0) {
      continue;
    }
    const pulse = metronomePulse(meters.get(measure.measure_number));
    const quarterSize = pulse?.quarterBeats ?? 1;
    const pulsesPerBar = pulse?.pulsesPerBar ?? null;
    let beatInBar = 0;

    for (
      let offset = 0;
      offset < duration - EPSILON;
      offset += quarterSize
    ) {
      beats.push({
        atS: downbeatS + clock.secondsAt(atQuarter + offset),
        index,
        beatInBar: pulse ? beatInBar : null,
        downbeat: beatInBar === 0 && pulse !== null,
        pulsesPerBar,
      });
      index += 1;
      beatInBar += 1;
    }
    atQuarter += duration;
  }

  return { beats, countInPulses };
}

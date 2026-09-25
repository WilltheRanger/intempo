import type { ScoreJson, ScoreMeasure } from '../../data/types';
import { measuresInPlayOrder } from './playOrder';
import { BEATS, FALLBACK_BPM } from './schedule';
import { tempoByMeasure } from './tempoMap';

/**
 * A take's clock on the page: seconds into the music and quarter beats into
 * it, each bar at the tempo the page sets for it.
 *
 * The click, the playhead and the re-entry countdown each turned elapsed time
 * into a place in the music at one steady tempo. Once a page can say "meno
 * mosso · 88" (#163, #164), a musician playing as written drifted away from
 * all three: the click went on at the opening tempo, and the mark and the
 * countdown ran ahead of them. This is the one conversion they now share, and
 * it walks the same tempo map Listen plays (`schedule.ts`) and the analysis
 * judges against (`tempoMap.ts`).
 *
 * Beat 0 and second 0 are the first played bar's downbeat; the count-in is
 * before it. A gradual change ("rit.") leaves the tempo where it was — the
 * page does not say how far it goes, so there is no number to click at.
 */
export interface TempoClock {
  /** Seconds from the first downbeat to a point `beats` quarters in. */
  secondsAt(beats: number): number;
  /** Quarter beats in, `seconds` after the first downbeat. */
  beatsAt(seconds: number): number;
  /** Seconds per quarter in the first played bar: the count-in's tempo. */
  openingSecondsPerBeat: number;
}

interface Segment {
  beat: number;
  seconds: number;
  secondsPerBeat: number;
}

const UNKNOWN_DURATION_BEATS = 1;

function measureBeats(measure: ScoreMeasure): number {
  return (measure.notes ?? []).reduce(
    (total, note) => total + (BEATS[note.duration] ?? UNKNOWN_DURATION_BEATS),
    0,
  );
}

/** The clock for a take of `score` at `bpm`, in played order. */
export function tempoClock(score: ScoreJson | null | undefined, bpm: number): TempoClock {
  const steadyBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : FALLBACK_BPM;
  const steady = 60 / steadyBpm;
  const segments: Segment[] = [];

  if (score) {
    const barTempo = tempoByMeasure(score, steadyBpm);
    let beat = 0;
    let seconds = 0;
    for (const measure of measuresInPlayOrder(score)) {
      const duration = measureBeats(measure);
      if (duration <= 0) continue;
      const tempo = barTempo.get(measure.measure_number);
      const secondsPerBeat =
        tempo !== undefined && Number.isFinite(tempo) && tempo > 0 ? 60 / tempo : steady;
      if (segments[segments.length - 1]?.secondsPerBeat !== secondsPerBeat) {
        segments.push({ beat, seconds, secondsPerBeat });
      }
      beat += duration;
      seconds += duration * secondsPerBeat;
    }
  }
  if (segments.length === 0) {
    segments.push({ beat: 0, seconds: 0, secondsPerBeat: steady });
  }

  // The segment a position falls in; before the first bar and past the last,
  // the nearest one carries on.
  const at = (key: 'beat' | 'seconds', value: number): Segment => {
    let found = segments[0];
    for (const segment of segments) {
      if (segment[key] <= value) found = segment;
      else break;
    }
    return found;
  };

  return {
    secondsAt(beats) {
      const segment = at('beat', beats);
      return segment.seconds + (beats - segment.beat) * segment.secondsPerBeat;
    },
    beatsAt(seconds) {
      const segment = at('seconds', seconds);
      return segment.beat + (seconds - segment.seconds) / segment.secondsPerBeat;
    },
    openingSecondsPerBeat: segments[0].secondsPerBeat,
  };
}

/**
 * The time a take at one steady `bpm` would take to reach where this one is
 * on the page — for the playhead and the rest countdown, which place a take by
 * elapsed time at one tempo.
 */
export function steadyElapsedMs(clock: TempoClock, elapsedMs: number, bpm: number): number {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(bpm) || bpm <= 0) return elapsedMs;
  return clock.beatsAt(elapsedMs / 1000) * (60_000 / bpm);
}

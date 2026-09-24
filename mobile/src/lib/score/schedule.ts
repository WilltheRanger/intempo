import type { Duration, ScoreJson, ScoreNote } from '../../data/types';
import { flattenNotes, readTies } from '../notation/ties';
import { measuresInPlayOrder } from './playOrder';
import { midiOf } from '../notation/pitch';
import { timeSignaturesByMeasure } from '../notation/meter';
import { metronomePulse } from '../metronome/beats';
import {
  EXPRESSION_NEUTRAL,
  SWELL_MIN_S,
  levelsAlong,
  metricLift,
  velocityOf,
} from './expression';

/**
 * A score and a tempo, turned into notes with times and pitches.
 *
 * Pure, and separate from anything that makes sound, because this is the part
 * that can be wrong in ways nobody hears until they're already confused: a
 * dotted quarter counted as a quarter shifts everything after it, and the
 * mistake sounds like the piece, just wrong.
 *
 * The same walk the analysis pipeline does server-side in
 * `alignment.build_timeline` — accumulate beats, scale by the tempo. Kept
 * deliberately parallel so a note the app plays at 2.5s is the note the
 * pipeline expects at 2.5s.
 */

/** Beats per note value, at any tempo. A dot adds half again. */
export const BEATS: Record<Duration, number> = {
  double_whole: 8,
  dotted_whole: 6,
  whole: 4,
  double_dotted_half: 7 / 2,
  dotted_half: 3,
  half: 2,
  double_dotted_quarter: 7 / 4,
  dotted_quarter: 3 / 2,
  quarter: 1,
  double_dotted_eighth: 7 / 8,
  dotted_eighth: 3 / 4,
  eighth: 1 / 2,
  dotted_sixteenth: 3 / 8,
  sixteenth: 1 / 4,
  dotted_thirty_second: 3 / 16,
  thirty_second: 1 / 8,
  dotted_sixty_fourth: 3 / 32,
  sixty_fourth: 1 / 16,
  one_twenty_eighth: 1 / 32,
  triplet_breve: 16 / 3,
  triplet_whole: 8 / 3,
  triplet_half: 4 / 3,
  triplet_quarter: 2 / 3,
  triplet_eighth: 1 / 3,
  triplet_sixteenth: 1 / 6,
  triplet_thirty_second: 1 / 12,
  triplet_sixty_fourth: 1 / 24,
  triplet_one_twenty_eighth: 1 / 48,
  quintuplet_breve: 32 / 5,
  quintuplet_whole: 16 / 5,
  quintuplet_half: 8 / 5,
  quintuplet_quarter: 4 / 5,
  quintuplet_eighth: 2 / 5,
  quintuplet_sixteenth: 1 / 5,
  quintuplet_thirty_second: 1 / 10,
  quintuplet_sixty_fourth: 1 / 20,
  quintuplet_one_twenty_eighth: 1 / 40,
  septuplet_breve: 32 / 7,
  septuplet_whole: 16 / 7,
  septuplet_half: 8 / 7,
  septuplet_quarter: 4 / 7,
  septuplet_eighth: 2 / 7,
  septuplet_sixteenth: 1 / 7,
  septuplet_thirty_second: 1 / 14,
  septuplet_sixty_fourth: 1 / 28,
  septuplet_one_twenty_eighth: 1 / 56,
};

/**
 * What to sound a duration this build does not recognise as.
 *
 * Only reachable if the backend has learned a note value the app has not, and
 * only for playback — the beat *check* refuses to count such a bar rather than
 * guessing (`reading.beatsOf` returns null). A quarter is the least-wrong
 * guess: the note is audible and the drift is one beat, where silence would
 * make the musician think the app had lost the passage.
 */
const UNKNOWN_DURATION_BEATS = 1;

/**
 * The tempo to use when there is no usable one.
 *
 * **Defined here, in the module with no dependencies**, and re-exported by
 * `data/practiceTempo` — which reaches for AsyncStorage and so cannot be
 * imported by anything that wants to stay testable. One number rather than
 * two that have to be remembered to agree.
 *
 * Reached by a tempo that is not a number at all, which a clamp does not
 * catch: `Math.max` and `Math.min` both pass `NaN` straight through.
 */
export const FALLBACK_BPM = 80;

/**
 * Scientific pitch to frequency in hertz. Null for a rest or anything
 * unparseable — a score from OCR can contain surprises, and a wrong note is
 * worse than a silent one.
 *
 * A4 = 440 Hz, equal temperament. Not configurable: a musician tuning to 442
 * is tuning their instrument, not the app, and a playback reference that
 * disagreed with their tuner would be a bug report.
 */
export function frequencyOf(pitch: string): number | null {
  // The table and the arithmetic live in `notation/pitch.ts` now, because the
  // proposal checker needs the same number and a second copy of a semitone
  // table is how two parts of an app come to disagree about what B flat is.
  const midi = midiOf(pitch);
  if (midi === null) {
    return null;
  }
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export interface ScheduledNote {
  /** Seconds from the start of playback. */
  startS: number;
  /** How long the note sounds. Rests are absent, not zero-length notes. */
  durationS: number;
  frequency: number;
  measureNumber: number;
  /** Index among sounded notes, so a playhead can name what it's on. */
  globalIndex: number;
  /**
   * How hard the note is played, 1–127: its dynamic, any accent, and where it
   * falls in the bar (`expression.ts`). Absent means an unmarked note.
   */
  velocity?: number;
  /**
   * Slurred into the next note: held for its whole value, and joined to the
   * next rather than separated from it.
   */
  legato?: boolean;
  /**
   * How the level moves while the note is held, as MIDI expression (CC 11) at
   * its start and at its end: a long note under a hairpin. Absent, the note
   * keeps its own shape (`expression.swell`).
   */
  expression?: { from: number; to: number };
}

export interface Schedule {
  notes: ScheduledNote[];
  /** Total length including any trailing rest, so playback ends when the piece does. */
  durationS: number;
  bpm: number;
}

export interface ScheduleOptions {
  /**
   * Fraction of its written value a note actually sounds for, leaving a gap
   * before the next. Without it every note runs into the next one and a scale
   * becomes a siren — the ear reads the gap, not the attack, as separation.
   */
  articulation?: number;
  /** Silence before the first note, for a count-in to sit in. */
  leadInS?: number;
}

/**
 * 0.85 until 2026-09-24. A bow change is short: at 0.85 a quarter at 80 had
 * 110 ms of silence before the next note, which on a sampled string reads as
 * a keyboard, not a bow. 0.92 keeps a gap the ear hears as separation.
 */
const DEFAULT_ARTICULATION = 0.92;

/**
 * How long a marked note actually sounds, as a fraction of its written value.
 *
 * **Because a staccato dot is an instruction, not a decoration.** The page says
 * play it short; a reference that plays it long teaches the passage wrong, and
 * a musician copying what they hear then records a take the analysis judges
 * against the written durations they were never shown.
 *
 * A half is the conventional reading of a staccato quarter and it is what a
 * metronome-and-scale app should give: short enough to be unmistakably detached,
 * long enough to keep the pitch audible. Tenuto is the opposite instruction —
 * hold it for its whole value — so it overrides the default gap entirely rather
 * than shortening it slightly less.
 *
 * An accent changes weight, not length, so it is not here: it is in the
 * note's velocity (`expression.ts`), with the page's dynamics.
 */
const ARTICULATION_LENGTH: Record<string, number> = {
  staccato: 0.5,
  tenuto: 1,
};

/**
 * How long each grace note sounds, at most: a flick before the beat, about as
 * fast as a finger drops. Seconds rather than beats, because it is the same
 * flick at any tempo.
 *
 * Not the server's placement, and it need not be. `alignment.build_timeline`
 * spreads a note's ornaments over `ORNAMENT_SHARE` of its run-up, a number
 * chosen to make matching work, and a tenth of a beat out of place costs the
 * matcher far less than an ornament missing. This is chosen to sound like a
 * player; both put the ornament before the beat and the beat where it was.
 */
const GRACE_S = 0.07;
/** The most of the note before that its ornament may take. */
const GRACE_SHARE = 0.5;
/** Shorter than this a grace note is a smear, not a note, and is left out. */
const GRACE_MIN_S = 0.02;
/** An ornament is lighter than the note it leads into. */
const GRACE_SOFTER = 8;

/**
 * The grace notes to play before a note, or null for none.
 *
 * **All of them or none**, and only by name. A count with no pitches is what
 * a reading from a photograph gives, and guessing the note would put a wrong
 * one in front of the right one — the reference teaching a mistake. The
 * alignment still expects the attack; it is only Listen that stays quiet.
 */
function ornamentOf(note: ScoreNote): number[] | null {
  const pitches = note.grace_pitches ?? [];
  if (pitches.length === 0 || pitches.length < (note.grace_notes ?? 0)) {
    return null;
  }
  const hz = pitches.map(frequencyOf);
  return hz.every((f): f is number => f !== null) ? hz : null;
}

/**
 * Walk the score, emitting one entry per sounded note.
 *
 * Rests advance the clock and emit nothing. Ties are folded into the note they
 * start on, so a note tied across a barline sounds once for its whole length
 * rather than being re-struck — re-striking is precisely the error a musician
 * would hear.
 *
 * Repeats and first/second endings follow the same performed order as backend
 * alignment. A reference that skips a repeat teaches a different timeline from
 * the one the take is graded against.
 */
export function scheduleScore(
  score: ScoreJson,
  bpm: number,
  { articulation = DEFAULT_ARTICULATION, leadInS = 0 }: ScheduleOptions = {},
): Schedule {
  // **`Math.max(1, NaN)` is `NaN`**, so clamping alone does not make this
  // safe. A non-finite tempo propagated into every note's start and duration,
  // and `playSchedule` then handed `NaN` to `oscillator.stop()`, which throws
  // — out of the loop, after earlier notes had already been `start()`ed, with
  // no handle returned to stop them. A note sounding that nothing can silence,
  // from one bad number.
  const beatsPerMinute = Number.isFinite(bpm) ? Math.max(1, bpm) : FALLBACK_BPM;
  const secondsPerBeat = 60 / beatsPerMinute;
  const notes: ScheduledNote[] = [];

  let clock = leadInS;
  let globalIndex = 0;

  // Walked flat, and the ties read the way the backend reads them. Both matter:
  // a tie across a barline is the commonest kind and the old per-measure loop
  // could not see one, and a tie is only real when both noteheads are the same
  // pitch — otherwise it is a slur, which sounds as separate notes. See
  // `notation/ties.ts`.
  const measures = measuresInPlayOrder(score);
  const flat = flattenNotes(measures);
  const ties = readTies(measures);
  // Which measure each flat note belongs to, so a scheduled note can still say.
  const measureOf: number[] = [];
  // Where each flat note begins a bar, and whether a slur carries it into the
  // next note or brings it from the last. Slur indices count within a bar.
  const opensBar: boolean[] = [];
  const slurredTo: boolean[] = [];
  const slurredFrom: boolean[] = [];
  for (const measure of measures) {
    const written = measure.notes ?? [];
    written.forEach((_, local) => {
      measureOf.push(measure.measure_number);
      opensBar.push(local === 0);
      const slurs = measure.slurs ?? [];
      slurredTo.push(
        slurs.some((s) => s.start_note_index <= local && local < s.end_note_index),
      );
      slurredFrom.push(
        slurs.some((s) => s.start_note_index < local && local <= s.end_note_index),
      );
    });
  }
  const meters = timeSignaturesByMeasure(score);
  // The beat each flat note starts on, for the hairpins: a crescendo is a
  // line across beats, so it needs to know where each note falls on it. Rests
  // and tied-over notes are counted, because a hairpin can end on either, and
  // a dynamic written on a tied-over note still stands for what follows.
  const onsets: number[] = [];
  let beatsSoFar = 0;
  for (const note of flat) {
    onsets.push(beatsSoFar);
    beatsSoFar += BEATS[note.duration] ?? UNKNOWN_DURATION_BEATS;
  }
  const levels = levelsAlong(flat, onsets, beatsSoFar);

  // **An ornament on the very first note needs time before it**, and a piece
  // that opens on one has none: nothing before the first onset but the start.
  // So the whole piece starts that much later rather than losing the ornament
  // or moving the note it decorates. Every onset moves together, so no note
  // moves against another.
  const first = flat.findIndex(
    (note, i) => !ties.absorbed[i] && note.pitch !== 'rest' && frequencyOf(note.pitch) !== null,
  );
  const opening = first === -1 ? null : ornamentOf(flat[first]);
  if (opening) {
    const room = clock + onsets[first] * secondsPerBeat;
    clock += Math.max(0, opening.length * GRACE_S - room);
  }
  let barStart = clock;
  // Where the last sounded note started: an ornament takes its time from it.
  // Null before the first, whose ornament may have all the silence before it.
  let previousOnset: number | null = null;

  for (let i = 0; i < flat.length; i += 1) {
    if (opensBar[i]) {
      barStart = clock;
    }
    const note = flat[i];
    if (ties.absorbed[i]) {
      continue; // already sounding, as part of the note that tied into it
    }
    let beats = BEATS[note.duration] ?? UNKNOWN_DURATION_BEATS;
    let last = i;
    for (let held = i + 1; held < flat.length && ties.absorbed[held]; held += 1) {
      beats += BEATS[flat[held].duration] ?? UNKNOWN_DURATION_BEATS;
      last = held;
    }

    const durationS = beats * secondsPerBeat;
    // The note's own marking wins over everything; then a slur, which holds a
    // note its whole value into the next; then the global gap. A tied note is
    // slurred on if the last note of the tie is.
    const marked = ARTICULATION_LENGTH[note.articulation ?? ''];
    const legato = marked === undefined && slurredTo[last];
    const sounded = durationS * (marked ?? (legato ? 1 : articulation));
    const frequency = note.pitch === 'rest' ? null : frequencyOf(note.pitch);

    if (frequency !== null) {
      // **A long note under a hairpin moves while it is held.** Velocity is
      // fixed at the attack, so the note is struck at the louder end of its
      // stretch and CC 11 carries it from one end to the other; both act on
      // the level by the same curve, so the ratio of the two levels is the
      // ratio of the two expression values. A short note is left to the next
      // attack, which arrives before the difference could be heard.
      const from = levels.standing[i];
      const to = levels.before(onsets[i] + sounded / secondsPerBeat);
      const moves = sounded >= SWELL_MIN_S && Math.abs(to - from) >= 1;
      const peak = Math.max(from, to);
      const pulse = metronomePulse(meters.get(measureOf[i]));
      const velocity = velocityOf({
        dynamic: levels.attack[i] + (moves ? peak - from : 0),
        articulation: note.articulation,
        metric: metricLift((clock - barStart) / secondsPerBeat, pulse),
        slurredFrom: slurredFrom[i],
        index: globalIndex,
      });
      const expression = moves
        ? {
            from: Math.round((EXPRESSION_NEUTRAL * from) / peak),
            to: Math.round((EXPRESSION_NEUTRAL * to) / peak),
          }
        : undefined;

      // **The ornament first, because it is played first**, ending exactly
      // where the note it decorates begins. It takes its time from the note
      // before — never more than `GRACE_SHARE` of it, or all of the silence
      // before the first note — and never the note's own onset, which is
      // where the analysis will listen for it.
      const ornament = ornamentOf(note);
      if (ornament) {
        const room =
          previousOnset === null ? clock : (clock - previousOnset) * GRACE_SHARE;
        const each = Math.min(GRACE_S, room / ornament.length);
        if (each >= GRACE_MIN_S) {
          ornament.forEach((graceHz, k) => {
            notes.push({
              startS: clock - each * (ornament.length - k),
              durationS: each,
              frequency: graceHz,
              measureNumber: measureOf[i],
              globalIndex,
              velocity: Math.max(1, velocity - GRACE_SOFTER),
              legato: true,
            });
            globalIndex += 1;
          });
        }
      }

      notes.push({
        startS: clock,
        durationS: sounded,
        frequency,
        measureNumber: measureOf[i],
        globalIndex,
        velocity,
        ...(legato ? { legato } : {}),
        ...(expression ? { expression } : {}),
      });
      globalIndex += 1;
      previousOnset = clock;

      // **The rest of the chord, at the same instant.** A double stop played
      // back as its lower note alone is not the piece: the demo fixture opens
      // with a four-note chord, and Listen sounded one of them. They share the
      // onset and the duration — that is what makes them chord members — and
      // they take the **same** `globalIndex`, because a playhead names the
      // moment you are hearing and a chord is one moment.
      for (const member of note.chord_pitches ?? []) {
        const chordHz = frequencyOf(member);
        if (chordHz === null) {
          continue;
        }
        notes.push({
          startS: clock,
          durationS: sounded,
          frequency: chordHz,
          measureNumber: measureOf[i],
          globalIndex: globalIndex - 1,
          velocity,
          ...(legato ? { legato } : {}),
          ...(expression ? { expression } : {}),
        });
      }
    }

    clock += durationS;
  }

  return { notes, durationS: clock, bpm };
}

/**
 * The same performance, entered at a chosen bar.
 *
 * **Trimmed by time, not by measure number**, and that is the whole design.
 * `measuresInPlayOrder` expands repeats, so bar 5 of a piece with a repeat is
 * played twice and "notes in bar 5 or later" is not a thing that exists — it
 * would keep the second pass through bars 1–4 and drop nothing useful. What a
 * musician means by "start at bar 5" is *the first time bar 5 is played, then
 * carry on*, including the repeat back to bar 1 if that is what the page says.
 * So this finds the earliest note that belongs to that bar and keeps
 * everything from there.
 *
 * A note **tied into** the start bar is not replayed. It began before you did;
 * re-striking it would sound a note the page does not have, which is exactly
 * the error a musician would hear.
 *
 * A bar the piece never reaches — past the end, or one whose every note was a
 * rest — returns the schedule unchanged rather than silence. Playing from the
 * top is a recoverable surprise; a button that does nothing is not.
 */
export function startAtMeasure(schedule: Schedule, measureNumber: number): Schedule {
  const first = schedule.notes.find((note) => note.measureNumber === measureNumber);
  if (!first) {
    return schedule;
  }

  const offset = first.startS;
  // Renumbered, because `globalIndex` has to index the notes actually being
  // played — by moment, not by position, so a chord's members keep sharing
  // one index as they do from the top (`scheduleScore`).
  const renumbered = new Map<number, number>();
  const notes = schedule.notes
    .filter((note) => note.startS >= offset)
    .map((note) => {
      if (!renumbered.has(note.globalIndex)) {
        renumbered.set(note.globalIndex, renumbered.size);
      }
      return {
        ...note,
        startS: note.startS - offset,
        globalIndex: renumbered.get(note.globalIndex)!,
      };
    });

  return {
    ...schedule,
    notes,
    durationS: Math.max(0, schedule.durationS - offset),
  };
}

/**
 * Every bar a listener could sensibly start from, in the order they are played.
 *
 * Read off the schedule rather than the score so it can only ever offer bars
 * that actually sound — a bar of rests has nothing to enter on, and a picker
 * that offers it produces a Listen that appears to do nothing. Deduplicated,
 * because a repeat plays the same bar twice and a picker should list it once.
 */
export function startableMeasures(schedule: Schedule): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const note of schedule.notes) {
    if (!seen.has(note.measureNumber)) {
      seen.add(note.measureNumber);
      out.push(note.measureNumber);
    }
  }
  return out;
}

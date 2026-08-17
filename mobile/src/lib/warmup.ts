import type { Clef, Instrument, ScoreJson } from '../data/types';
import type { StaveNote } from './notation/engrave';

/**
 * The daily warmup: a few bars written for the instrument in your hands.
 *
 * **Why these are hand-authored rather than pulled from the library.** A daily
 * exercise has to be short, in first position, and about one thing. Slicing
 * four bars out of a real piece gives you none of those and usually lands
 * mid-phrase; and slicing it out of the musician's *own* library would just
 * hand back a fragment of what they are already practising.
 *
 * Every warmup states what it trains. An exercise without a stated purpose is
 * a warm-up ritual, and this app has no business inventing rituals.
 *
 * **Range discipline.** Everything here sits in first position on its
 * instrument. An exercise that needs a shift is not a warmup, and one printed
 * outside the range of the instrument it claims to be for is worse than none.
 * The ranges are noted per instrument below and are the reason each warmup is
 * written four times rather than transposed automatically — automatic
 * transposition would put a viola exercise on strings a viola does not have.
 */

export interface Warmup {
  id: string;
  /** What it is, in the words a teacher would use. */
  name: string;
  /** What it trains. One clause, always present. */
  focus: string;
  notes: StaveNote[];
  /** A comfortable working tempo in quarter-note BPM, not a target. */
  bpm: number;
  clef: Clef;
}

const q = (pitch: string, barBefore = false): StaveNote => ({
  pitch,
  value: 'quarter',
  ...(barBefore ? { barBefore } : {}),
});
const e = (pitch: string, barBefore = false): StaveNote => ({
  pitch,
  value: 'eighth',
  ...(barBefore ? { barBefore } : {}),
});
const h = (pitch: string, barBefore = false): StaveNote => ({
  pitch,
  value: 'half',
  ...(barBefore ? { barBefore } : {}),
});

/**
 * Scale up and back down, barred every four beats.
 *
 * The returning tonic is a half note, and that is arithmetic rather than
 * taste: eight up and seven down is fifteen notes, and fifteen quarters
 * leaves a bar three beats long. Two beats on the last note makes sixteen —
 * four bars of four, which is what a scale exercise has to be if it is going
 * to be counted.
 */
function scale(pitches: string[]): StaveNote[] {
  const full = [...pitches, ...pitches.slice(0, -1).reverse()];
  return full.map((pitch, index) =>
    index === full.length - 1
      ? h(pitch, index % 4 === 0)
      : q(pitch, index % 4 === 0),
  );
}

/**
 * Back and forth between two strings, eight quavers to the bar, twice over.
 *
 * Written out per pair rather than looped in the data so each bar can be read
 * as a bar. The final whole note is where the bow stops and you listen to the
 * string ring.
 */
function crossings(lower: string, upper: string, second: [string, string], hold: string): StaveNote[] {
  const bar = (a: string, b: string, first: boolean): StaveNote[] =>
    [e(a, first), e(b), e(a), e(b), e(a), e(b), e(a), e(b)];
  return [
    ...bar(lower, upper, true),
    ...bar(second[0], second[1], true),
    { pitch: hold, value: 'whole', barBefore: true },
  ];
}

/**
 * Violin — first position, G3 to B5. Open strings G3 D4 A4 E5.
 */
const VIOLIN: Warmup[] = [
  {
    id: 'violin-d-major',
    name: 'D major, one octave',
    focus: 'Even bow distribution and a settled first position.',
    notes: scale(['D4', 'E4', 'F#4', 'G4', 'A4', 'B4', 'C#5', 'D5']),
    bpm: 72,
    clef: 'treble',
  },
  {
    id: 'violin-string-crossing',
    name: 'Open-string crossings',
    focus: 'The bow arm alone — no left hand to hide behind.',
    notes: crossings('D4', 'A4', ['G3', 'D4'], 'D4'),
    bpm: 66,
    clef: 'treble',
  },
  {
    id: 'violin-a-major-broken',
    name: 'A major, broken thirds',
    focus: 'Finger independence — the third finger stays down.',
    notes: [
      q('A4', true), q('C#5'), q('B4'), q('D5'),
      q('C#5', true), q('E5'), q('D5'), q('F#5'),
      h('E5', true), h('A4'),
    ],
    bpm: 60,
    clef: 'treble',
  },
];

/**
 * Viola — first position, C3 to E5, in alto clef. Open strings C3 G3 D4 A4.
 */
const VIOLA: Warmup[] = [
  {
    id: 'viola-g-major',
    name: 'G major, one octave',
    focus: 'Even bow distribution across the middle two strings.',
    notes: scale(['G3', 'A3', 'B3', 'C4', 'D4', 'E4', 'F#4', 'G4']),
    bpm: 72,
    clef: 'alto',
  },
  {
    id: 'viola-string-crossing',
    name: 'Open-string crossings',
    focus: 'The bow arm alone — no left hand to hide behind.',
    notes: crossings('G3', 'D4', ['C3', 'G3'], 'G3'),
    bpm: 66,
    clef: 'alto',
  },
  {
    id: 'viola-c-major-broken',
    name: 'C major, broken thirds',
    focus: 'Finger independence on the lower strings.',
    notes: [
      q('C3', true), q('E3'), q('D3'), q('F3'),
      q('E3', true), q('G3'), q('F3'), q('A3'),
      h('G3', true), h('C3'),
    ],
    bpm: 60,
    clef: 'alto',
  },
];

/**
 * Cello — first position, C2 to D4, in bass clef. Open strings C2 G2 D3 A3.
 */
const CELLO: Warmup[] = [
  {
    id: 'cello-d-major',
    name: 'D major, one octave',
    focus: 'Even bow distribution and a settled first position.',
    notes: scale(['D3', 'E3', 'F#3', 'G3', 'A3', 'B3', 'C#4', 'D4']),
    bpm: 72,
    clef: 'bass',
  },
  {
    id: 'cello-string-crossing',
    name: 'Open-string crossings',
    focus: 'The bow arm alone — no left hand to hide behind.',
    notes: crossings('G2', 'D3', ['C2', 'G2'], 'G2'),
    bpm: 66,
    clef: 'bass',
  },
  {
    id: 'cello-g-major-broken',
    name: 'G major, broken thirds',
    focus: 'Finger independence — extensions stay quiet.',
    notes: [
      q('G2', true), q('B2'), q('A2'), q('C3'),
      q('B2', true), q('D3'), q('C3'), q('E3'),
      h('D3', true), h('G2'),
    ],
    bpm: 60,
    clef: 'bass',
  },
];

/**
 * Double bass — first position, written E2 to B3 in bass clef.
 *
 * Written pitch, not sounding: the bass sounds an octave below what is
 * printed, and printing the sounding pitch would put every exercise two ledger
 * lines under the staff for no reason. Open strings E2 A2 D3 G3, as written.
 */
const DOUBLE_BASS: Warmup[] = [
  {
    id: 'bass-g-major',
    name: 'G major, one octave',
    focus: 'Even bow distribution and a settled first position.',
    notes: scale(['G2', 'A2', 'B2', 'C3', 'D3', 'E3', 'F#3', 'G3']),
    bpm: 66,
    clef: 'bass',
  },
  {
    id: 'bass-string-crossing',
    name: 'Open-string crossings',
    focus: 'The bow arm alone — no left hand to hide behind.',
    notes: crossings('A2', 'D3', ['E2', 'A2'], 'A2'),
    bpm: 60,
    clef: 'bass',
  },
  {
    id: 'bass-d-major-broken',
    name: 'D major, broken thirds',
    focus: 'Shifting weight between fingers without gripping.',
    notes: [
      q('D3', true), q('F#3'), q('E3'), q('G3'),
      q('F#3', true), q('A3'), q('G3'), q('B3'),
      h('A3', true), h('D3'),
    ],
    bpm: 56,
    clef: 'bass',
  },
];

const BY_INSTRUMENT: Record<Instrument, Warmup[]> = {
  violin: VIOLIN,
  viola: VIOLA,
  cello: CELLO,
  double_bass: DOUBLE_BASS,
};

export const INSTRUMENT_LABELS: Record<Instrument, string> = {
  violin: 'Violin',
  viola: 'Viola',
  cello: 'Cello',
  double_bass: 'Double bass',
};

/** Days since the epoch, in local time — the same number all day, everywhere. */
export function dayIndex(now: Date = new Date()): number {
  const local = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor(local.getTime() / 86_400_000);
}

/**
 * Today's warmup for an instrument.
 *
 * Rotates by the date rather than at random: it has to be the same warmup all
 * day, and the same one on every device, or "today's warmup" would mean
 * nothing and closing the app would reroll the work you had started.
 */
export function warmupFor(instrument: Instrument, now: Date = new Date()): Warmup {
  const set = BY_INSTRUMENT[instrument] ?? VIOLIN;
  return set[dayIndex(now) % set.length];
}

const VALUE_DURATIONS = {
  whole: 'whole',
  half: 'half',
  quarter: 'quarter',
  eighth: 'eighth',
} as const;

/**
 * The warmup as a score the existing player can sound.
 *
 * Reuses `scheduleScore` and the reference voice rather than growing a second
 * playback path — the same code that plays a piece plays the exercise, so a
 * timing bug cannot exist in one and not the other.
 */
export function warmupScore(warmup: Warmup): ScoreJson {
  const measures: ScoreJson['measures'] = [];
  for (const note of warmup.notes) {
    if (note.barBefore || measures.length === 0) {
      measures.push({ measure_number: measures.length + 1, notes: [], slurs: [] });
    }
    measures[measures.length - 1].notes.push({
      pitch: note.pitch,
      duration: VALUE_DURATIONS[note.value],
      tied_to_next: false,
    });
  }

  return {
    time_signature: '4/4',
    key_signature: null,
    tempo_marking: null,
    bpm_hint: warmup.bpm,
    clef: warmup.clef,
    measures,
    repeats: [],
    ocr_confidence: 1,
    notes_to_human: 'Daily warmup. Authored, not OCR output.',
  };
}

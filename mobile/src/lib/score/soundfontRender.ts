import {
  SpessaSynthProcessor,
  SpessaLog,
  type BasicSoundBank,
} from 'spessasynth_core';
import type { Instrument } from '../../data/types';
import type { Schedule } from './schedule';
import { INSTRUMENT_PROGRAMS } from './soundfontBank';
import {
  EXPRESSION_NEUTRAL,
  SWELL_MIN_S,
  UNMARKED_VELOCITY,
  swell,
} from './expression';

export interface RenderedInstrument {
  pcm: Int16Array;
  sampleRate: number;
  channels: 2;
  durationS: number;
}
const RATE = 44100;
const TAIL = 2;
/**
 * How far a slurred note runs into the next. A bow that changes pitch without
 * changing direction leaves no gap, and the recorded attack of the next note
 * is softened by the one still sounding under it.
 */
const LEGATO_OVERLAP_S = 0.03;
/** How often a held note's expression is updated: finer than a step can be heard. */
const EXPRESSION_STEP_S = 0.02;
// One short passage only (at most ~11 MB); retries at the same tempo need not
// render again. Never cache pending work, errors, or a cancelled render.
let recent:
  { bank: BasicSoundBank; key: string; audio: RenderedInstrument } | undefined;
interface NoteEvent {
  frame: number;
  key: number;
  on: boolean;
  /** Note-on only. */
  velocity?: number;
}

interface ExpressionEvent {
  frame: number;
  value: number;
}

function keyOf(frequency: number, instrument: Instrument): number {
  // ScoreJson stores written pitches. Double bass sounds one octave below
  // its notation; this does not alter the score or its rhythm. The timbre
  // still comes from the real double-bass preset, not another shifted voice.
  return (
    Math.round(69 + 12 * Math.log2(frequency / 440)) +
    (instrument === 'double_bass' ? -12 : 0)
  );
}

function playable(note: Schedule['notes'][number], schedule: Schedule): boolean {
  return (
    Number.isFinite(note.frequency) &&
    note.frequency > 0 &&
    Number.isFinite(note.startS) &&
    note.startS >= 0 &&
    Number.isFinite(note.durationS) &&
    note.durationS > 0 &&
    note.startS < schedule.durationS
  );
}

export function soundfontEvents(
  schedule: Schedule,
  instrument: Instrument = 'violin',
): NoteEvent[] {
  const events: NoteEvent[] = [];
  const notes = schedule.notes.filter((note) => playable(note, schedule));
  const endOfPiece = Math.round(schedule.durationS * RATE);
  for (const note of notes) {
    const key = keyOf(note.frequency, instrument);
    if (key < 0 || key > 127) continue;
    const start = Math.round(note.startS * RATE);
    let end = Math.round(
      Math.min(note.startS + note.durationS, schedule.durationS) * RATE,
    );
    if (note.legato) {
      // Into the next note — but never across a later attack on this key,
      // whose note-on the overlap's note-off would otherwise silence.
      end = Math.min(end + Math.round(LEGATO_OVERLAP_S * RATE), endOfPiece);
      for (const other of notes) {
        const at = Math.round(other.startS * RATE);
        if (at > start && at < end && keyOf(other.frequency, instrument) === key) {
          end = at;
        }
      }
    }
    if (end <= start) continue;
    events.push(
      {
        frame: start,
        key,
        on: true,
        velocity: note.velocity ?? UNMARKED_VELOCITY,
      },
      { frame: end, key, on: false },
    );
  }
  return events.sort(
    (a, b) => a.frame - b.frame || Number(a.on) - Number(b.on),
  );
}

/**
 * How the level moves while notes are held: CC 11, one value per moment.
 *
 * A note long enough to breathe (`SWELL_MIN_S`) gets `swell`'s bloom and ease
 * across its sounded length; any other note starts at the neutral level. One
 * channel carries one expression, so a chord shares its shape — its members
 * start and end together — and a slurred note hands over at the next onset.
 */
export function expressionEvents(schedule: Schedule): ExpressionEvent[] {
  const starts = new Map<number, number>();
  for (const note of schedule.notes) {
    if (!playable(note, schedule)) continue;
    starts.set(note.startS, Math.max(starts.get(note.startS) ?? 0, note.durationS));
  }
  const moments = [...starts].sort((a, b) => a[0] - b[0]);
  const events: ExpressionEvent[] = [];
  let current = EXPRESSION_NEUTRAL;
  const set = (seconds: number, value: number) => {
    if (value === current) return;
    current = value;
    events.push({ frame: Math.round(seconds * RATE), value });
  };
  moments.forEach(([startS, durationS], index) => {
    if (durationS < SWELL_MIN_S) {
      set(startS, EXPRESSION_NEUTRAL);
      return;
    }
    const until = Math.min(
      startS + durationS,
      moments[index + 1]?.[0] ?? Infinity,
      schedule.durationS,
    );
    for (let t = startS; t < until; t += EXPRESSION_STEP_S) {
      set(t, swell((t - startS) / durationS));
    }
  });
  return events;
}

/** One engine and preset per play: no effects/notes leak into a later take.
 * Stereo at 44.1 kHz. The engine owns all filters, modulation and releases.
 * Note events split the audio blocks so rhythm never depends on JS timers.
 */
export async function renderSoundfont(
  schedule: Schedule,
  bank: BasicSoundBank,
  instrument: Instrument,
  cancelled: () => boolean,
): Promise<RenderedInstrument> {
  if (
    !Number.isFinite(schedule.durationS) ||
    schedule.durationS <= 0 ||
    schedule.durationS > 600
  ) {
    throw new Error('Choose a passage shorter than ten minutes to listen.');
  }
  const events = soundfontEvents(schedule, instrument);
  if (!events.length)
    throw new Error('There are no playable notes in this passage.');
  if (cancelled()) throw new Error('Playback cancelled');
  const expression = expressionEvents(schedule);
  const cacheKey = JSON.stringify([
    instrument,
    schedule.durationS,
    events,
    expression,
  ]);
  if (recent?.bank === bank && recent.key === cacheKey) return recent.audio;
  SpessaLog.setLogLevel(false, false, false);
  const synth = new SpessaSynthProcessor(RATE, { eventsEnabled: false });
  synth.soundBankManager.addSoundBank(bank, 'instrument');
  synth.setSystemParameter('interpolationType', 2); // Hermite, not nearest-neighbour.
  synth.setSystemParameter('gain', 0.6);
  synth.setSystemParameter('reverbGain', 0.35);
  synth.setSystemParameter('chorusGain', 0);
  synth.programChange(0, INSTRUMENT_PROGRAMS[instrument]);
  synth.controllerChange(0, 7, 100);
  synth.controllerChange(0, 11, EXPRESSION_NEUTRAL);
  // A hall a string player would practise in: the engine's own (GS Hall 2,
  // about 2 s to die away), sent twice as much as the small room this used to
  // be. The 10 ms before it answers keeps each attack clear of its own echo,
  // which is what a musician copying the rhythm listens for.
  synth.controllerChange(0, 91, 40);
  synth.controllerChange(0, 93, 0);
  synth.reverbProcessor.preDelayTime = 10;
  const frames = Math.ceil((schedule.durationS + TAIL) * RATE);
  const pcm = new Int16Array(frames * 2);
  const left = new Float32Array(128);
  const right = new Float32Array(128);
  let position = 0;
  let event = 0;
  let control = 0;
  let sinceYield = 0;
  try {
    while (position < frames) {
      // Offs, then the level, then ons: a note that starts as another ends
      // starts at its own level, and a repeated key is released before it is
      // struck again.
      while (
        event < events.length &&
        events[event].frame <= position &&
        !events[event].on
      ) {
        synth.noteOff(0, events[event++].key);
      }
      while (
        control < expression.length &&
        expression[control].frame <= position
      ) {
        synth.controllerChange(0, 11, expression[control++].value);
      }
      while (event < events.length && events[event].frame <= position) {
        const next = events[event++];
        if (next.on)
          synth.noteOn(0, next.key, next.velocity ?? UNMARKED_VELOCITY);
        else synth.noteOff(0, next.key);
      }
      const length = Math.min(
        128,
        frames - position,
        (events[event]?.frame ?? frames) - position,
        (expression[control]?.frame ?? frames) - position,
      );
      left.fill(0);
      right.fill(0);
      synth.process(left, right, 0, length);
      for (let i = 0; i < length; i++) {
        // Ease only the very end of the reverb tail; never truncate note releases.
        const fade = Math.min(1, (frames - 1 - position - i) / (RATE * 0.1));
        pcm[(position + i) * 2] = Math.round(
          Math.max(-1, Math.min(1, left[i] * fade)) * 32767,
        );
        pcm[(position + i) * 2 + 1] = Math.round(
          Math.max(-1, Math.min(1, right[i] * fade)) * 32767,
        );
      }
      position += length;
      sinceYield += length;
      if (sinceYield >= 8192) {
        sinceYield = 0;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (cancelled()) throw new Error('Playback cancelled');
      }
    }
    if (cancelled()) throw new Error('Playback cancelled');
    const audio: RenderedInstrument = {
      pcm,
      sampleRate: RATE,
      channels: 2,
      durationS: frames / RATE,
    };
    recent =
      schedule.durationS <= 60 ? { bank, key: cacheKey, audio } : undefined;
    return audio;
  } finally {
    synth.midiChannels.forEach((channel) => channel.stopAllNotes(true));
    synth.soundBankManager.deleteSoundBank('instrument');
  }
}

import {
  MIDIControllers,
  SpessaSynthProcessor,
  SpessaLog,
  type BasicSoundBank,
  type MIDIController,
} from 'spessasynth_core';
import type { Instrument } from '../../data/types';
import type { Schedule } from './schedule';
import { INSTRUMENT_PROGRAMS } from './soundfontBank';
import { Limiter } from './limiter';
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
/**
 * The engine's master gain: how loud Listen is.
 *
 * 0.6 until 2026-09-24: an unmarked melody peaked at −27 to −31 dBFS, 15 dB
 * under the metronome's click, quiet on a phone at any volume. 15 dB up was
 * the first answer and still not enough by the owner's ear; 25 dB up puts an
 * unmarked melody's own peaks at −2.5 to −6 dBFS, and `Limiter` takes the
 * attacks and vibrato peaks that stand above that.
 */
const GAIN = 0.6 * 10 ** (25 / 20);
/** The loudest a sample may be: −1 dBFS, headroom for the phone's converter. */
const CEILING = 10 ** (-1 / 20);
// One short passage only (at most ~11 MB); retries at the same tempo need not
// render again. Never cache pending work, errors, or a cancelled render.
let recent:
  { bank: BasicSoundBank; key: string; audio: RenderedInstrument } | undefined;
interface NoteEvent {
  frame: number;
  key: number;
  on: boolean;
  /** Which of the two channels the note's moment was given. */
  channel: number;
  /** Note-on only. */
  velocity?: number;
}

interface ControlEvent {
  frame: number;
  channel: number;
  controller: MIDIController;
  value: number;
}

const VOLUME_CC = MIDIControllers.mainVolume;
const EXPRESSION_CC = MIDIControllers.expression;
const REVERB_CC = MIDIControllers.reverbDepth;
const CHORUS_CC = MIDIControllers.chorusDepth;
/** Channel volume while a channel is the one sounding. */
const VOLUME = 100;
/** Consecutive moments alternate between this many channels. */
const CHANNELS = 2;
/**
 * How long the note before takes to stop once the next one starts.
 *
 * **Because a string plays one note at a time.** A sampler lets each note ring
 * out its release — 0.3 s on the double bass, 0.5–0.6 s on GeneralUser's viola
 * and cello — under the note after it, which a string does not do: change the
 * note and the old pitch is gone. Two low notes sounding together beat against
 * each other, slowly and loudly, and on the bass that was what the owner heard
 * as muddy and wobbly (2026-09-24). So each moment gets its own channel,
 * alternating, and when the next moment starts the previous channel's volume
 * falls to nothing over this long: short enough that the notes do not beat,
 * long enough to be a crossfade rather than a click.
 */
const HANDOFF_S = 0.06;
const HANDOFF_STEPS = 12;
/**
 * The reverb each instrument is sent to (MIDI CC 91).
 *
 * **A touch for the double bass**, measured rather than preferred: its VSCO
 * recordings already carry the room they were made in — their tails fall 20 dB
 * in 0.6–1.1 s, two to three seconds of ring — and the engine's two-second
 * hall on top of that, at 40 and with the bank's own send besides, was the
 * "echoey" half of the owner's complaint (2026-09-24). None at all left a note
 * that stopped dead; 12, with nothing from the bank, is a room behind it. The
 * violin's recordings fall 20 dB in 0.35 s and GeneralUser's are dry.
 */
const REVERB_SEND: Record<Instrument, number> = {
  violin: 40,
  viola: 40,
  cello: 40,
  double_bass: 12,
};

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

interface Moment {
  startS: number;
  /** The longest note that starts here: a chord is one moment. */
  durationS: number;
  channel: number;
}

/** Every distinct onset, in order, each on the channel after the last one's. */
function moments(schedule: Schedule): Moment[] {
  const starts = new Map<number, number>();
  for (const note of schedule.notes) {
    if (!playable(note, schedule)) continue;
    starts.set(note.startS, Math.max(starts.get(note.startS) ?? 0, note.durationS));
  }
  return [...starts]
    .sort((a, b) => a[0] - b[0])
    .map(([startS, durationS], index) => ({
      startS,
      durationS,
      channel: index % CHANNELS,
    }));
}

export function soundfontEvents(
  schedule: Schedule,
  instrument: Instrument = 'violin',
): NoteEvent[] {
  const events: NoteEvent[] = [];
  const notes = schedule.notes.filter((note) => playable(note, schedule));
  const channelAt = new Map(moments(schedule).map((m) => [m.startS, m.channel]));
  const endOfPiece = Math.round(schedule.durationS * RATE);
  for (const note of notes) {
    const key = keyOf(note.frequency, instrument);
    if (key < 0 || key > 127) continue;
    const channel = channelAt.get(note.startS) ?? 0;
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
        channel,
        velocity: note.velocity ?? UNMARKED_VELOCITY,
      },
      { frame: end, key, on: false, channel },
    );
  }
  return events.sort(
    (a, b) => a.frame - b.frame || Number(a.on) - Number(b.on),
  );
}

/**
 * How the level moves while notes are held: CC 11 on each moment's channel.
 *
 * A note long enough to breathe (`SWELL_MIN_S`) gets `swell`'s bloom and ease
 * across its sounded length; any other note starts at the neutral level. A
 * chord's members share a moment and so a channel and a shape.
 */
export function expressionEvents(schedule: Schedule): ControlEvent[] {
  const all = moments(schedule);
  const events: ControlEvent[] = [];
  const current = Array.from({ length: CHANNELS }, () => EXPRESSION_NEUTRAL);
  const set = (channel: number, seconds: number, value: number) => {
    if (value === current[channel]) return;
    current[channel] = value;
    events.push({
      frame: Math.round(seconds * RATE),
      channel,
      controller: EXPRESSION_CC,
      value,
    });
  };
  all.forEach(({ startS, durationS, channel }, index) => {
    if (durationS < SWELL_MIN_S) {
      set(channel, startS, EXPRESSION_NEUTRAL);
      return;
    }
    const until = Math.min(
      startS + durationS,
      all[index + 1]?.startS ?? Infinity,
      schedule.durationS,
    );
    for (let t = startS; t < until; t += EXPRESSION_STEP_S) {
      set(channel, t, swell((t - startS) / durationS));
    }
  });
  return events;
}

/**
 * The handoff between one moment and the next: CC 7 on the two channels.
 *
 * When a moment starts, its own channel is brought back to full volume first
 * and the previous moment's channel falls to nothing over `HANDOFF_S` —
 * finished early if that channel is needed again sooner, as it is in very fast
 * passages, so a fade can never land on the note it is making room for.
 */
export function handoffEvents(schedule: Schedule): ControlEvent[] {
  const all = moments(schedule);
  const events: ControlEvent[] = [];
  const volume = Array.from({ length: CHANNELS }, () => VOLUME);
  all.forEach(({ startS, channel }, index) => {
    const at = Math.round(startS * RATE);
    if (volume[channel] !== VOLUME) {
      volume[channel] = VOLUME;
      events.push({ frame: at, channel, controller: VOLUME_CC, value: VOLUME });
    }
    const previous = all[index - 1];
    if (!previous) return;
    const reused = all[index + 1];
    const until = Math.min(
      at + Math.round(HANDOFF_S * RATE),
      reused ? Math.round(reused.startS * RATE) - 1 : Infinity,
    );
    for (let step = 1; step <= HANDOFF_STEPS; step++) {
      events.push({
        frame: Math.max(at + 1, Math.round(at + ((until - at) * step) / HANDOFF_STEPS)),
        channel: previous.channel,
        controller: VOLUME_CC,
        value: Math.round(VOLUME * (1 - step / HANDOFF_STEPS)),
      });
    }
    volume[previous.channel] = 0;
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
  // Every control change in one list, in time: the handoff's volume and each
  // moment's expression. Stable, so a restore stays ahead of the fade beside it.
  const expression = [...expressionEvents(schedule), ...handoffEvents(schedule)]
    .map((event, order) => ({ event, order }))
    .sort((a, b) => a.event.frame - b.event.frame || a.order - b.order)
    .map(({ event }) => event);
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
  synth.setSystemParameter('gain', GAIN);
  synth.setSystemParameter('reverbGain', 0.35);
  synth.setSystemParameter('chorusGain', 0);
  for (let channel = 0; channel < CHANNELS; channel++) {
    synth.programChange(channel, INSTRUMENT_PROGRAMS[instrument]);
    synth.controllerChange(channel, VOLUME_CC, VOLUME);
    synth.controllerChange(channel, EXPRESSION_CC, EXPRESSION_NEUTRAL);
    // A hall a string player would practise in: the engine's own (GS Hall 2,
    // about 2 s to die away), at the level `REVERB_SEND` gives this
    // instrument.
    synth.controllerChange(channel, REVERB_CC, REVERB_SEND[instrument]);
    synth.controllerChange(channel, CHORUS_CC, 0);
  }
  // The 10 ms before the hall answers keeps each attack clear of its own
  // echo, which is what a musician copying the rhythm listens for.
  synth.reverbProcessor.preDelayTime = 10;
  const frames = Math.ceil((schedule.durationS + TAIL) * RATE);
  const pcm = new Int16Array(frames * 2);
  const limiter = new Limiter(RATE, CEILING);
  const limited: [number, number] = [0, 0];
  // The limiter hands each sample back `lookahead` samples late; writing it
  // at its own index is what keeps every note on its beat.
  let written = 0;
  const write = () => {
    // Ease only the very end of the reverb tail; never truncate note releases.
    const fade = Math.min(1, (frames - 1 - written) / (RATE * 0.1));
    pcm[written * 2] = Math.round(limited[0] * fade * 32767);
    pcm[written * 2 + 1] = Math.round(limited[1] * fade * 32767);
    written += 1;
  };
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
        const off = events[event++];
        synth.noteOff(off.channel, off.key);
      }
      while (
        control < expression.length &&
        expression[control].frame <= position
      ) {
        const change = expression[control++];
        synth.controllerChange(change.channel, change.controller, change.value);
      }
      while (event < events.length && events[event].frame <= position) {
        const next = events[event++];
        if (next.on)
          synth.noteOn(
            next.channel,
            next.key,
            next.velocity ?? UNMARKED_VELOCITY,
          );
        else synth.noteOff(next.channel, next.key);
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
        if (limiter.push(left[i], right[i], limited)) write();
      }
      position += length;
      sinceYield += length;
      if (sinceYield >= 8192) {
        sinceYield = 0;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (cancelled()) throw new Error('Playback cancelled');
      }
    }
    // The last `lookahead` samples are still inside the limiter.
    while (written < frames) {
      if (limiter.push(0, 0, limited)) write();
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

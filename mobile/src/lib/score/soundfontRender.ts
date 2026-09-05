import {
  SpessaSynthProcessor,
  SpessaLog,
  type BasicSoundBank,
} from 'spessasynth_core';
import type { Instrument } from '../../data/types';
import type { Schedule } from './schedule';
import { INSTRUMENT_PROGRAMS } from './soundfontBank';

export interface RenderedInstrument {
  pcm: Int16Array;
  sampleRate: number;
  channels: 2;
  durationS: number;
}
const RATE = 44100;
const TAIL = 2;
// One short passage only (at most ~11 MB); retries at the same tempo need not
// render again. Never cache pending work, errors, or a cancelled render.
let recent:
  { bank: BasicSoundBank; key: string; audio: RenderedInstrument } | undefined;
interface NoteEvent {
  frame: number;
  key: number;
  on: boolean;
}

export function soundfontEvents(schedule: Schedule): NoteEvent[] {
  const events: NoteEvent[] = [];
  for (const note of schedule.notes) {
    if (
      !Number.isFinite(note.frequency) ||
      note.frequency <= 0 ||
      !Number.isFinite(note.startS) ||
      note.startS < 0 ||
      !Number.isFinite(note.durationS) ||
      note.durationS <= 0 ||
      note.startS >= schedule.durationS
    )
      continue;
    const key = Math.round(69 + 12 * Math.log2(note.frequency / 440));
    if (key < 0 || key > 127) continue;
    const start = Math.round(note.startS * RATE);
    const end = Math.round(
      Math.min(note.startS + note.durationS, schedule.durationS) * RATE,
    );
    if (end <= start) continue;
    events.push(
      { frame: start, key, on: true },
      { frame: end, key, on: false },
    );
  }
  return events.sort(
    (a, b) => a.frame - b.frame || Number(a.on) - Number(b.on),
  );
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
  const events = soundfontEvents(schedule);
  if (!events.length)
    throw new Error('There are no playable notes in this passage.');
  if (cancelled()) throw new Error('Playback cancelled');
  const cacheKey = JSON.stringify([instrument, schedule.durationS, events]);
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
  synth.controllerChange(0, 91, 20); // Small room, not a concert-hall wash.
  synth.controllerChange(0, 93, 0);
  const frames = Math.ceil((schedule.durationS + TAIL) * RATE);
  const pcm = new Int16Array(frames * 2);
  const left = new Float32Array(128);
  const right = new Float32Array(128);
  let position = 0;
  let event = 0;
  let sinceYield = 0;
  try {
    while (position < frames) {
      while (event < events.length && events[event].frame <= position) {
        const next = events[event++];
        if (next.on) synth.noteOn(0, next.key, 76);
        else synth.noteOff(0, next.key);
      }
      const length = Math.min(
        128,
        frames - position,
        (events[event]?.frame ?? frames) - position,
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

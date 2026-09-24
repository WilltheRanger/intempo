// Test-only Node API; the Expo application does not include Node type globals.
// @ts-expect-error Provided by the Vitest Node runtime.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('stb-vorbis', async () => import('./sf2OnlyDecoder'));
vi.mock('expo-asset', () => ({
  Asset: { fromModule: (id: number) => ({ uri: String(id) }) },
}));
vi.mock('./soundfontAssets', () => ({
  SOUNDFONT_ASSETS: { violin: 1, viola: 2, cello: 3, double_bass: 4 },
}));
const read = vi.hoisted(() => vi.fn());
vi.mock('./sampleBytes', () => ({ readSampleBytes: read }));
import { loadSoundfont, parseSoundfont } from './soundfontBank';
import {
  expressionEvents,
  handoffEvents,
  renderSoundfont,
  soundfontEvents,
} from './soundfontRender';
import type { Instrument } from '../../data/types';
import type { Schedule } from './schedule';

function bytes(instrument: Instrument): ArrayBuffer {
  const data = readFileSync(
    new URL(`../../../assets/soundfonts/${instrument}.sf2`, import.meta.url),
  );
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}
function passage(frequency = 220): Schedule {
  return {
    bpm: 60,
    durationS: 0.5,
    notes: [
      {
        startS: 0.05,
        durationS: 0.25,
        frequency,
        measureNumber: 1,
        globalIndex: 0,
      },
    ],
  };
}
afterEach(() => vi.unstubAllGlobals());

it('renders all four actual presets without WebAssembly, with stereo releases and no clipped samples', async () => {
  vi.stubGlobal('WebAssembly', undefined);
  for (const [instrument, frequency] of [
    ['violin', 440],
    ['viola', 220],
    ['cello', 110],
    ['double_bass', 55],
  ] as [Instrument, number][]) {
    const bank = parseSoundfont(bytes(instrument), instrument);
    const audio = await renderSoundfont(
      passage(frequency),
      bank,
      instrument,
      () => false,
    );
    expect(audio.sampleRate).toBe(44100);
    expect(audio.channels).toBe(2);
    expect(audio.durationS).toBe(2.5);
    expect(audio.pcm.slice(0, 4000).every((x) => x === 0)).toBe(true);
    expect(audio.pcm.some((x) => Math.abs(x) > 100)).toBe(true);
    expect(audio.pcm.every((x) => Math.abs(x) < 32767)).toBe(true);
    expect(audio.pcm.slice(44100, 60000).some((x) => Math.abs(x) > 5)).toBe(
      true,
    );
    expect(audio.pcm.slice(-2)).toEqual(new Int16Array(2));
  }
}, 20000);

it('retains exact score pitches and event times, with note off before repeat note on', () => {
  const score = passage(82.406889);
  score.notes.push({
    ...score.notes[0],
    startS: 0.3,
    durationS: 0.1,
    globalIndex: 1,
  });
  const original = JSON.stringify(score);
  const events = soundfontEvents(score);
  expect(events.map((e) => e.key)).toEqual([40, 40, 40, 40]);
  expect(events[0].frame).toBe(2205);
  expect(events[1]).toMatchObject({ frame: 13230, on: false });
  expect(events[2]).toMatchObject({ frame: 13230, on: true });
  expect(JSON.stringify(score)).toBe(original);
});

it('rejects corrupt or wrong-instrument downloads', () => {
  expect(() => parseSoundfont(new ArrayBuffer(100), 'violin')).toThrow();
  expect(() => parseSoundfont(bytes('cello'), 'violin')).toThrow('Incorrect');
});

it('plays written bass E2 at sounding E1 without changing notation or timing', () => {
  const score = passage(82.406889);
  const original = JSON.stringify(score);
  expect(
    soundfontEvents(score, 'double_bass').map((event) => event.key),
  ).toEqual([28, 28]);
  for (const instrument of ['violin', 'viola', 'cello'] as Instrument[]) {
    expect(
      soundfontEvents(score, instrument).map((event) => event.key),
    ).toEqual([40, 40]);
  }
  expect(
    soundfontEvents(score, 'double_bass').map((event) => event.frame),
  ).toEqual(soundfontEvents(score).map((event) => event.frame));
  expect(JSON.stringify(score)).toBe(original);
});

it('retries failed loading and deduplicates successful loading', async () => {
  read.mockRejectedValueOnce(new Error('offline'));
  await expect(loadSoundfont('viola')).rejects.toThrow('offline');
  read.mockResolvedValueOnce(bytes('viola'));
  const first = loadSoundfont('viola');
  expect(loadSoundfont('viola')).toBe(first);
  expect((await first).presets[0].program).toBe(41);
  expect(read).toHaveBeenCalledTimes(2);
});

it('cancels while rendering and refuses unbounded or empty schedules', async () => {
  const bank = parseSoundfont(bytes('double_bass'), 'double_bass');
  let checks = 0;
  await expect(
    renderSoundfont(passage(), bank, 'double_bass', () => ++checks > 1),
  ).rejects.toThrow('cancelled');
  await expect(
    renderSoundfont(
      { ...passage(), durationS: Infinity },
      bank,
      'double_bass',
      () => false,
    ),
  ).rejects.toThrow('ten minutes');
  await expect(
    renderSoundfont(
      { ...passage(), notes: [] },
      bank,
      'double_bass',
      () => false,
    ),
  ).rejects.toThrow('no playable');
});

it('plays each note at its own velocity, and an unmarked one at mezzo-forte', () => {
  const score = passage(440);
  score.notes.push({ ...score.notes[0], startS: 0.3, globalIndex: 1, velocity: 100 });
  const ons = soundfontEvents(score).filter((event) => event.on);
  expect(ons.map((event) => event.velocity)).toEqual([72, 100]);
});

it('runs a slurred note into the next, but never across the same key struck again', () => {
  const note = passage(440).notes[0];
  const into = (next: number) =>
    soundfontEvents({
      bpm: 60,
      durationS: 1,
      notes: [
        { ...note, startS: 0, durationS: 0.25, legato: true },
        { ...note, startS: 0.25, durationS: 0.25, frequency: next, globalIndex: 1 },
      ],
    });
  // A different pitch: 30 ms of overlap, so there is no gap between them.
  const joined = into(493.88);
  const firstOff = joined.find((event) => !event.on && event.key === 69)!;
  expect(firstOff.frame).toBe(Math.round(0.28 * 44100));
  // The same pitch: the overlap's note-off would silence the new attack, so
  // the note ends exactly where the next begins, and is released first.
  const repeated = into(440);
  expect(repeated.map((event) => [event.frame, event.on])).toEqual([
    [0, true],
    [11025, false],
    [11025, true],
    [22050, false],
  ]);
});

it('lets a held note bloom and ease, and leaves a short one level', () => {
  const note = passage(440).notes[0];
  const held = expressionEvents({
    bpm: 60,
    durationS: 3,
    notes: [{ ...note, startS: 0, durationS: 2 }],
  });
  const values = held.map((event) => event.value);
  const peak = values.indexOf(Math.max(...values));
  expect(values[peak]).toBe(127);
  expect(values.slice(0, peak)).toEqual([...values.slice(0, peak)].sort((a, b) => a - b));
  expect(values.slice(peak)).toEqual([...values.slice(peak)].sort((a, b) => b - a));
  expect(held.at(-1)!.frame).toBeLessThan(2 * 44100);

  // Short notes: nothing to shape, and nothing sent while it stays neutral.
  expect(expressionEvents(passage(440))).toEqual([]);
  // After a held note, the next short one is on the other channel and starts
  // at the neutral level: nothing is sent for it at all.
  const after = expressionEvents({
    bpm: 60,
    durationS: 3,
    notes: [
      { ...note, startS: 0, durationS: 2 },
      { ...note, startS: 2, durationS: 0.25, globalIndex: 1 },
    ],
  });
  expect(after.every((event) => event.channel === 0)).toBe(true);
  expect(after.at(-1)!.frame).toBeLessThan(2 * 44100);
});

it('carries a note under a hairpin from one level to the other, in a straight line', () => {
  const note = passage(440).notes[0];
  const rising = expressionEvents({
    bpm: 60,
    durationS: 3,
    notes: [{ ...note, startS: 0, durationS: 2, expression: { from: 76, to: 120 } }],
  }).map((event) => event.value);
  expect(rising[0]).toBe(76);
  expect(rising.at(-1)!).toBeGreaterThan(118);
  expect(rising).toEqual([...rising].sort((a, b) => a - b));
  // No bloom: a crescendo is the shape, not a swell on top of it.
  expect(Math.max(...rising)).toBeLessThanOrEqual(120);

  // A short note is carried too — the hairpin is what moves it, not its length.
  const short = expressionEvents({
    bpm: 60,
    durationS: 1,
    notes: [{ ...note, startS: 0, durationS: 0.5, expression: { from: 120, to: 90 } }],
  }).map((event) => event.value);
  expect(short.at(-1)!).toBeLessThan(95);
});

describe('the handoff from one note to the next', () => {
  const note = passage(440).notes[0];
  const line = (starts: number[], durationS = 0.4) => ({
    bpm: 60,
    durationS: starts.at(-1)! + 1,
    notes: starts.map((startS, index) => ({
      ...note,
      startS,
      durationS,
      frequency: 220 * 2 ** (index / 12),
      globalIndex: index,
    })),
  });

  it('puts consecutive notes on alternate channels, and a chord on one', () => {
    const chord: Schedule = {
      ...line([0, 0.5]),
      notes: [...line([0, 0.5]).notes, { ...note, startS: 0, durationS: 0.4, frequency: 330 }],
    };
    const ons = soundfontEvents(chord).filter((event) => event.on);
    expect(ons.map((event) => [event.frame, event.channel])).toEqual([
      [0, 0],
      [0, 0],
      [22050, 1],
    ]);
  });

  it('fades the note before to nothing within 60 ms of the next one starting', () => {
    // A string plays one note at a time; a sampler lets each release ring
    // under the next, and two low notes beating was the bass's mud.
    const fades = handoffEvents(line([0, 0.5])).filter((event) => event.channel === 0);
    expect(fades.at(-1)).toMatchObject({ value: 0 });
    expect(fades[0].frame).toBeGreaterThan(22050);
    expect(fades.at(-1)!.frame).toBeLessThanOrEqual(22050 + Math.round(0.06 * 44100));
    const values = fades.map((event) => event.value);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it('brings a channel back before its next note, and never fades onto it', () => {
    // Very fast notes, 40 ms apart: shorter than the fade. While a note is
    // the one sounding — from its start to the next note's — nothing may turn
    // its channel down, and its channel is back at full volume as it starts.
    const starts = [0, 0.04, 0.08, 0.12, 0.16];
    const events = handoffEvents(line(starts, 0.035));
    const frame = (seconds: number) => Math.round(seconds * 44100);
    starts.forEach((startS, index) => {
      const channel = index % 2;
      const until = starts[index + 1] ?? Infinity;
      const own = events.filter(
        (event) => event.channel === channel && event.frame >= frame(startS) && event.frame < frame(until),
      );
      expect(own.filter((event) => event.value < 100)).toEqual([]);
      if (index >= 2) expect(own[0]).toMatchObject({ frame: frame(startS), value: 100 });
    });
  });
});

function peakDb(pcm: Int16Array): number {
  let peak = 0;
  for (const sample of pcm) peak = Math.max(peak, Math.abs(sample));
  return 20 * Math.log10(peak / 32768);
}

it('plays an ordinary melody close to full scale', async () => {
  // At the first gain a melody peaked at −27 to −31 dBFS; at the second,
  // −12 to −16, and the owner still could not hear it well on a phone.
  const bank = parseSoundfont(bytes('violin'), 'violin');
  const melody: Schedule = {
    bpm: 80,
    durationS: 3,
    notes: [392, 440, 493.88, 523.25].map((frequency, index) => ({
      startS: index * 0.75,
      durationS: 0.69,
      frequency,
      measureNumber: 1,
      globalIndex: index,
    })),
  };
  const audio = await renderSoundfont(melody, bank, 'violin', () => false);
  expect(peakDb(audio.pcm)).toBeGreaterThan(-6);
  expect(peakDb(audio.pcm)).toBeLessThanOrEqual(-1);
});

it('holds the loudest chords a page can ask for under the ceiling, instead of clipping them', async () => {
  // Accented fff triple stops peak about 14 dB over full scale at the playing
  // gain, and a clamp there is audible distortion.
  const bank = parseSoundfont(bytes('violin'), 'violin');
  const chords: Schedule = {
    bpm: 80,
    durationS: 6,
    notes: [0, 1.5, 3, 4.5].flatMap((startS, index) =>
      [196, 293.66, 493.88, 783.99].map((frequency) => ({
        startS,
        durationS: 1.4,
        frequency,
        measureNumber: 1,
        globalIndex: index,
        velocity: 127,
      })),
    ),
  };
  const audio = await renderSoundfont(chords, bank, 'violin', () => false);
  expect(peakDb(audio.pcm)).toBeLessThanOrEqual(-1);
  // Held at the ceiling, not turned down to silence.
  expect(peakDb(audio.pcm)).toBeGreaterThan(-2);
});

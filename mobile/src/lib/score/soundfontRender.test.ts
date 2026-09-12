// Test-only Node API; the Expo application does not include Node type globals.
// @ts-expect-error Provided by the Vitest Node runtime.
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
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
import { renderSoundfont, soundfontEvents } from './soundfontRender';
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

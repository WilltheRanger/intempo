import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  begin: vi.fn(),
  resume: vi.fn(),
  prepare: vi.fn(),
  context: null as any,
  player: null as any,
  file: null as any,
}));
vi.mock('./sampledPlayback', () => ({ beginSampledPlayback: state.begin }));
vi.mock('../audio/context.web', () => ({
  audioContext: () => state.context,
  resumeAudio: state.resume,
}));
vi.mock('../audio/session.web', () => ({ prepareForPlayback: state.prepare }));
vi.mock('../audio/session', () => ({ prepareForPlayback: state.prepare }));
vi.mock('expo-file-system', () => ({
  Paths: { cache: 'cache' },
  File: class {
    uri = 'file:///cache/listen.wav';
    create = vi.fn();
    write = vi.fn();
    delete = vi.fn();
    constructor() {
      state.file = this;
    }
  },
}));
vi.mock('expo-audio', () => ({
  AudioModule: {
    AudioPlayer: class {
      currentTime = 0;
      currentStatus = { didJustFinish: false };
      play = vi.fn();
      remove = vi.fn();
      constructor() {
        state.player = this;
      }
    },
  },
}));
import { playSchedule as web } from '../scorePlayer.web';
import { playSchedule as native } from '../scorePlayer';
import type { Schedule } from './schedule';
const schedule: Schedule = {
  bpm: 60,
  durationS: 0.5,
  notes: [
    {
      startS: 0,
      durationS: 0.5,
      frequency: 110,
      measureNumber: 1,
      globalIndex: 0,
    },
  ],
};
const audio = {
  pcm: new Int16Array([1000, -1000, 2000, -2000]),
  channels: 2,
  sampleRate: 44100,
  durationS: 2.5,
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  state.begin.mockReturnValue({ stop: vi.fn(), isPlaying: () => true });
  state.prepare.mockResolvedValue(undefined);
  state.context = {
    currentTime: 0,
    destination: {},
    createBuffer: vi.fn(() => {
      const channels = [new Float32Array(2), new Float32Array(2)];
      return { getChannelData: (c: number) => channels[c] };
    }),
    createBufferSource: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    })),
  };
});
afterEach(() => vi.useRealTimers());

it('web unlocks during the tap, sends stereo to the speaker, and allows the release tail', async () => {
  const progress = vi.fn();
  const finish = vi.fn();
  web(schedule, { voice: 'double_bass', onProgress: progress });
  expect(state.resume).toHaveBeenCalledWith(state.context);
  expect(state.begin.mock.calls[0][1]).toBe('double_bass');
  const cleanup = await state.begin.mock.calls[0][3](
    audio,
    () => false,
    finish,
  );
  expect(state.context.createBuffer).toHaveBeenCalledWith(2, 2, 44100);
  const buffer = state.context.createBuffer.mock.results[0].value;
  expect(buffer.getChannelData(0)[0]).toBeCloseTo(1000 / 32768);
  expect(buffer.getChannelData(1)[0]).toBeCloseTo(-1000 / 32768);
  state.context.currentTime = 1;
  vi.advanceTimersByTime(50);
  expect(finish).not.toHaveBeenCalled();
  expect(progress).toHaveBeenLastCalledWith(0.5, 0.5);
  cleanup();
  expect(
    state.context.createBufferSource.mock.results[0].value.stop,
  ).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('native configures playback, writes stereo WAV at the actual sample rate, and releases resources', async () => {
  const finish = vi.fn();
  native(schedule, { voice: 'cello' });
  const cleanup = await state.begin.mock.calls[0][3](
    audio,
    () => false,
    finish,
  );
  expect(state.prepare).toHaveBeenCalled();
  const bytes = state.file.write.mock.calls[0][0] as Uint8Array;
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(header.getUint16(22, true)).toBe(2);
  expect(header.getUint32(24, true)).toBe(44100);
  expect(state.player.play).toHaveBeenCalled();
  state.player.currentTime = 1;
  vi.advanceTimersByTime(100);
  expect(finish).not.toHaveBeenCalled();
  cleanup();
  expect(state.player.remove).toHaveBeenCalledOnce();
  expect(state.file.delete).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('cancel before output allocation creates no web audio node or native file', async () => {
  web(schedule, { voice: 'violin' });
  await state.begin.mock.calls[0][3](audio, () => true, vi.fn());
  expect(state.context.createBufferSource).not.toHaveBeenCalled();
  state.file = null;
  native(schedule, { voice: 'viola' });
  await state.begin.mock.calls[1][3](audio, () => true, vi.fn());
  expect(state.file).toBeNull();
});

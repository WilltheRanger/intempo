/**
 * The recorder contract, shared by the native and web implementations.
 *
 * Both write the same thing — mono 16-bit PCM in a WAV container at whatever
 * rate the hardware gave — so everything downstream of `stop()` is
 * platform-agnostic.
 */
export interface Recording {
  audio: Blob;
  filename: string;
  /** What the hardware actually delivered, for the log if a take reads oddly. */
  sampleRate: number;
  seconds: number;
  /** True when the take hit `MAX_TAKE_SECONDS` and the tail was dropped. */
  truncated: boolean;
}

export interface Recorder {
  stop(): Promise<Recording>;
  /** Abandons the take without producing a file. Safe to call twice. */
  cancel(): void;
}

/**
 * Longest take we will hold in memory.
 *
 * Mono 16-bit at 48 kHz is 96 KB a second, so this is about 86 MB — the point
 * where a phone starts to be at risk. Past it the recorder stops accumulating
 * and `stop()` returns what it has with `truncated: true`, because losing the
 * tail of a very long take beats losing the take to a crash. No take a
 * musician means to submit is fifteen minutes long.
 *
 * **This is no longer the binding limit** — see `maxTakeSamples`. It stays
 * because it is the *memory* argument, which is a different argument from the
 * one that actually bites first, and a single number would have hidden that.
 */
export const MAX_TAKE_SECONDS = 15 * 60;

/**
 * What the storage bucket will accept for one file.
 *
 * 50 MB, which is the `audio-uploads` bucket's `file_size_limit` and the
 * Supabase default. Uncompressed audio reaches it faster than the memory limit
 * above does: at 48 kHz mono this is **9 minutes 6 seconds**, against a
 * fifteen-minute recorder.
 *
 * That gap is not a rounding difference, it is a lost take. A musician records
 * twelve minutes, stops, waits through the upload, and it is refused — after
 * the playing, which is the one part that cannot be repeated.
 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Bytes of WAV header written ahead of the samples. */
const WAV_HEADER_BYTES = 44;

/** 16-bit samples. */
const BYTES_PER_SAMPLE = 2;

/**
 * How many samples a take may hold, at the rate the hardware actually gave us.
 *
 * The smaller of two limits that exist for different reasons: what a phone can
 * hold, and what the bucket will take. Computed rather than written down,
 * because it depends on the sample rate — a device that insists on 44.1 kHz
 * gets nearly a minute more than one running at 48, and a constant in seconds
 * could only be right for one of them.
 *
 * One home for the arithmetic. Both recorders multiplied it out themselves,
 * which is exactly how the fifteen-minute figure came to be enforced in two
 * places while being achievable in neither.
 */
export function maxTakeSamples(sampleRate: number, channels: number): number {
  const byMemory = sampleRate * channels * MAX_TAKE_SECONDS;
  const byUpload = Math.floor(
    (MAX_UPLOAD_BYTES - WAV_HEADER_BYTES) / BYTES_PER_SAMPLE,
  );
  return Math.max(1, Math.min(byMemory, byUpload));
}

/** The musician said no, or has said no before and the OS is remembering. */
export class MicrophonePermissionError extends Error {
  constructor() {
    super('Microphone permission was not granted.');
    this.name = 'MicrophonePermissionError';
  }
}

/** No microphone, or a browser without the APIs this needs. */
export class MicrophoneUnavailableError extends Error {
  constructor(message = 'No microphone is available on this device.') {
    super(message);
    this.name = 'MicrophoneUnavailableError';
  }
}

/** A take that captured nothing — a muted input, or a stop before any audio. */
export class EmptyRecordingError extends Error {
  constructor() {
    super('The recording captured no audio.');
    this.name = 'EmptyRecordingError';
  }
}

/** `take-2026-08-16T19-04-11.wav`. Colons are illegal in object keys. */
export function takeFilename(startedAt: Date): string {
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
  return `take-${stamp}.wav`;
}

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
 */
export const MAX_TAKE_SECONDS = 15 * 60;

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

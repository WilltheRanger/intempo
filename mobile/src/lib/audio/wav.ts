/**
 * 16-bit PCM samples to a WAV file.
 *
 * Uncompressed on purpose. The analysis pipeline reads note attacks, and every
 * lossy codec — AAC, Opus, MP3 — smears exactly the transient it measures. WAV
 * is also the one container both platforms and every decoder agree on without
 * an ffmpeg fallback on the server.
 *
 * The header carries the true sample rate, whatever the hardware handed us, so
 * the backend's resampler has the right number to work from. Nothing here
 * resamples: the server loads at 22.05 kHz with a known-good resampler, and
 * doing it twice would only add error.
 */

/** Canonical PCM WAV header: RIFF, fmt, data. */
const HEADER_BYTES = 44;
const PCM_FORMAT = 1;
const BITS_PER_SAMPLE = 16;

export interface WavInput {
  /** Interleaved 16-bit samples, in capture order. */
  chunks: Int16Array[];
  /** The rate the hardware actually delivered, not the rate we asked for. */
  sampleRate: number;
  channels: number;
}

/** How many samples are in a set of chunks. */
export function sampleCount(chunks: Int16Array[]): number {
  return chunks.reduce((total, chunk) => total + chunk.length, 0);
}

/** Seconds of audio in a set of chunks. */
export function durationOf(
  chunks: Int16Array[],
  sampleRate: number,
  channels: number,
): number {
  if (sampleRate <= 0 || channels <= 0) {
    return 0;
  }
  return sampleCount(chunks) / (sampleRate * channels);
}

/**
 * The WAV file as bytes.
 *
 * Separate from `encodeWav` because not every caller wants a `Blob`: uploading
 * a take does, and writing one to disk on a device wants the bytes themselves.
 *
 * One allocation for the whole file rather than assembling parts: the header
 * has to state the data length, so the length has to be known first anyway.
 */
export function encodeWavBytes({ chunks, sampleRate, channels }: WavInput): Uint8Array {
  const samples = sampleCount(chunks);
  const dataBytes = samples * (BITS_PER_SAMPLE / 8);
  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  const blockAlign = channels * (BITS_PER_SAMPLE / 8);

  writeAscii(view, 0, 'RIFF');
  // Everything after this field, so the file length minus the 8 bytes of
  // "RIFF" and the size itself.
  view.setUint32(4, HEADER_BYTES - 8 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');

  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk length for PCM
  view.setUint16(20, PCM_FORMAT, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);

  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  // Little-endian explicitly rather than by setting an Int16Array over the
  // buffer: typed arrays take the platform's endianness, and a big-endian
  // device would write a file that decodes as noise.
  let offset = HEADER_BYTES;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      view.setInt16(offset, chunk[i], true);
      offset += 2;
    }
  }

  return new Uint8Array(buffer);
}

/** The same file, wrapped for anything that uploads or reads it as a `Blob`. */
export function encodeWav(input: WavInput): Blob {
  // `slice()` so the Blob owns its own copy — a view over a buffer that is
  // reused later would change under it.
  return new Blob([encodeWavBytes(input).slice().buffer], { type: 'audio/wav' });
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/**
 * Float samples in [-1, 1] to 16-bit, clipped rather than wrapped.
 *
 * @test-seam the executable copy of a rule that also lives in
 * `pcm-recorder.worklet.js`, which is the copy the microphone runs.
 *
 * A worklet runs in `AudioWorkletGlobalScope` and cannot import from the app
 * bundle, so the rule genuinely cannot be shared — which leaves the worst
 * arrangement available, the copy with the tests not being the copy that runs.
 * `audioRecorder.worklet.test.ts` reads the worklet's source and holds the two
 * to the same asymmetric scaling (`0x8000` down, `0x7fff` up), so this one is
 * the specification and that test is what stops them drifting.
 */
export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, input[i]));
    // Asymmetric on purpose: the negative range has one more step than the
    // positive one, and scaling both by 0x7fff would waste it.
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out;
}

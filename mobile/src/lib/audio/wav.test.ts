import { describe, expect, it } from 'vitest';

import {
  durationOf,
  encodeWav,
  encodeWavBytes,
  floatToPcm16,
  sampleCount,
} from './wav';

/**
 * The file every take and every rendered score is written as.
 *
 * It had no tests. Four modules encode through it — both recorders, the
 * metronome click and the native score player — and a wrong header is not a
 * subtle failure: the server's decoder rejects the upload, or the phone plays
 * nothing at all. Neither is visible from anywhere in this repository, because
 * nothing here has ever decoded one.
 *
 * Two of the assertions below exist because the module *claims* something a
 * reader cannot check by eye:
 *
 *  - the samples are written little-endian **explicitly**, since a typed array
 *    over the buffer would take the platform's endianness and a big-endian
 *    device would write a file that decodes as noise;
 *  - `floatToPcm16` scales the negative range by `0x8000` and the positive by
 *    `0x7fff`, because two's complement has one more step below zero and
 *    scaling both by `0x7fff` would waste it.
 */

const HEADER_BYTES = 44;

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

describe('the WAV header', () => {
  const bytes = encodeWavBytes({
    chunks: [Int16Array.from([1, -1, 2, -2])],
    sampleRate: 44100,
    channels: 2,
  });
  const dv = view(bytes);

  it('is a canonical PCM RIFF file', () => {
    expect(ascii(bytes, 0, 4)).toBe('RIFF');
    expect(ascii(bytes, 8, 4)).toBe('WAVE');
    expect(ascii(bytes, 12, 4)).toBe('fmt ');
    expect(ascii(bytes, 36, 4)).toBe('data');
    expect(dv.getUint32(16, true)).toBe(16); // fmt chunk length for PCM
    expect(dv.getUint16(20, true)).toBe(1); // format 1 = uncompressed PCM
    expect(dv.getUint16(34, true)).toBe(16); // bits per sample
  });

  it('states sizes a decoder can trust', () => {
    const dataBytes = 4 * 2;

    // "Everything after this field": the file minus "RIFF" and the size itself.
    expect(dv.getUint32(4, true)).toBe(HEADER_BYTES - 8 + dataBytes);
    expect(dv.getUint32(40, true)).toBe(dataBytes);
    expect(bytes.length).toBe(HEADER_BYTES + dataBytes);
  });

  it('states the rate the hardware gave, and the arithmetic that follows from it', () => {
    // The docstring's reason for carrying the true rate: the backend's
    // resampler works from this number. A byte rate that disagrees with it
    // makes a decoder play the take at the wrong speed — which this app would
    // then measure and call rushing.
    expect(dv.getUint32(24, true)).toBe(44100);
    expect(dv.getUint16(22, true)).toBe(2); // channels
    expect(dv.getUint16(32, true)).toBe(4); // block align: 2 channels x 2 bytes
    expect(dv.getUint32(28, true)).toBe(44100 * 4); // byte rate
  });
});

describe('the samples', () => {
  it('are written little-endian whatever the platform is', () => {
    // The claim the module makes in as many words. `0x0102` is asymmetric, so
    // a big-endian write reads back as `0x0201` — this is the one assertion
    // that can tell the two apart.
    const bytes = encodeWavBytes({
      chunks: [Int16Array.from([0x0102])],
      sampleRate: 8000,
      channels: 1,
    });

    expect(bytes[HEADER_BYTES]).toBe(0x02);
    expect(bytes[HEADER_BYTES + 1]).toBe(0x01);
  });

  it('run the chunks together in capture order', () => {
    // A recorder delivers buffers as they arrive. Concatenating them wrongly
    // is a take with its middle out of order, and nothing downstream could
    // tell that from a musician playing it that way.
    const bytes = encodeWavBytes({
      chunks: [Int16Array.from([1, 2]), Int16Array.from([3]), Int16Array.from([4, 5])],
      sampleRate: 8000,
      channels: 1,
    });
    const dv = view(bytes);
    const read = [0, 1, 2, 3, 4].map((i) => dv.getInt16(HEADER_BYTES + i * 2, true));

    expect(read).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps the extremes of the 16-bit range intact', () => {
    const bytes = encodeWavBytes({
      chunks: [Int16Array.from([32767, -32768, 0])],
      sampleRate: 8000,
      channels: 1,
    });
    const dv = view(bytes);

    expect(dv.getInt16(HEADER_BYTES, true)).toBe(32767);
    expect(dv.getInt16(HEADER_BYTES + 2, true)).toBe(-32768);
    expect(dv.getInt16(HEADER_BYTES + 4, true)).toBe(0);
  });

  it('writes a valid empty file rather than refusing', () => {
    // A cancelled take can have no samples at all, and the caller decides what
    // that means (`lib/audio/level.ts` does). This should not be where it
    // fails.
    const bytes = encodeWavBytes({ chunks: [], sampleRate: 8000, channels: 1 });

    expect(bytes.length).toBe(HEADER_BYTES);
    expect(view(bytes).getUint32(40, true)).toBe(0);
  });
});

describe('floatToPcm16', () => {
  it('uses the extra step below zero that two’s complement has', () => {
    // The module's own claim: scaling both sides by 0x7fff would leave the
    // most negative sample unreachable.
    expect(floatToPcm16(Float32Array.from([-1]))[0]).toBe(-32768);
    expect(floatToPcm16(Float32Array.from([1]))[0]).toBe(32767);
  });

  it('clips out-of-range input rather than wrapping it', () => {
    // Wrapping turns a loud passage into a full-scale sign flip on every
    // sample — which is an onset, at every one of them, in the app that
    // measures onsets.
    const out = floatToPcm16(Float32Array.from([2, -2, 1e9, -1e9]));

    expect(Array.from(out)).toEqual([32767, -32768, 32767, -32768]);
  });

  it('sends silence through as silence', () => {
    expect(Array.from(floatToPcm16(new Float32Array(4)))).toEqual([0, 0, 0, 0]);
  });
});

describe('counting', () => {
  it('measures duration across chunks and channels', () => {
    const chunks = [new Int16Array(8000), new Int16Array(8000)];

    expect(sampleCount(chunks)).toBe(16000);
    expect(durationOf(chunks, 8000, 1)).toBe(2);
    // Interleaved stereo holds two samples per frame, so the same buffer is
    // half as long in time.
    expect(durationOf(chunks, 8000, 2)).toBe(1);
  });

  it('returns zero rather than Infinity for a nonsense rate', () => {
    // `durationOf` guards its divisor. A NaN or Infinity duration reaching the
    // empty-take check would make it compare false and let the take through.
    expect(durationOf([new Int16Array(10)], 0, 1)).toBe(0);
    expect(durationOf([new Int16Array(10)], 8000, 0)).toBe(0);
  });
});

describe('encodeWav', () => {
  it('wraps the same bytes as a Blob that owns its copy', async () => {
    const input = { chunks: [Int16Array.from([7, -7])], sampleRate: 8000, channels: 1 };
    const blob = encodeWav(input);

    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(HEADER_BYTES + 4);
    const round = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(round)).toEqual(Array.from(encodeWavBytes(input)));
  });
});

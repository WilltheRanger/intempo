/**
 * The native half of `filePreview.web.ts`: nothing yet.
 *
 * Reading a picked file's length and shape on a phone needs a decoder this
 * build does not carry. The Upload screen draws the name and size, and no
 * waveform, rather than a made-up one.
 */

export interface FilePreview {
  durationS: number | null;
  peaks: number[] | null;
}

export async function readFilePreview(_audio: Blob, _bars: number): Promise<FilePreview> {
  return { durationS: null, peaks: null };
}

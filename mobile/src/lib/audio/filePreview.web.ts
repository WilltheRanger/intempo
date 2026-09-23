import { audioContext } from './context.web';
import { peaksOf } from './waveform';

/**
 * What a picked file looks like, for the Upload screen's waveform.
 *
 * **Decoded, so it costs the whole file as PCM in memory**, which is why it is
 * skipped past `DECODE_LIMIT`: a 50 MB WAV decoded on a phone to draw sixty
 * bars is a crash risk for a decoration. The screen draws no waveform then,
 * rather than a made-up one. The length comes from the preview player's own
 * metadata (`usePreviewPlayback`), which is cheap and works for anything the
 * browser can play; the decode's length is the fallback.
 *
 * The app's one `AudioContext` (`context.web.ts`), not a new one: iOS caps how
 * many a page may hold and does not reliably give a closed one back.
 */

const DECODE_LIMIT = 25 * 1024 * 1024;

export interface FilePreview {
  durationS: number | null;
  peaks: number[] | null;
}

export async function readFilePreview(audio: Blob, bars: number): Promise<FilePreview> {
  if (audio.size > DECODE_LIMIT) {
    return { durationS: null, peaks: null };
  }
  try {
    const context = audioContext();
    if (!context) {
      return { durationS: null, peaks: null };
    }
    const decoded = await context.decodeAudioData(await audio.arrayBuffer());
    return {
      durationS: decoded.duration,
      peaks: peaksOf(decoded.getChannelData(0), bars),
    };
  } catch {
    // A format the browser can play but not decode here: no waveform.
    return { durationS: null, peaks: null };
  }
}

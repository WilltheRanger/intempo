/**
 * Playing a passage while it is still being rendered: where each piece of it
 * begins, and how two pieces meet.
 *
 * **Listen used to render the whole passage before it played a note.** The
 * synthesiser runs 23–45 times faster than real time, which made a minute of
 * music a second's wait — and a whole piece, three or four minutes long, five
 * seconds on a laptop and twenty-five on a CPU slowed to phone speed
 * (2026-10-23). Played in chunks as they are rendered, the first note waits
 * only for the first chunk.
 *
 * **A join must not be heard, and these are arranged so that none can be.**
 * Each chunk is played by its own source node, and a node resamples its own
 * samples to the context's rate — the passage is rendered at 44.1 kHz and a
 * phone's context usually runs at 48 — so two chunks simply laid end to end
 * would each be missing the neighbour its resampler needs at the edge. So:
 *
 *  - **Consecutive chunks overlap** by `CHUNK_OVERLAP` frames, and across
 *    the overlap one fades out as the other fades in, by weights that add to
 *    one at every frame. Both carry the same samples there — they are cut from
 *    one render — so the two together are exactly the passage, and each
 *    chunk's own edge is at zero weight, where whatever its resampler does
 *    there contributes nothing. **Its last two frames, not one:** Chromium
 *    extrapolates a buffer's final output sample from its last two frames, so
 *    a fade that reached zero only on the last one still put a sample's worth
 *    of slope past the join (−58 dB at 48 kHz, one sample per join).
 *  - **A chunk begins on a whole sample of the context** (`chunkBoundary`), so
 *    its resampler reads the passage at the same phase the single buffer
 *    would have: resampling is linear, and two chunks that add to the passage,
 *    resampled on the same grid, add to the passage resampled.
 *
 * Checked in Chromium by rendering one passage both ways through an
 * `OfflineAudioContext` at 48 kHz and comparing them sample by sample.
 */

/** The frames two consecutive chunks share, fading one into the other: 5.8 ms. */
export const CHUNK_OVERLAP = 256;

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    [x, y] = [y, x % y];
  }
  return x;
}

/**
 * The last frame at or before `frame` on which a chunk may begin: one whose
 * time is a whole number of the context's samples.
 *
 * At 44.1 kHz into 48 kHz that is every 147th frame (147 render frames are
 * exactly 160 context frames); into a 44.1 kHz context, any frame.
 */
export function chunkBoundary(frame: number, renderRate: number, contextRate: number): number {
  const step = renderRate / gcd(renderRate, contextRate);
  return Math.max(0, Math.floor(frame / step) * step);
}

/** One chunk to schedule: frames `[from, to)` of the passage. */
export interface ChunkPlan {
  from: number;
  to: number;
  /** The first `CHUNK_OVERLAP` frames fade in, under the previous chunk's end. */
  fadeIn: boolean;
  /** The last `CHUNK_OVERLAP` frames fade out, over the next chunk's start. */
  fadeOut: boolean;
  /** The passage's last chunk: it ends where the passage does. */
  last: boolean;
}

/**
 * The next chunk to schedule, given how much is scheduled and how much is
 * rendered — or null when there is not yet enough to be worth a chunk.
 *
 * `scheduled` is where the next chunk begins: the boundary the last one faded
 * out across, or zero. A chunk is cut once at least `minFrames` more are ready
 * than are scheduled, and the last one as soon as the whole passage is.
 */
export function nextChunk(
  scheduled: number,
  written: number,
  total: number,
  minFrames: number,
  renderRate: number,
  contextRate: number,
): ChunkPlan | null {
  if (scheduled >= total) {
    return null;
  }
  if (written >= total) {
    return { from: scheduled, to: total, fadeIn: scheduled > 0, fadeOut: false, last: true };
  }
  // The next chunk fades in across [boundary, boundary + overlap), so this one
  // must reach that far, and it all has to be rendered already.
  const boundary = chunkBoundary(written - CHUNK_OVERLAP, renderRate, contextRate);
  if (boundary - scheduled < minFrames) {
    return null;
  }
  return {
    from: scheduled,
    to: boundary + CHUNK_OVERLAP,
    fadeIn: scheduled > 0,
    fadeOut: true,
    last: false,
  };
}

/**
 * How far into an overlap the incoming chunk has reached full weight.
 *
 * It rises from zero over all but the overlap's last frame, so the outgoing
 * chunk, its complement, is at zero for its last two.
 */
function incoming(frameIntoOverlap: number): number {
  return Math.min(1, frameIntoOverlap / (CHUNK_OVERLAP - 2));
}

/**
 * A chunk's samples as Web Audio takes them — one array per channel, scaled to
 * ±1 — with its fades applied.
 *
 * Across an overlap the incoming chunk's weight rises from zero to one and the
 * outgoing one's is what is left, so the two add to one at every frame; the
 * incoming chunk's first frame and the outgoing chunk's last two weigh nothing.
 */
export function chunkSamples(pcm: Int16Array, channels: number, plan: ChunkPlan): Float32Array[] {
  const length = plan.to - plan.from;
  const out = Array.from({ length: channels }, () => new Float32Array(length));
  for (let i = 0; i < length; i++) {
    let weight = 1;
    if (plan.fadeIn && i < CHUNK_OVERLAP) {
      weight = incoming(i);
    }
    if (plan.fadeOut && i >= length - CHUNK_OVERLAP) {
      weight *= 1 - incoming(i - (length - CHUNK_OVERLAP));
    }
    const frame = plan.from + i;
    for (let c = 0; c < channels; c++) {
      out[c][i] = (pcm[frame * channels + c] / 32768) * weight;
    }
  }
  return out;
}

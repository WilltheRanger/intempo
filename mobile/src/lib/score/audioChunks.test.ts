import { describe, expect, it } from 'vitest';

import { CHUNK_OVERLAP, chunkBoundary, chunkSamples, nextChunk, type ChunkPlan } from './audioChunks';

const RENDER = 44100;

/** Stereo PCM with something different in every frame and both channels. */
function passage(frames: number): Int16Array {
  const pcm = new Int16Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    pcm[i * 2] = Math.round(Math.sin(i * 0.031) * 20000);
    pcm[i * 2 + 1] = Math.round(Math.cos(i * 0.017) * 15000) - 3;
  }
  return pcm;
}

/** Every chunk of a passage, cut as a render that finishes in `steps` would cut them. */
function cutAll(total: number, minFrames: number, contextRate: number, steps: number[]): ChunkPlan[] {
  const plans: ChunkPlan[] = [];
  let scheduled = 0;
  for (const written of [...steps, total]) {
    for (;;) {
      const plan = nextChunk(scheduled, written, total, minFrames, RENDER, contextRate);
      if (!plan) break;
      plans.push(plan);
      scheduled = plan.fadeOut ? plan.to - CHUNK_OVERLAP : plan.to;
    }
  }
  return plans;
}

describe('chunkBoundary', () => {
  it('lands on a whole sample of a 48 kHz context', () => {
    for (const frame of [0, 146, 147, 1000, 88_200, 123_457]) {
      const boundary = chunkBoundary(frame, RENDER, 48_000);
      expect(boundary).toBeLessThanOrEqual(frame);
      expect(frame - boundary).toBeLessThan(147);
      expect(Number.isInteger((boundary * 48_000) / RENDER)).toBe(true);
    }
  });

  it('may be any frame when the context runs at the render rate', () => {
    expect(chunkBoundary(12_345, RENDER, RENDER)).toBe(12_345);
  });

  it('is never before the start', () => {
    expect(chunkBoundary(-200, RENDER, 48_000)).toBe(0);
  });
});

describe('nextChunk', () => {
  it('waits until enough is rendered to be worth a chunk', () => {
    expect(nextChunk(0, 50_000, 500_000, 88_200, RENDER, 48_000)).toBeNull();
  });

  it('cuts the first chunk with no fade in, and fades it out where the next will begin', () => {
    const plan = nextChunk(0, 100_000, 500_000, 88_200, RENDER, 48_000)!;

    expect(plan.from).toBe(0);
    expect(plan.fadeIn).toBe(false);
    expect(plan.fadeOut).toBe(true);
    expect(plan.last).toBe(false);
    // Everything it covers, overlap included, is already rendered.
    expect(plan.to).toBeLessThanOrEqual(100_000);
    expect(Number.isInteger(((plan.to - CHUNK_OVERLAP) * 48_000) / RENDER)).toBe(true);
  });

  it('plays a passage that finished rendering first as one chunk, exactly as before', () => {
    expect(nextChunk(0, 500_000, 500_000, 88_200, RENDER, 48_000)).toEqual({
      from: 0,
      to: 500_000,
      fadeIn: false,
      fadeOut: false,
      last: true,
    });
  });

  it('cuts the passage into chunks that cover it, each meeting the next across an overlap', () => {
    const total = 1_000_000;
    const plans = cutAll(total, 88_200, 48_000, [90_000, 200_000, 205_000, 600_000, 999_999]);

    expect(plans[0].from).toBe(0);
    expect(plans[plans.length - 1]).toMatchObject({ to: total, last: true, fadeOut: false });
    for (let k = 1; k < plans.length; k++) {
      expect(plans[k].fadeIn).toBe(true);
      expect(plans[k - 1].fadeOut).toBe(true);
      expect(plans[k].from).toBe(plans[k - 1].to - CHUNK_OVERLAP);
    }
  });

  it('has nothing more to cut once the last chunk is out', () => {
    expect(nextChunk(500_000, 500_000, 500_000, 88_200, RENDER, 48_000)).toBeNull();
  });
});

describe('chunkSamples', () => {
  it('converts a chunk with no fades exactly as the single buffer did', () => {
    const pcm = passage(1000);
    const [left, right] = chunkSamples(pcm, 2, { from: 0, to: 1000, fadeIn: false, fadeOut: false, last: true });

    for (let i = 0; i < 1000; i++) {
      expect(left[i]).toBe(Math.fround(pcm[i * 2] / 32768));
      expect(right[i]).toBe(Math.fround(pcm[i * 2 + 1] / 32768));
    }
  });

  it('adds back up to the passage, frame by frame, across every join', () => {
    const total = 400_000;
    const pcm = passage(total);
    const plans = cutAll(total, 88_200, 48_000, [100_000, 230_000, 300_000]);
    expect(plans.length).toBeGreaterThan(2);

    const sum = [new Float64Array(total), new Float64Array(total)];
    for (const plan of plans) {
      const channels = chunkSamples(pcm, 2, plan);
      channels.forEach((samples, c) => samples.forEach((value, i) => (sum[c][plan.from + i] += value)));
    }
    let worst = 0;
    for (let i = 0; i < total; i++) {
      for (let c = 0; c < 2; c++) {
        worst = Math.max(worst, Math.abs(sum[c][i] - pcm[i * 2 + c] / 32768));
      }
    }
    // Float32 rounding of two weighted copies, and nothing else.
    expect(worst).toBeLessThan(1e-6);
  });

  it('weighs nothing at a fading-in chunk’s first frame, or a fading-out one’s last two', () => {
    // Two, because Chromium extrapolates a buffer's last output sample from its
    // last two frames: one non-zero frame there is a sample of slope past the join.
    const pcm = passage(10_000);
    const [left] = chunkSamples(pcm, 2, { from: 2_000, to: 8_000, fadeIn: true, fadeOut: true, last: false });

    expect(Math.abs(left[0])).toBe(0);
    expect(Math.abs(left[left.length - 2])).toBe(0);
    expect(Math.abs(left[left.length - 1])).toBe(0);
    expect(Math.abs(left[1])).toBeGreaterThan(0);
  });
});

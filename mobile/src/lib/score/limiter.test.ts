import { describe, expect, it } from 'vitest';

import { Limiter } from './limiter';

const RATE = 44100;
const CEILING = 10 ** (-1 / 20);

/** Run a mono signal through, flushing the look-ahead; one output per input. */
function run(input: Float32Array, limiter = new Limiter(RATE, CEILING)): Float32Array {
  const output = new Float32Array(input.length);
  const out: [number, number] = [0, 0];
  let written = 0;
  for (let i = 0; written < input.length; i++) {
    const x = i < input.length ? input[i] : 0;
    if (limiter.push(x, x, out)) output[written++] = out[0];
  }
  return output;
}

function tone(seconds: number, amplitude: (t: number) => number, hz = 220): Float32Array {
  const y = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < y.length; i++) {
    y[i] = amplitude(i / RATE) * Math.sin((2 * Math.PI * hz * i) / RATE);
  }
  return y;
}

describe('the limiter', () => {
  it('never lets a sample past the ceiling', () => {
    // Loud and uneven: a bowed note's level with attacks well over the top.
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const input = tone(2, (t) => 1.5 + Math.sin(t * 9) + (t % 0.5 < 0.02 ? 2 : 0));
    for (let i = 0; i < input.length; i += 97) input[i] += 3 * random();
    const output = run(input);
    expect(Math.max(...output.map(Math.abs))).toBeLessThanOrEqual(CEILING * (1 + 1e-9));
  });

  it('turns a steady loud tone into a quieter copy of itself, not a clipped one', () => {
    // A limiter that turns down too late meets each peak at full gain; with
    // nothing flattening it, that is a sample over the ceiling, and with a
    // clamp it would be a flat top. Either way the ratio of output to input
    // would swing within each cycle. Here it must hold still.
    const input = tone(0.6, () => 2);
    const output = run(input);
    const ratios: number[] = [];
    for (let i = Math.round(0.4 * RATE); i < input.length; i++) {
      if (Math.abs(input[i]) > 0.2) ratios.push(output[i] / input[i]);
    }
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(1e-3);
    expect(Math.max(...output.map(Math.abs))).toBeLessThanOrEqual(CEILING * (1 + 1e-9));
  });

  it('leaves audio that is under the ceiling exactly as it was, and in time', () => {
    const input = tone(0.5, () => 0.5);
    expect(Array.from(run(input))).toEqual(Array.from(input));
  });

  it('turns down by a ramp, not a step', () => {
    // A steady tone that doubles past the ceiling: the gain has to fall, and
    // how fast it may fall is what separates a limiter from a click.
    const input = new Float32Array(RATE).map((_, i) => (i < RATE / 2 ? 0.5 : 2));
    const output = run(input);
    const lookahead = new Limiter(RATE, CEILING).lookahead;
    let steepest = 0;
    for (let i = 1; i < input.length; i++) {
      steepest = Math.max(steepest, Math.abs(output[i] / input[i] - output[i - 1] / input[i - 1]));
    }
    expect(steepest).toBeLessThanOrEqual(1 / lookahead + 1e-6);
    // Already down when the loud part arrives, and at the ceiling while it lasts.
    expect(output[RATE / 2]).toBeLessThanOrEqual(CEILING);
    expect(output[RATE - 1]).toBeCloseTo(CEILING, 3);
  });

  it('gives the level back after a peak', () => {
    const input = tone(1, (t) => (t > 0.2 && t < 0.21 ? 3 : 0.4));
    const output = run(input);
    const late = (from: number, to: number, y: Float32Array) =>
      Math.max(...y.slice(Math.round(from * RATE), Math.round(to * RATE)).map(Math.abs));
    // Half a second after the peak the tone is back to its own level.
    expect(late(0.8, 1, output)).toBeCloseTo(late(0.8, 1, input), 2);
  });
});

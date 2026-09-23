import { describe, expect, it } from 'vitest';

import { peaksOf, sizeLabel } from './waveform';

describe('peaksOf', () => {
  it('takes the loudest sample of each slice, either side of zero', () => {
    const samples = [0.1, -0.4, 0.2, 0.05, -0.1, 0.8];
    // Three slices of two: 0.4, 0.2, 0.8 — then scaled to the loudest.
    expect(peaksOf(samples, 3)).toEqual([0.5, 0.25, 1]);
  });

  it('keeps an attack a slice average would flatten', () => {
    const samples = new Float32Array(100);
    samples[37] = 0.9;
    const peaks = peaksOf(samples, 10);
    expect(peaks[3]).toBe(1);
    expect(peaks.filter((p) => p > 0)).toHaveLength(1);
  });

  it('draws silence as silence rather than dividing by zero', () => {
    expect(peaksOf(new Float32Array(50), 5)).toEqual([0, 0, 0, 0, 0]);
  });

  it('draws nothing for nothing', () => {
    expect(peaksOf([], 10)).toEqual([]);
    expect(peaksOf([0.5], 0)).toEqual([]);
  });

  it('still fills every bar when there are fewer samples than bars', () => {
    expect(peaksOf([0.2, 0.4], 4)).toHaveLength(4);
  });
});

describe('sizeLabel', () => {
  it('reads megabytes to one place and kilobytes whole', () => {
    expect(sizeLabel(8_493_465)).toBe('8.1 MB');
    expect(sizeLabel(655_360)).toBe('640 KB');
    expect(sizeLabel(10)).toBe('1 KB');
  });

  it('says nothing about a size the picker did not report', () => {
    expect(sizeLabel(null)).toBeNull();
  });
});

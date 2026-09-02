import { describe, expect, it } from 'vitest';

import { formatPlaybackTime } from './playbackTime';

describe('recording playback time', () => {
  it.each([
    [0, '0:00'],
    [4.9, '0:04'],
    [64.8, '1:04'],
    [-2, '0:00'],
    [Number.NaN, '0:00'],
  ])('formats %s seconds as %s', (seconds, expected) => {
    expect(formatPlaybackTime(seconds)).toBe(expected);
  });
});

import { describe, expect, it } from 'vitest';

import { fullBleedMusicWidth } from './musicWidth';

describe('fullBleedMusicWidth', () => {
  it('is the window less the margin each side, on a phone', () => {
    expect(fullBleedMusicWidth(390, 560, 16)).toBe(358);
  });

  it('stops at the reading measure on a wide window', () => {
    expect(fullBleedMusicWidth(1440, 560, 16)).toBe(528);
  });

  it('is never negative', () => {
    expect(fullBleedMusicWidth(20, 560, 16)).toBe(0);
  });
});

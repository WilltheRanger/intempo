import { describe, expect, it } from 'vitest';

import { recordLayout } from './recordLayout';

describe('recordLayout', () => {
  it('keeps the column on every phone held upright', () => {
    expect(recordLayout(390, 844)).toBe('column'); // iPhone 14
    expect(recordLayout(430, 932)).toBe('column'); // iPhone 14 Pro Max
    expect(recordLayout(375, 667)).toBe('column'); // iPhone SE, the shortest
    expect(recordLayout(360, 740)).toBe('column'); // a common Android
  });

  it('sets the music beside the panel on a phone turned sideways', () => {
    expect(recordLayout(844, 390)).toBe('sideBySide');
    expect(recordLayout(932, 430)).toBe('sideBySide');
    expect(recordLayout(667, 375)).toBe('sideBySide');
  });

  it('keeps the column on a tall window, however wide', () => {
    expect(recordLayout(1440, 900)).toBe('column');
    expect(recordLayout(768, 1024)).toBe('column');
  });

  it('sets them side by side on a short, wide browser window', () => {
    expect(recordLayout(1280, 600)).toBe('sideBySide');
  });

  it('keeps the column when there is no room beside the panel either', () => {
    expect(recordLayout(390, 500)).toBe('column');
    expect(recordLayout(600, 400)).toBe('column');
  });
});

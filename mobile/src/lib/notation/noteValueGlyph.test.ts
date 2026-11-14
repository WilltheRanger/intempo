import { describe, expect, it } from 'vitest';

import { NOTE_VALUES } from './durationPicker';
import { drawNoteValue } from './noteValueGlyph';

describe('drawNoteValue', () => {
  it('gives every value the same height and head line, so a row of them aligns', () => {
    const drawings = NOTE_VALUES.map((value) => drawNoteValue(value, false, 6));
    expect(new Set(drawings.map((d) => d.height)).size).toBe(1);
    expect(new Set(drawings.map((d) => d.head.y)).size).toBe(1);
  });

  it('draws a whole note without a stem, and stems on the others', () => {
    expect(drawNoteValue('whole', false, 6).stem).toBeNull();
    expect(drawNoteValue('half', false, 6).stem).not.toBeNull();
  });

  it('hangs a flag from the stem’s own tip on eighths and sixteenths only', () => {
    for (const value of ['eighth', 'sixteenth'] as const) {
      const d = drawNoteValue(value, false, 6);
      expect(d.flag?.x).toBe(d.stem?.x);
      expect(d.flag?.y).toBe(d.stem?.to);
    }
    expect(drawNoteValue('quarter', false, 6).flag).toBeNull();
  });

  it('puts a dot after the head and keeps everything inside the box', () => {
    const d = drawNoteValue('half', true, 6);
    expect(d.dot).not.toBeNull();
    expect(d.dot!.x).toBeGreaterThan(d.head.x);
    expect(d.dot!.x).toBeLessThan(d.width);
    expect(d.stem!.to).toBeGreaterThan(0);
  });

  it('sets one em to four staff spaces, as SMuFL glyphs expect', () => {
    expect(drawNoteValue('quarter', false, 5).fontSize).toBe(20);
  });
});

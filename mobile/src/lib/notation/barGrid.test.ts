import { describe, expect, it } from 'vitest';

import type { ScoreJson } from '../../data/types';
import { barCells, barGridSummary } from './barGrid';

/**
 * The grid a musician finds a misread bar in.
 *
 * Its whole claim is that an outlier is visible as a shape, which only holds
 * if every cell carries its count and the flagged ones are actually flagged.
 * A screen reader gets the same two facts in the label, because the shape is
 * exactly what it cannot see.
 */
function scoreOf(counts: number[]): ScoreJson {
  return {
    measures: counts.map((notes, index) => ({
      measure_number: index + 1,
      notes: Array.from({ length: notes }, () => ({
        pitch: 'A4',
        duration: 'quarter',
      })),
    })),
  } as unknown as ScoreJson;
}

describe('barCells', () => {
  it('carries the count, which is what makes an outlier visible', () => {
    const cells = barCells(scoreOf([8, 8, 2, 8]));
    expect(cells.map((cell) => cell.notes)).toEqual([8, 8, 2, 8]);
    expect(cells.map((cell) => cell.number)).toEqual([1, 2, 3, 4]);
  });

  it('flags the bars the beat check could not make add up', () => {
    const cells = barCells(scoreOf([4, 4, 4]), [2]);
    expect(cells.map((cell) => cell.flagged)).toEqual([false, true, false]);
  });

  /**
   * The grid's argument is visual, so the label has to carry it in words —
   * both the count the eye compares and the finding the border states.
   */
  it('says both facts in the label', () => {
    const [ok, bad] = barCells(scoreOf([4, 3]), [2]);
    expect(ok.label).toBe('Bar 1, 4 notes');
    expect(bad.label).toBe('Bar 2, 3 notes, does not add up');
  });

  it('counts one note as a note', () => {
    expect(barCells(scoreOf([1]))[0].label).toBe('Bar 1, 1 note');
  });

  it('is empty for a score nothing has read', () => {
    expect(barCells(null)).toEqual([]);
    expect(barCells(undefined, [1, 2])).toEqual([]);
  });
});

describe('barGridSummary', () => {
  it('says what to do when nothing is in doubt', () => {
    expect(barGridSummary(barCells(scoreOf([4, 4])))).toBe(
      '2 bars, showing the notes read in each. Tap one to correct it.',
    );
  });

  /**
   * A cell is two numbers and only one of them is self-evident. The screen
   * reader was told which is which and the eye was not, so the line above the
   * grid says it once rather than a unit appearing on seventy cells.
   */
  it('says what the second number on a cell is', () => {
    expect(barGridSummary(barCells(scoreOf([4, 4])))).toContain('notes read in each');
  });

  /** A line that always reports a count teaches a musician to stop reading it. */
  it('does not report a count of zero', () => {
    expect(barGridSummary(barCells(scoreOf([4])))).not.toContain('0');
  });

  it('counts the bars in doubt, and reads as English at one', () => {
    expect(barGridSummary(barCells(scoreOf([4, 4, 4]), [2]))).toContain(
      'The outlined one does not add up',
    );
    expect(barGridSummary(barCells(scoreOf([4, 4, 4]), [2, 3]))).toContain(
      'The 2 outlined ones do not add up',
    );
  });
});

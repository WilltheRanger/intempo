import { describe, expect, it } from 'vitest';

import type { Duration } from '../../data/types';
import {
  NOTE_VALUES,
  canApply,
  durationFor,
  partsOf,
  toggled,
  withValue,
  type DurationModifier,
} from './durationPicker';
import { EDITABLE_DURATIONS } from './reading';

describe('the duration picker', () => {
  it('reaches every duration the editor offers, and nothing else', () => {
    const reachable = new Set<Duration>();
    for (const value of NOTE_VALUES) {
      for (const modifier of ['plain', 'dotted', 'triplet'] as DurationModifier[]) {
        const duration = durationFor(value, modifier);
        if (duration) reachable.add(duration);
      }
    }
    expect([...reachable].sort()).toEqual([...EDITABLE_DURATIONS].sort());
  });

  it('takes a duration apart into its value and modifier', () => {
    expect(partsOf('dotted_quarter')).toEqual({ value: 'quarter', modifier: 'dotted' });
    expect(partsOf('triplet_eighth')).toEqual({ value: 'eighth', modifier: 'triplet' });
    expect(partsOf('half')).toEqual({ value: 'half', modifier: 'plain' });
  });

  it('shows nothing chosen for a duration the bar holds but the picker does not offer', () => {
    expect(partsOf('double_dotted_half').value).toBeNull();
    expect(partsOf('quintuplet_quarter').value).toBeNull();
    expect(partsOf('thirty_second').value).toBeNull();
  });

  it('keeps the dot when the new value can carry it, and drops it when not', () => {
    expect(withValue('dotted_quarter', 'eighth')).toBe('dotted_eighth');
    expect(withValue('dotted_quarter', 'whole')).toBe('whole');
    expect(withValue('triplet_eighth', 'half')).toBe('half');
    expect(withValue('quintuplet_quarter', 'quarter')).toBe('quarter');
  });

  it('toggles the dot and the triplet on and off, one at a time', () => {
    expect(toggled('quarter', 'dotted')).toBe('dotted_quarter');
    expect(toggled('dotted_quarter', 'dotted')).toBe('quarter');
    expect(toggled('dotted_quarter', 'triplet')).toBe('triplet_quarter');
    expect(toggled('triplet_eighth', 'triplet')).toBe('eighth');
  });

  it('greys out what the value cannot carry', () => {
    expect(canApply('whole', 'dotted')).toBe(false);
    expect(canApply('sixteenth', 'dotted')).toBe(false);
    expect(canApply('half', 'triplet')).toBe(false);
    expect(canApply('half', 'dotted')).toBe(true);
    expect(canApply('eighth', 'triplet')).toBe(true);
    expect(toggled('whole', 'dotted')).toBeNull();
  });
});

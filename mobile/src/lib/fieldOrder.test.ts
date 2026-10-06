import { describe, expect, it, vi } from 'vitest';

import { afterReturn, returnKeyFor, type FieldHandle } from './fieldOrder';

const field = () => ({ focus: vi.fn<FieldHandle['focus']>() });

describe('the key the keyboard draws', () => {
  it('says next until the last field, which says what finishing does', () => {
    expect([0, 1, 2].map((index) => returnKeyFor(index, 3, 'done'))).toEqual(['next', 'next', 'done']);
    expect(returnKeyFor(1, 2, 'go')).toBe('go');
  });

  it('says what finishing does on a form of one field', () => {
    expect(returnKeyFor(0, 1, 'go')).toBe('go');
  });
});

describe('what Return does', () => {
  it('moves to the next field, and does not finish', () => {
    const fields = [field(), field(), field()];
    const finish = vi.fn();
    afterReturn(0, fields, finish);
    expect(fields[1].focus).toHaveBeenCalledTimes(1);
    expect(fields[2].focus).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });

  it('finishes from the last field', () => {
    const fields = [field(), field()];
    const finish = vi.fn();
    afterReturn(1, fields, finish);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(fields[0].focus).not.toHaveBeenCalled();
  });

  it('skips a field that is not on screen', () => {
    const fields = [field(), null, field()];
    const finish = vi.fn();
    afterReturn(0, fields, finish);
    expect(fields[2]!.focus).toHaveBeenCalledTimes(1);
    expect(finish).not.toHaveBeenCalled();
  });

  it('finishes when every field after it is missing', () => {
    // Sign in with the password field hidden: Return in email sends.
    const finish = vi.fn();
    afterReturn(0, [field(), undefined], finish);
    expect(finish).toHaveBeenCalledTimes(1);
  });
});

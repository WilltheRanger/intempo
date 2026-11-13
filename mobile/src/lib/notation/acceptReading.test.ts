import { describe, expect, it } from 'vitest';

import { acceptCopy } from './acceptReading';

/**
 * "Looks right" told everyone the photo would be deleted, and asked them to
 * confirm a deletion, while the server kept the photo for anyone who had
 * agreed to help improve score reading (the UI review, 2026-11-12).
 */
describe('acceptCopy', () => {
  it('says the photo is kept, and asks nothing, when it will be kept', () => {
    const copy = acceptCopy(true);
    expect(copy.note).toBe('Keeps the photo to improve score reading.');
    expect(copy.note).not.toMatch(/delet/i);
    expect(copy.pending).not.toMatch(/delet/i);
    expect(copy.confirm).toBeNull();
  });

  it('says the photo goes, and asks first, when it will go', () => {
    const copy = acceptCopy(false);
    expect(copy.note).toBe('Deletes the photo to save space.');
    expect(copy.confirm?.title).toBe('Delete the photo?');
    expect(copy.confirm?.message).toMatch(/can.t be recovered/);
  });

  it('asks first while it is not yet known which will happen', () => {
    expect(acceptCopy(null).confirm).not.toBeNull();
  });
});

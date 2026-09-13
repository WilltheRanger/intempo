import { describe, expect, it } from 'vitest';

import { causeOf } from './causeOf';

/**
 * Keeping the browser's own words, which this project has now paid for twice.
 *
 * These moved here from `score/listenFailure.test.ts` when the helper became
 * shared: the microphone path was discarding `error.message` a directory away
 * while Listen was keeping it, and that message named the cause of five wrong
 * fixes.
 */
describe('causeOf', () => {
  it('drops the useless generic name', () => {
    // `new Error('...')` has name 'Error', which identifies nothing.
    expect(causeOf(new Error('the thing broke'))).toBe('the thing broke');
  });

  it('keeps a name with no message', () => {
    expect(causeOf(new DOMException('', 'AbortError'))).toBe('AbortError');
  });

  it('takes a thrown string, since JavaScript allows one', () => {
    expect(causeOf('out of memory')).toBe('out of memory');
  });

  it('has nothing to say about a thrown object', () => {
    expect(causeOf({ nope: true })).toBe('');
    expect(causeOf(null)).toBe('');
  });
});

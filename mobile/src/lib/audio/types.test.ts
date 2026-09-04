import { describe, expect, it } from 'vitest';

import { takeFilename } from './types';

/**
 * What a take is called — the last thing in `audio/types.ts` nothing read.
 *
 * `limits.test.ts` covers `maxTakeSamples` from this same module, thoroughly:
 * the bucket fit at both real rates, which of the two limits binds, the
 * slower-device claim, the non-zero floor and the channel scaling. **I wrote a
 * second set of those and deleted it** — every mutation it caught,
 * `limits.test.ts` caught first, and a test that adds no discrimination makes
 * the next person believe something is guarded when the guarding lives
 * somewhere else. That is the fourth time this session.
 *
 * What is genuinely unheld is this function. Both recorders name every take
 * with it, and `submitTake.test.ts` passes a hand-written
 * `'take-2026-05-17.wav'` rather than calling it — so the thing that names
 * every recording this app has ever uploaded had nothing asserting what it
 * returns. Its extension is now held by
 * `backend/app/tests/test_upload_extensions.py`, against the list that would
 * refuse it; the rest is here.
 */

describe('what a take is called', () => {
  it('carries no colon, because an object key cannot hold one', () => {
    // The whole reason for the `replace`. A key with a colon in it is refused
    // by storage, after the take has been recorded and while it is uploading.
    const name = takeFilename(new Date('2026-08-16T19:04:11.123Z'));

    expect(name).toBe('take-2026-08-16T19-04-11-123.wav');
    expect(name).not.toContain(':');
  });

  it('keeps nothing else that a key cannot hold', () => {
    // Belt and braces on the same rule, stated as the rule rather than as one
    // example of it: Supabase object keys take letters, digits and a short
    // list of punctuation, and this name is built from a timestamp.
    expect(takeFilename(new Date('2026-01-02T03:04:05.006Z'))).toMatch(
      /^take-[0-9T-]+\.wav$/,
    );
  });

  it('is unique per millisecond, so two takes never share a key', () => {
    // A musician who stops and immediately records again must not overwrite
    // the take they just made — the object key is the only thing separating
    // them, and `submitTake` reuses a key deliberately on retry.
    const first = takeFilename(new Date('2026-08-16T19:04:11.000Z'));
    const second = takeFilename(new Date('2026-08-16T19:04:11.001Z'));

    expect(first).not.toBe(second);
  });
});

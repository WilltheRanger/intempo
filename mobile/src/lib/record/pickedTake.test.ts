import { describe, expect, it } from 'vitest';

import {
  ACCEPTED_LABEL,
  MAX_UPLOAD_BYTES,
  describePickedTake,
  extensionOf,
} from './pickedTake';

const ok = (name: string, size: number | null = 1024) =>
  describePickedTake({ name, size });

describe('extensionOf', () => {
  it('reads the last extension, lowercased', () => {
    expect(extensionOf('take.WAV')).toBe('wav');
    expect(extensionOf('my.practice.take.mp3')).toBe('mp3');
  });

  it('has none for a bare name or a trailing dot', () => {
    expect(extensionOf('recording')).toBe('');
    expect(extensionOf('recording.')).toBe('');
  });

  /** `lastIndexOf` finds the dot in `.hidden`, whose whole name is not an
   * extension. A leading dot is not a separator. */
  it('does not treat a dotfile’s name as its extension', () => {
    expect(extensionOf('.flac')).toBe('');
  });
});

describe('describePickedTake', () => {
  it('accepts every format the backend can probe, and names its type', () => {
    expect(ok('take.wav')).toEqual({
      ok: true,
      filename: 'take.wav',
      contentType: 'audio/wav',
    });
    expect(ok('take.mp3').ok).toBe(true);
    expect(ok('take.m4a').ok).toBe(true);
    expect(ok('take.flac').ok).toBe(true);
    expect(ok('take.ogg').ok).toBe(true);
  });

  it('is case-insensitive, because a file manager is not', () => {
    expect(ok('Practice Take.M4A').ok).toBe(true);
  });

  /**
   * **The direction that matters.** Refusing something the backend would
   * accept makes a working file unusable, which is worse than letting
   * something through to be refused properly. This pins the accepted set to
   * the server's, so narrowing one without the other fails here.
   */
  it('is no narrower than the backend’s own list', () => {
    for (const ext of ['wav', 'mp3', 'm4a', 'flac', 'ogg']) {
      expect(ok(`take.${ext}`).ok).toBe(true);
    }
  });

  /**
   * `webm` is the one the server allows by extension and refuses by content:
   * `audio_intake.py` leaves it out of its signature table deliberately. Said
   * here, instantly, rather than after an upload — and named as itself, since
   * it *is* audio and "that isn't an audio file" would send someone looking
   * for a different file instead of exporting the one they have.
   */
  it('refuses webm by name, with what to do about it', () => {
    const out = ok('take.webm');

    expect(out.ok).toBe(false);
    expect(out.ok === false && out.message).toMatch(/WebM/);
    expect(out.ok === false && out.message).toMatch(/Export it as/);
  });

  it('refuses a file that is not audio at all, and says what is', () => {
    const out = ok('holiday.mov');

    expect(out.ok).toBe(false);
    expect(out.ok === false && out.message).toContain('.mov');
    expect(out.ok === false && out.message).toContain(ACCEPTED_LABEL);
  });

  it('refuses a file with no extension rather than guessing', () => {
    expect(ok('recording').ok).toBe(false);
  });

  it('refuses an empty file', () => {
    const out = ok('take.wav', 0);

    expect(out.ok).toBe(false);
    expect(out.ok === false && out.message).toMatch(/empty/i);
  });

  it('refuses one past the bucket cap, naming both numbers', () => {
    const out = ok('take.wav', MAX_UPLOAD_BYTES + 1);

    expect(out.ok).toBe(false);
    // Both, because a limit without the value it was measured against is a
    // limit nobody can act on.
    expect(out.ok === false && out.message).toMatch(/50 MB/);
    expect(out.ok === false && out.message).toMatch(/51 MB/);
  });

  it('accepts one exactly at the cap', () => {
    expect(ok('take.wav', MAX_UPLOAD_BYTES).ok).toBe(true);
  });

  /**
   * A picker that does not report a size is saying "I don't know", which is
   * not "zero". Refusing on a number we never received would be this check
   * inventing a problem; the backend measures what it actually receives.
   */
  it('lets an unknown size through rather than inventing a problem', () => {
    expect(ok('take.wav', null).ok).toBe(true);
  });
});

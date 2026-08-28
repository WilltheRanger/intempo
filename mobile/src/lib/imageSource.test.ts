import { describe, expect, it } from 'vitest';

import { stableImage } from './imageSource';

describe('stableImage', () => {
  it('pins the cache key to the path, not the token', () => {
    // The whole point: two mintings of the same object differ only in the
    // token, and the cache must treat them as the same image.
    const first = stableImage(
      'https://x.supabase.co/storage/v1/object/sign/score-images/u/abc.jpg?token=aaa',
    );
    const second = stableImage(
      'https://x.supabase.co/storage/v1/object/sign/score-images/u/abc.jpg?token=bbb',
    );

    expect(first).toEqual({
      uri: 'https://x.supabase.co/storage/v1/object/sign/score-images/u/abc.jpg?token=aaa',
      cacheKey: '/storage/v1/object/sign/score-images/u/abc.jpg',
    });
    expect((first as { cacheKey: string }).cacheKey).toBe(
      (second as { cacheKey: string }).cacheKey,
    );
  });

  it('keeps the token in the uri, because the fetch still needs it', () => {
    const source = stableImage('https://x.example/a.jpg?token=t') as { uri: string };
    expect(source.uri).toContain('token=t');
  });

  it('passes a non-URL through untouched', () => {
    // A fixture path or bundled asset: caching on the string itself is
    // already right, and wrapping it would break `typeof === 'string'` checks.
    expect(stableImage('fixtures/page.jpg')).toBe('fixtures/page.jpg');
  });

  it('maps nothing to null', () => {
    expect(stableImage(null)).toBeNull();
    expect(stableImage(undefined)).toBeNull();
    expect(stableImage('')).toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

import { lensRenders } from './lensFilter';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
const IPHONE_HOME_SCREEN =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15';
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const FIREFOX =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:130.0) Gecko/20100101 Firefox/130.0';

describe('lensRenders', () => {
  /**
   * The phone this was reported from: the bar had no blur, because WebKit
   * accepted the lens, drew nothing, and took the blur down with it.
   */
  it('says no for an iPhone, in Safari and from the home screen', () => {
    expect(lensRenders({ userAgent: IPHONE_SAFARI })).toBe(false);
    expect(lensRenders({ userAgent: IPHONE_HOME_SCREEN })).toBe(false);
  });

  it('says no for Chrome on an iPhone, which is WebKit underneath', () => {
    expect(lensRenders({ userAgent: IPHONE_CHROME })).toBe(false);
  });

  it('says no for an iPad that reports itself as a Mac', () => {
    expect(
      lensRenders({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 5 }),
    ).toBe(false);
  });

  it('says no for Safari and Firefox on a desktop', () => {
    expect(lensRenders({ userAgent: MAC_SAFARI, platform: 'MacIntel' })).toBe(false);
    expect(lensRenders({ userAgent: FIREFOX })).toBe(false);
  });

  it('keeps the lens where Chromium draws it', () => {
    expect(lensRenders({ userAgent: MAC_CHROME, platform: 'MacIntel' })).toBe(true);
    expect(lensRenders({ userAgent: ANDROID_CHROME })).toBe(true);
  });
});

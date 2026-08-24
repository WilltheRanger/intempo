import { afterEach, describe, expect, it, vi } from 'vitest';

const { platform, createURL } = vi.hoisted(() => ({
  platform: { OS: 'ios' as string },
  createURL: vi.fn((path: string) => `intempo://${path.replace(/^\//, '')}`),
}));

vi.mock('react-native', () => ({ Platform: platform }));
vi.mock('expo-linking', () => ({ createURL }));

import { authRedirectUrl } from './authRedirect';

/**
 * Where an emailed link comes back to.
 *
 * **Supabase rejects any redirect it has not been told about and silently
 * falls back to the Site URL.** No error, no log line the app can see — the
 * mail arrives, the link works, and it lands on a Supabase page instead of the
 * app. That looks exactly like the feature not being built, which is what it
 * looked like before this function existed.
 *
 * So what this returns is not a detail: it is the string that has to appear,
 * or be covered by a pattern, under Redirect URLs in the dashboard.
 */

afterEach(() => {
  platform.OS = 'ios';
  vi.unstubAllGlobals();
  createURL.mockClear();
});

describe('on the web', () => {
  it('comes back to the deployment that sent the mail', () => {
    // Not a hardcoded origin. Cloudflare Pages gives a new hostname for every
    // deployment, so a fixed value would send a preview build's mail to
    // production — and the person clicking it would land in the wrong app
    // with no sign that anything had happened.
    platform.OS = 'web';
    vi.stubGlobal('window', { location: { origin: 'https://a16c6845.intempo.pages.dev' } });

    expect(authRedirectUrl()).toBe('https://a16c6845.intempo.pages.dev');
  });

  it('asks for nothing when there is no page to come back to', () => {
    // `location` is absent when a web build is prerendered rather than served.
    // `undefined` lets Supabase fall back to the Site URL, which is a real
    // page; a literal "undefined" in the mail is not.
    platform.OS = 'web';
    vi.stubGlobal('window', undefined);

    expect(authRedirectUrl()).toBeUndefined();
  });

  it('never returns the string "undefined"', () => {
    platform.OS = 'web';
    vi.stubGlobal('window', undefined);

    expect(authRedirectUrl()).not.toBe('undefined');
  });
});

describe('on a phone', () => {
  it('uses the app\'s own scheme rather than a web origin', () => {
    platform.OS = 'ios';

    expect(authRedirectUrl()).toBe('intempo://');
    expect(createURL).toHaveBeenCalledWith('/');
  });

  it('does not read window even when one exists', () => {
    // React Native has a `window`. Reading it here would hand Supabase an
    // origin no phone can open.
    platform.OS = 'android';
    vi.stubGlobal('window', { location: { origin: 'https://wrong.example' } });

    expect(authRedirectUrl()).toBe('intempo://');
  });
});

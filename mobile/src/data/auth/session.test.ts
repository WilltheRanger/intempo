import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Signing in, signing up, and getting back out again.
 *
 * 371 lines with no tests, on the first screen every musician meets. Most of
 * it is one call to Supabase with the error rethrown — but the parts that are
 * *not* are each a documented bug, and every one of them is a distinction a
 * refactor can quietly flatten:
 *
 *  - an address that already has an account comes back from Supabase looking
 *    exactly like a fresh sign-up, and the only tell is an **empty**
 *    `identities` array — where `undefined` means the field was not sent and
 *    must not be read as the signal;
 *  - `forgetDeletedSession` must sign out with **local scope**, because a
 *    deleted identity may refuse to revoke its own session and the tokens then
 *    stay on the device;
 *  - `getSessionEmail` reads the **session**, not the profile row, because
 *    re-authenticating with `/v1/me`'s address signs in as somebody else;
 *  - and with Supabase unconfigured the read paths go quiet while the write
 *    paths refuse, so the app still boots.
 *
 * Driven against a stub client. Nothing here talks to Supabase, and the module
 * reads its configuration at import, so each test imports it fresh.
 */

type AuthStub = Record<string, ReturnType<typeof vi.fn>>;

let auth: AuthStub;
let createdWith: unknown[];

vi.mock('react-native-url-polyfill/auto', () => ({}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
let platformOS = 'ios';
vi.mock('react-native', () => ({ Platform: { get OS() { return platformOS; } } }));
// Same stand-in `authRedirect.test.ts` uses: `expo-linking` drags in
// `expo-modules-core`, which reads `__DEV__` at import.
vi.mock('expo-linking', () => ({ createURL: (path: string) => `intempo://${path}` }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => {
    createdWith.push(args);
    return { auth };
  },
}));

/** Import the module fresh, with or without Supabase configured. */
async function load({
  configured = true,
  os = 'ios',
}: { configured?: boolean; os?: string } = {}) {
  vi.resetModules();
  platformOS = os;
  process.env.EXPO_PUBLIC_SUPABASE_URL = configured ? 'https://stub.supabase.co' : '';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = configured ? 'anon-key' : '';
  return import('./session');
}

const ok = { data: {}, error: null };

/** The auth options the nth `createClient` call was made with. */
function detectSessionInUrlOf(index: number): boolean {
  const args = createdWith[index] as [
    string,
    string,
    { auth: { detectSessionInUrl: boolean } },
  ];
  return args[2].auth.detectSessionInUrl;
}

beforeEach(() => {
  createdWith = [];
  auth = {
    signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: null }),
    signUp: vi.fn().mockResolvedValue({ data: {}, error: null }),
    signInWithOtp: vi.fn().mockResolvedValue(ok),
    setSession: vi.fn().mockResolvedValue(ok),
    updateUser: vi.fn().mockResolvedValue(ok),
    signOut: vi.fn().mockResolvedValue(ok),
    getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    resend: vi.fn().mockResolvedValue(ok),
    resetPasswordForEmail: vi.fn().mockResolvedValue(ok),
  };
});

afterEach(() => {
  vi.resetModules();
});

describe('signing up', () => {
  it('reports an account awaiting confirmation as an outcome, not a failure', async () => {
    // Supabase issues no session when the project confirms addresses, which is
    // the default. The account exists; the musician has a link to follow.
    const { signUp } = await load();
    auth.signUp.mockResolvedValue({
      data: { user: { identities: [{ id: 'i' }] }, session: null },
      error: null,
    });

    const result = await signUp('a@b.test', 'pw');

    expect(result).toEqual({
      session: false,
      awaitingConfirmation: true,
      possiblyAlreadyRegistered: false,
    });
  });

  it('spots the address that already has an account by its empty identities', async () => {
    // **The bug this exists for.** With confirmations on, Supabase does not
    // error for an address that is already registered — it obfuscates the
    // user so a stranger cannot enumerate addresses. Read naively that is
    // indistinguishable from a fresh sign-up, and the app promised a link that
    // is never sent. They wait forever.
    const { signUp } = await load();
    auth.signUp.mockResolvedValue({
      data: { user: { identities: [] }, session: null },
      error: null,
    });

    const result = await signUp('taken@b.test', 'pw');

    expect(result.possiblyAlreadyRegistered).toBe(true);
    expect(result.awaitingConfirmation).toBe(true);
  });

  it('does not read a missing identities field as an empty one', async () => {
    // `undefined` means this Supabase version did not send the field. Treating
    // it as the signal would tell every new musician their address is already
    // registered — the same dead end, pointed the other way.
    const { signUp } = await load();
    auth.signUp.mockResolvedValue({
      data: { user: {}, session: null },
      error: null,
    });

    expect((await signUp('a@b.test', 'pw')).possiblyAlreadyRegistered).toBe(false);
  });

  it('reports a session when the project does not confirm addresses', async () => {
    const { signUp } = await load();
    auth.signUp.mockResolvedValue({
      data: { user: { identities: [{ id: 'i' }] }, session: { access_token: 't' } },
      error: null,
    });

    const result = await signUp('a@b.test', 'pw');

    expect(result.session).toBe(true);
    expect(result.awaitingConfirmation).toBe(false);
  });

  it('does not promise an email for a response that carried no user', async () => {
    // What `Boolean(data.user)` guards. Without it, *any* response without a
    // session reads as "account made, go and confirm it" — so a reply that
    // carried nothing at all would send the musician to their inbox to wait
    // for a message that was never generated. The same dead end as the
    // already-registered case, from a different direction.
    const { signUp } = await load();
    auth.signUp.mockResolvedValue({ data: {}, error: null });

    const result = await signUp('a@b.test', 'pw');

    expect(result.awaitingConfirmation).toBe(false);
    expect(result.session).toBe(false);
  });

  it('rethrows the provider’s reason rather than inventing one', async () => {
    const { signUp } = await load();
    auth.signUp.mockResolvedValue({ data: {}, error: new Error('Password too short') });

    await expect(signUp('a@b.test', 'x')).rejects.toThrow('Password too short');
  });

  it('sends the redirect the emailed link has to come back to', async () => {
    const { signUp } = await load();

    await signUp('a@b.test', 'pw');

    const options = auth.signUp.mock.calls[0][0].options;
    expect(options.emailRedirectTo).toBeTruthy();
  });
});

describe('signing in', () => {
  it('says whether the call left the user signed in', async () => {
    const { signIn } = await load();
    auth.signInWithPassword.mockResolvedValue({
      data: { session: { access_token: 't' } },
      error: null,
    });

    expect(await signIn('a@b.test', 'pw')).toEqual({
      session: true,
      // Only sign-up can tell us anything about this.
      awaitingConfirmation: false,
      possiblyAlreadyRegistered: false,
    });
  });

  it('rethrows a bad password', async () => {
    const { signIn } = await load();
    auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: new Error('Invalid login credentials'),
    });

    await expect(signIn('a@b.test', 'nope')).rejects.toThrow('Invalid login credentials');
  });
});

describe('an emailed link coming back', () => {
  const link = (hash: string) => `intempo://auth#${hash}`;

  it('ignores a URL that carries no tokens', async () => {
    // Any deep link the app receives reaches this. A link about something else
    // must not be treated as a failed sign-in.
    const { consumeAuthRedirect } = await load();

    expect(await consumeAuthRedirect('intempo://pieces/1')).toBe('ignored');
    expect(auth.setSession).not.toHaveBeenCalled();
  });

  it('establishes the session the link carries', async () => {
    const { consumeAuthRedirect } = await load();

    const result = await consumeAuthRedirect(
      link('access_token=acc&refresh_token=ref'),
    );

    expect(result).toBe('signedIn');
    expect(auth.setSession).toHaveBeenCalledWith({
      access_token: 'acc',
      refresh_token: 'ref',
    });
  });

  it('distinguishes a recovery link, which lands on a different screen', async () => {
    // A password-reset link signs you in *and* has to open the set-password
    // screen. Reporting it as an ordinary sign-in drops the musician into the
    // app with no way to finish what the email started.
    const { consumeAuthRedirect } = await load();

    expect(
      await consumeAuthRedirect(
        link('access_token=acc&refresh_token=ref&type=recovery'),
      ),
    ).toBe('recovery');
  });

  it('throws the provider’s message when the link carries an error', async () => {
    // An expired link is the common one, and its own words are better than
    // anything this app could write about it.
    const { consumeAuthRedirect } = await load();

    await expect(
      consumeAuthRedirect(link('error_description=Email+link+is+invalid+or+has+expired')),
    ).rejects.toThrow('Email link is invalid or has expired');
    expect(auth.setSession).not.toHaveBeenCalled();
  });
});

describe('getting out', () => {
  it('signs out through the auth server by default', async () => {
    const { signOut } = await load();

    await signOut();

    // No scope argument: a normal sign-out should revoke the session
    // server-side, not merely forget it here.
    expect(auth.signOut).toHaveBeenCalledWith();
  });

  it('forgets a deleted account’s session locally, without asking it', async () => {
    // **A deleted identity may reject the revoke request**, and a rejected
    // sign-out leaves valid-looking tokens on the device — the app then boots
    // signed in as an account that no longer exists.
    const { forgetDeletedSession } = await load();

    await forgetDeletedSession();

    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});

describe('who is signed in', () => {
  it('reads the address off the session, not off a profile row', async () => {
    // `ChangePasswordScreen` re-authenticates before changing a password. It
    // used to use `useMe()`'s email — `you@example.com` on a fixture build —
    // so with real credentials it would re-auth as an address the session
    // holder has never heard of.
    const { getSessionEmail } = await load();
    auth.getSession.mockResolvedValue({
      data: { session: { user: { email: 'real@person.test' } } },
    });

    expect(await getSessionEmail()).toBe('real@person.test');
    expect(auth.getSession).toHaveBeenCalled();
  });

  it('returns the access token, and null when signed out', async () => {
    const { getAccessToken } = await load();
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
    expect(await getAccessToken()).toBe('tok');

    auth.getSession.mockResolvedValue({ data: { session: null } });
    expect(await getAccessToken()).toBeNull();
  });

  it('takes an OAuth avatar from either field providers use', async () => {
    const { getAuthAvatarUrl } = await load();

    auth.getUser.mockResolvedValue({
      data: { user: { user_metadata: { avatar_url: 'https://a.test/a.png' } } },
    });
    expect(await getAuthAvatarUrl()).toBe('https://a.test/a.png');

    // Google writes it under `picture`.
    auth.getUser.mockResolvedValue({
      data: { user: { user_metadata: { picture: 'https://g.test/p.png' } } },
    });
    expect(await getAuthAvatarUrl()).toBe('https://g.test/p.png');
  });

  it('treats an empty or non-string avatar as no avatar', async () => {
    // An empty string is falsy but is still a string, and handing '' to an
    // <Image> is a broken picture rather than the initials fallback.
    const { getAuthAvatarUrl } = await load();

    auth.getUser.mockResolvedValue({ data: { user: { user_metadata: { avatar_url: '' } } } });
    expect(await getAuthAvatarUrl()).toBeNull();

    auth.getUser.mockResolvedValue({ data: { user: { user_metadata: { picture: 42 } } } });
    expect(await getAuthAvatarUrl()).toBeNull();

    // An email-and-password account has neither. Null is the common case.
    auth.getUser.mockResolvedValue({ data: { user: { user_metadata: {} } } });
    expect(await getAuthAvatarUrl()).toBeNull();
  });
});

describe('changing the account', () => {
  it('sends a redirect with an email change, because the new address must confirm', async () => {
    const { updateEmail } = await load();

    await updateEmail('new@b.test');

    expect(auth.updateUser).toHaveBeenCalledWith(
      { email: 'new@b.test' },
      expect.objectContaining({ emailRedirectTo: expect.any(String) }),
    );
  });

  it('changes a password in place, with no link to follow', async () => {
    const { updatePassword } = await load();

    await updatePassword('a-better-one');

    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'a-better-one' });
  });
});

describe('with Supabase not configured', () => {
  it('still boots: there is no client, rather than a broken one', async () => {
    const { getSupabaseClient } = await load({ configured: false });

    expect(getSupabaseClient()).toBeNull();
    expect(createdWith).toHaveLength(0);
  });

  it('lets the read paths answer quietly', async () => {
    // These run on app startup. Throwing here would replace the app with an
    // error screen on a build whose only fault is having no keys yet.
    const session = await load({ configured: false });

    await expect(session.getAccessToken()).resolves.toBeNull();
    await expect(session.getSessionEmail()).resolves.toBeNull();
    await expect(session.getAuthAvatarUrl()).resolves.toBeNull();
    await expect(session.signOut()).resolves.toBeUndefined();
    await expect(session.forgetDeletedSession()).resolves.toBeUndefined();
  });

  it('refuses the write paths in words', async () => {
    // Someone typing a password into a build with no keys should be told the
    // sign-in cannot happen, not left watching a spinner.
    const session = await load({ configured: false });

    await expect(session.signIn('a@b.test', 'pw')).rejects.toThrow(/not configured/);
    await expect(session.signUp('a@b.test', 'pw')).rejects.toThrow(/not configured/);
    await expect(session.sendSignInLink('a@b.test')).rejects.toThrow(/not configured/);
    await expect(session.updatePassword('pw')).rejects.toThrow(/not configured/);
  });
});

describe('the client itself', () => {
  it('is made once and reused', async () => {
    const { getSupabaseClient } = await load();

    const first = getSupabaseClient();

    expect(getSupabaseClient()).toBe(first);
    expect(createdWith).toHaveLength(1);
  });

  it('parses the URL on web and not on native', async () => {
    // **The dead-end bug.** This flag was hardcoded `false` with the note "no
    // URL to parse from in a native app" — true of native, and wrong about the
    // platform this build is actually served on. Supabase returns from a reset
    // or a confirmation with the tokens in the URL fragment; with detection off
    // they sat there unread, no session was established, `PASSWORD_RECOVERY`
    // never fired, and every emailed link in the app went nowhere.
    //
    // Both halves, because asserting only the native one is a test that passes
    // for the hardcoded `false` that caused it.
    const web = await load({ os: 'web' });
    web.getSupabaseClient();
    expect(detectSessionInUrlOf(0)).toBe(true);

    createdWith = [];
    const native = await load({ os: 'ios' });
    native.getSupabaseClient();
    expect(detectSessionInUrlOf(0)).toBe(false);
  });
});

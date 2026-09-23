import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { sessionStore, sessionStoreDegraded } from './sessionStore';
import { SessionUnreadableError } from './sessionUnreadable';

import {
  authRedirectPayload,
  authRedirectUrl,
} from '../../lib/authRedirect';
import { arrival } from '../arrival';
import { onboardingDraft } from '../onboardingDraft';

/**
 * Supabase client for auth only. The backend verifies the access token this
 * issues via JWKS/ES256 (`backend/app/auth.py`) — see DECISIONS.md for why
 * there is no shared JWT secret to configure.
 *
 * All application data goes through the FastAPI backend, never through
 * Supabase directly.
 */
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

let client: SupabaseClient | null = null;

/** Returns null when Supabase env vars are absent, so the app still boots. */
export function getSupabaseClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return null;
  }
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        /*
         * Not `AsyncStorage` directly — see `sessionStore`. On web that is
         * IndexedDB with no deadline on any call, and a read of it that
         * hesitated is what signed musicians out of sessions the server had
         * just granted (measured 2026-09-17).
         */
        storage: sessionStore,
        autoRefreshToken: true,
        persistSession: true,
        /*
         * On the web this is how an emailed link finishes its job.
         *
         * It was hardcoded `false` with the note "no URL to parse from in a
         * native app" — true of native, and wrong about the platform this build
         * is actually served on. Supabase returns from a reset or a
         * confirmation with the tokens in the URL fragment, and with detection
         * off they sat there unread: the session was never established and the
         * `PASSWORD_RECOVERY` event never fired, so every emailed link in the
         * app was a dead end no matter what the mail said.
         *
         * Native genuinely has no URL to parse — a deep link arrives through
         * `Linking` instead — so the original reasoning survives, scoped to the
         * platform it was about.
         */
        detectSessionInUrl: Platform.OS === 'web',
      },
    });
  }
  return client;
}

/*
 * There was an `isAuthConfigured()` here. It answered "are the Supabase vars
 * set", which is *nearly* the question callers were asking and not quite it —
 * the app is only meaningfully signed in when there is also a backend holding
 * the account's data. Having two predicates that agree almost always is worse
 * than having one, so the survivor is `IS_LIVE_BACKEND` in
 * `../environment.ts`. Inside this module the null from `getSupabaseClient()`
 * already says everything a caller needs.
 */

export interface AuthResult {
  /** True when the call left the user signed in. */
  session: boolean;
  /**
   * Sign-up only, and only when Supabase is set to confirm addresses: the
   * account exists but no session was issued until the link is followed.
   */
  awaitingConfirmation: boolean;
  /**
   * Sign-up only: the address looks like it already has an account, so no
   * confirmation mail is coming.
   *
   * "Possibly" is honest rather than hedging. Supabase obfuscates this case on
   * purpose and the empty-`identities` tell is a behaviour, not a contract —
   * so the screen phrases its message to cover both readings instead of
   * announcing that the address is taken, which would hand an attacker the
   * account-enumeration oracle Supabase is withholding.
   */
  possiblyAlreadyRegistered: boolean;
}

export type ConsumedAuthRedirect = 'ignored' | 'signedIn' | 'recovery';

/**
 * Establishes the session carried by an emailed link on iOS or Android.
 *
 * Web callbacks are consumed by auth-js's `detectSessionInUrl`. Native links
 * arrive through Expo Linking instead, and without this bridge confirmation,
 * passwordless sign-in, and password recovery merely opened the app while
 * leaving it signed out.
 */
export async function consumeAuthRedirect(
  url: string,
): Promise<ConsumedAuthRedirect> {
  const payload = authRedirectPayload(url);
  if (!payload) {
    return 'ignored';
  }
  if (payload.kind === 'error') {
    throw new Error(payload.message);
  }

  const supabase = requireClient();
  const { error } = await supabase.auth.setSession({
    access_token: payload.accessToken,
    refresh_token: payload.refreshToken,
  });
  if (error) {
    throw error;
  }
  return payload.recovery ? 'recovery' : 'signedIn';
}

/** Signs in with an email and password. Throws with the provider's reason. */
export async function signIn(
  email: string,
  password: string,
): Promise<AuthResult> {
  const supabase = requireClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) {
    throw error;
  }
  return {
    session: Boolean(data.session),
    awaitingConfirmation: false,
    // Only sign-up can tell us anything about this.
    possiblyAlreadyRegistered: false,
  };
}

/**
 * Creates an account.
 *
 * Supabase issues no session when the project confirms email addresses, which
 * is the default — the account exists but the musician has to follow a link
 * first. That is a real outcome, not a failure, so it comes back as one.
 *
 * **The address that already has an account is the case worth knowing about.**
 * With confirmations on, Supabase does not error for it. It returns a fully
 * obfuscated user — deliberately, so a stranger cannot test which addresses
 * are registered — and the one thing that gives it away is an empty
 * `identities` array. Read naively that looks identical to a fresh sign-up
 * awaiting confirmation, and the app told the musician a link was on its way
 * that would sign them in. No link is ever sent. They wait forever.
 *
 * (`authErrors.ts` maps a "user already registered" error, but Supabase only
 * returns that with confirmations *off*, so it never covers the default.)
 */
export async function signUp(
  email: string,
  password: string,
): Promise<AuthResult> {
  const supabase = requireClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: authRedirectUrl() },
  });
  if (error) {
    throw error;
  }
  const identities = data.user?.identities;
  return {
    session: Boolean(data.session),
    awaitingConfirmation: Boolean(data.user) && !data.session,
    // `undefined` means this Supabase version didn't send the field, which is
    // not the same as "no identities" — only an actual empty array is the
    // signal, so anything else stays false.
    possiblyAlreadyRegistered: Array.isArray(identities) && identities.length === 0,
  };
}

/**
 * Sends a sign-in link — the spec's "magic link", and the last piece of
 * §Auth that the mobile app never had.
 *
 * It was unbuildable until the emailed link had somewhere to land: with no
 * `redirectTo` and no URL parsing, a link that signs you in would have signed
 * you in to a Supabase page. That is fixed, so this is now mostly one call.
 *
 * **`shouldCreateUser` is left at its default of true**, so an address with no
 * account gets one. That is the passwordless convention, and the alternative is
 * worse than it looks: with it false, Supabase errors for an unknown address
 * and the error is an account-enumeration oracle — a stranger could test
 * addresses one at a time. The cost is that a typo'd address creates a stray
 * account that nobody ever confirms, which is the trade every passwordless
 * product makes.
 *
 * Nothing is returned. Either the mail arrives and the link establishes a
 * session — which `useAuthStatus` hears, replacing the screen — or it doesn't.
 */
export async function sendSignInLink(email: string): Promise<void> {
  const supabase = requireClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: authRedirectUrl() },
  });
  if (error) {
    throw error;
  }
}

/**
 * Sends a password-reset link.
 *
 * Always resolves, even for an address with no account: telling an anonymous
 * caller which addresses are registered is an account-enumeration hole, and
 * Supabase deliberately doesn't distinguish the two either.
 *
 * **The link now comes back to the app.** It used to land on the project's
 * Site URL — a Supabase page — because no `redirectTo` was given and nothing
 * here could have handled the return anyway. See `authRedirectUrl`, and note
 * that the value it returns has to be listed under Redirect URLs in the
 * Supabase dashboard or Supabase quietly ignores it.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const supabase = requireClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: authRedirectUrl(),
  });
  if (error) {
    throw error;
  }
}

/** Sends the confirmation mail again, for the one that never arrived. */
export async function resendConfirmation(email: string): Promise<void> {
  const supabase = requireClient();
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: authRedirectUrl() },
  });
  if (error) {
    throw error;
  }
}

/**
 * Changes the password on the signed-in account.
 *
 * Supabase has no "current password" check on this call — the session is the
 * proof. The screen asks for it anyway and verifies it by signing in with it
 * first, so someone can't change the password on a borrowed unlocked phone.
 */
export async function updatePassword(password: string): Promise<void> {
  const supabase = requireClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    throw error;
  }
}

/**
 * Starts an email change. The address doesn't move until the link sent to the
 * new one is followed, so the caller should say so rather than reporting it
 * done.
 */
export async function updateEmail(email: string): Promise<void> {
  const supabase = requireClient();
  const { error } = await supabase.auth.updateUser(
    { email },
    { emailRedirectTo: authRedirectUrl() },
  );
  if (error) {
    throw error;
  }
}

function requireClient(): SupabaseClient {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Sign-in is unavailable: Supabase is not configured.');
  }
  return supabase;
}

/**
 * The signed-in user's profile photo, if the identity provider supplied one.
 *
 * Nothing in our own schema stores an avatar, so this is the only photo the
 * app can reach. OAuth providers write it into the auth user's metadata —
 * Google under `picture`, most others under `avatar_url` — and accounts
 * created with an email and password have neither. Null is the common case.
 */
export async function getAuthAvatarUrl(): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }
  const { data } = await supabase.auth.getUser();
  const metadata = data.user?.user_metadata ?? {};
  const url = metadata.avatar_url ?? metadata.picture;
  return typeof url === 'string' && url ? url : null;
}

/**
 * Ends the session and clears the persisted tokens.
 *
 * A no-op when Supabase isn't configured, which is the state the app boots in
 * until the env vars are set.
 *
 * **The onboarding draft goes with it**, before the request rather than after:
 * unanswered answers on a shared device would be applied to whoever signs in
 * next, which is somebody else's name and instrument on their account. Dropped
 * even if the sign-out request then fails, because the intent to leave is what
 * makes them the wrong person's.
 */
export async function signOut(): Promise<void> {
  onboardingDraft.clear();
  arrival.settled();
  const supabase = getSupabaseClient();
  if (!supabase) {
    return;
  }
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
}

/**
 * Clears only this device's session after the server has deleted the identity.
 *
 * A normal sign-out asks the auth server to revoke a session. Once the user no
 * longer exists that request may be rejected, leaving stale tokens on the
 * device. Local scope removes them without asking a deleted account to answer.
 */
export async function forgetDeletedSession(): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return;
  }
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) {
    throw error;
  }
}

/**
 * The signed-in address, from the session itself.
 *
 * **Not the same thing as `/v1/me`'s email, and the difference bites.**
 * `ChangePasswordScreen` re-authenticates before changing a password, and it
 * used to do so with the address `useMe()` returned. On a fixture build that
 * is `you@example.com`; the moment real credentials are configured, the
 * re-auth would sign in as an address the session holder has never heard of.
 * The session is the authority on who is signed in — the profile row is a
 * description of them, fetched separately and possibly stale.
 */
export async function getSessionEmail(): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.email ?? null;
}

/**
 * Whether there is a session at all.
 *
 * Separate from `getSessionEmail`, which answers *who* — this answers
 * *whether*, and it is asked on a path where a caller has just been handed an
 * exception and needs to know whether to believe it. A null read is taken at
 * face value here on purpose: this is the conservative half of
 * `settleAuthCall`, where being wrong costs a retry rather than an account.
 */
export async function hasSession(): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return false;
  }
  const { data } = await supabase.auth.getSession();
  return Boolean(data.session);
}

/**
 * Current access token, or null when signed out or unconfigured.
 *
 * **Null means signed out and nothing else.** `supabase.auth.getSession()`
 * re-reads the store on every call and answers a failed read the same way it
 * answers an empty one, so a store that hesitated used to arrive here as a
 * missing session and leave as a sign-out. `sessionStore` keeps that from
 * happening where it can; where it cannot, this throws instead of lying.
 *
 * The same distinction the backend draws one layer up: `app/auth.py` answers
 * 503 rather than 401 when it cannot reach the key server, *because could not
 * check is not the same as not valid*.
 */
export async function getAccessToken(): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? null;
  if (token === null && sessionStoreDegraded()) {
    throw new SessionUnreadableError();
  }
  return token;
}

/** Local identity for account-scoped device data. Never infer it from a score. */
export async function getActiveAccountId(): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }
  const { data } = await supabase.auth.getSession();
  const accountId = data.session?.user.id ?? null;
  if (accountId === null && sessionStoreDegraded()) {
    throw new SessionUnreadableError();
  }
  return accountId;
}

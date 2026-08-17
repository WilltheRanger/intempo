import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        // No URL to parse from in a native app.
        detectSessionInUrl: false,
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
  const { data, error } = await supabase.auth.signUp({ email, password });
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
 * Sends a password-reset link.
 *
 * Always resolves, even for an address with no account: telling an anonymous
 * caller which addresses are registered is an account-enumeration hole, and
 * Supabase deliberately doesn't distinguish the two either.
 *
 * The link lands wherever the Supabase project's redirect settings point. In
 * this build that's the project's Site URL — completing the reset inside the
 * app needs a deep-link scheme registered and a handler for the recovery
 * event, which is real work that can't be verified without a device and a
 * live project.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const supabase = requireClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) {
    throw error;
  }
}

/** Sends the confirmation mail again, for the one that never arrived. */
export async function resendConfirmation(email: string): Promise<void> {
  const supabase = requireClient();
  const { error } = await supabase.auth.resend({ type: 'signup', email });
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
  const { error } = await supabase.auth.updateUser({ email });
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
 */
export async function signOut(): Promise<void> {
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

/** Current access token, or null when signed out or unconfigured. */
export async function getAccessToken(): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

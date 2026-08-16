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

/**
 * Whether sign-in is possible at all.
 *
 * False when the Supabase env vars are absent, which is how the app runs
 * against fixtures. Callers use it to decide whether an auth gate means
 * anything — see `useAuthStatus`.
 */
export function isAuthConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export interface AuthResult {
  /** True when the call left the user signed in. */
  session: boolean;
  /**
   * Sign-up only, and only when Supabase is set to confirm addresses: the
   * account exists but no session was issued until the link is followed.
   */
  awaitingConfirmation: boolean;
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
  return { session: Boolean(data.session), awaitingConfirmation: false };
}

/**
 * Creates an account.
 *
 * Supabase issues no session when the project confirms email addresses, which
 * is the default — the account exists but the musician has to follow a link
 * first. That is a real outcome, not a failure, so it comes back as one.
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
  return {
    session: Boolean(data.session),
    awaitingConfirmation: Boolean(data.user) && !data.session,
  };
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

/** Current access token, or null when signed out or unconfigured. */
export async function getAccessToken(): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

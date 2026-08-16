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

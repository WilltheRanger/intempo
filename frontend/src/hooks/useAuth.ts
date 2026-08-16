import { useEffect } from "react";

import { supabase, supabaseConfigured } from "../lib/supabase";
import { useAuthStore } from "../stores/authStore";

export type AuthStatus = "loading" | "signedIn" | "signedOut";

/**
 * Wire Supabase's session into the store. Call ONCE near the app root.
 * Idempotent under React StrictMode (the listener unsubscribes on cleanup).
 */
export function useAuthListener(): void {
  useEffect(() => {
    const { setSession, setReady } = useAuthStore.getState();
    if (!supabase) {
      setReady(true);
      return;
    }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
}

export function useAuth() {
  const session = useAuthStore((s) => s.session);
  const me = useAuthStore((s) => s.me);
  const ready = useAuthStore((s) => s.ready);

  const status: AuthStatus = !ready
    ? "loading"
    : session
      ? "signedIn"
      : "signedOut";

  async function signInWithEmail(email: string): Promise<void> {
    if (!supabase) throw new Error("Auth is not configured yet.");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/` },
    });
    if (error) throw error;
  }

  async function signOut(): Promise<void> {
    if (supabase) await supabase.auth.signOut();
    useAuthStore.getState().setMe(null);
  }

  return {
    session,
    me,
    status,
    configured: supabaseConfigured,
    email: session?.user?.email ?? me?.email ?? null,
    signInWithEmail,
    signOut,
  };
}

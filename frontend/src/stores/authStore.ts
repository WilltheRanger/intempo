import { create } from "zustand";
import type { Session } from "@supabase/supabase-js";

/** The `public.users` row the backend returns from GET /v1/me. */
export type Me = { id: string; email: string; tier: string };

type AuthState = {
  session: Session | null;
  me: Me | null;
  ready: boolean; // true once the initial session lookup has resolved
  setSession: (session: Session | null) => void;
  setMe: (me: Me | null) => void;
  setReady: (ready: boolean) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  me: null,
  ready: false,
  setSession: (session) => set({ session }),
  setMe: (me) => set({ me }),
  setReady: (ready) => set({ ready }),
}));

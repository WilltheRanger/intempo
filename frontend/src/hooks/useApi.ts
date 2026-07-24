import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { authedFetch } from "../lib/api";
import { useAuthStore } from "../stores/authStore";
import type { Me } from "../stores/authStore";
import { useAuth } from "./useAuth";

/**
 * Fetch the signed-in user's profile (GET /v1/me) and stash it in the
 * auth store (spec §5 step 2). Only runs once signed in.
 */
export function useMe() {
  const { status } = useAuth();
  const setMe = useAuthStore((s) => s.setMe);

  const query = useQuery({
    queryKey: ["me"],
    queryFn: () => authedFetch<Me>("/v1/me"),
    enabled: status === "signedIn",
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (query.data) setMe(query.data);
  }, [query.data, setMe]);

  return query;
}

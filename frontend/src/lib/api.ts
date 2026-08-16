import { supabase } from "./supabase";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

export type HealthResponse = { status: string };

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Unauthenticated JSON fetch (health checks, public endpoints). */
export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!response.ok) {
    throw new ApiError(response.status, `Request failed (${response.status}): ${path}`);
  }
  return (await response.json()) as T;
}

/**
 * Authenticated fetch — attaches the current Supabase access token.
 * Supabase owns token storage/refresh; we never touch localStorage.
 */
export async function authedFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  let token: string | undefined;
  if (supabase) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    token = session?.access_token;
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new ApiError(
      response.status,
      `API ${response.status}: ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

export async function getHealth(): Promise<HealthResponse> {
  return fetchJson<HealthResponse>("/v1/health");
}

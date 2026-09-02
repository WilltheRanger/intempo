import { useSyncExternalStore } from 'react';

let notice: string | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): string | null {
  return notice;
}

/** The recoverable explanation shown by the signed-out auth screen. */
export function useAuthRedirectNotice(): string | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

export function setAuthRedirectNotice(message: string | null): void {
  if (notice === message) {
    return;
  }
  notice = message;
  listeners.forEach((listener) => listener());
}

export function clearAuthRedirectNotice(): void {
  setAuthRedirectNotice(null);
}

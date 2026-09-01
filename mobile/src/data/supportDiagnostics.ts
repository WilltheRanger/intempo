import { ApiError, apiFetch } from './api/client';

export type ConnectionReport =
  | { kind: 'connected' }
  | { kind: 'service_unreachable'; message: string }
  | { kind: 'session_ended' }
  | { kind: 'account_unreachable'; message: string };

export type SupportRequest = (
  path: string,
  options?: { authenticated?: boolean },
) => Promise<unknown>;

/**
 * Check both halves of a usable app connection.
 *
 * Health alone only proves that the host woke up. A second authenticated read
 * proves that the saved session can reach the account behind it. Both calls are
 * safe GETs; nothing in the musician's library is changed.
 */
export async function checkAppConnection(
  request: SupportRequest = (path, options) => apiFetch(path, options),
): Promise<ConnectionReport> {
  try {
    await request('/v1/health', { authenticated: false });
  } catch (cause) {
    return {
      kind: 'service_unreachable',
      message:
        cause instanceof Error
          ? cause.message
          : 'The practice service could not be reached.',
    };
  }

  try {
    await request('/v1/me');
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 401) {
      return { kind: 'session_ended' };
    }
    return {
      kind: 'account_unreachable',
      message:
        cause instanceof Error
          ? cause.message
          : 'Your account could not be opened.',
    };
  }

  return { kind: 'connected' };
}

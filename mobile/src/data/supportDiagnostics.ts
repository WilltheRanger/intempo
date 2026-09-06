export type ConnectionReport =
  | { kind: 'connected' }
  | { kind: 'service_unreachable'; message: string }
  | { kind: 'service_unready'; message: string }
  | { kind: 'session_ended' }
  | { kind: 'account_unreachable'; message: string };

export type SupportRequest = (
  path: string,
  options?: { authenticated?: boolean },
) => Promise<unknown>;

/**
 * Check both halves of a usable app connection.
 *
 * Health alone only proves that the host woke up. Readiness proves the deployed
 * service, schema, storage, and worker configuration can perform the product's
 * work. A final authenticated read proves that the saved session can reach the
 * account behind it. All three calls are safe GETs; nothing in the musician's
 * library is changed.
 */
export async function checkAppConnection(
  request: SupportRequest,
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
    const readiness = await request('/v1/ready', { authenticated: false });
    if (
      readiness !== null &&
      typeof readiness === 'object' &&
      'ready' in readiness &&
      readiness.ready === false
    ) {
      return {
        kind: 'service_unready',
        message: describeReadinessFailure({ detail: readiness }),
      };
    }
  } catch (cause) {
    // Only an explicit readiness response establishes a setup problem. A
    // dropped connection after health succeeded says nothing about readiness.
    const detail = cause !== null && typeof cause === 'object' && 'detail' in cause
      ? cause.detail
      : null;
    if (
      detail === null || typeof detail !== 'object' ||
      !('ready' in detail) || detail.ready !== false
    ) {
      return {
        kind: 'service_unreachable',
        message: cause instanceof Error
          ? cause.message
          : 'The practice service could not be reached.',
      };
    }
    return {
      kind: 'service_unready',
      message: describeReadinessFailure(cause),
    };
  }

  try {
    await request('/v1/me');
  } catch (cause) {
    if (
      cause !== null &&
      typeof cause === 'object' &&
      'status' in cause &&
      cause.status === 401
    ) {
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

/**
 * Keep deployment internals out of the consumer UI while preserving the one
 * fact that helps: the service answered, but it cannot safely do all of its
 * work. `/v1/ready` deliberately includes migration names for operators; a
 * musician should not be asked to understand or repair those.
 */
function describeReadinessFailure(cause: unknown): string {
  const detail =
    cause !== null && typeof cause === 'object' && 'detail' in cause
      ? cause.detail
      : null;
  const blocking =
    detail !== null &&
    typeof detail === 'object' &&
    'blocking' in detail &&
    Array.isArray(detail.blocking)
      ? detail.blocking.length
      : null;

  if (blocking && blocking > 1) {
    return `${blocking} required parts of the practice service are not ready.`;
  }
  if (blocking === 1) {
    return 'One required part of the practice service is not ready.';
  }
  return 'The practice service answered, but it is not ready to handle every action.';
}

import { apiFetch } from './api/client';
import { forgetDeletedSession, getActiveAccountId } from './auth/session';
import { deleteAccountTakes } from '../lib/sync/takeQueue.store';

/**
 * Permanently removes the authenticated account, then clears this device.
 *
 * The local session is cleared only after the backend confirms the identity
 * was deleted. A failed request therefore leaves the musician signed in so
 * they can retry instead of creating a half-finished deletion.
 */
export async function deleteAccount(): Promise<void> {
  const accountId = await getActiveAccountId();
  await apiFetch<void>('/v1/me', { method: 'DELETE' });
  try {
    if (accountId) await deleteAccountTakes(accountId);
  } finally {
    await forgetDeletedSession();
  }
}

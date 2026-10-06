import type { Instrument } from '../types';

/**
 * Which instrument, if any, the account still needs to be told about.
 *
 * Profile changes the instrument on the device at once — the warmup, the
 * labels and the recorder read it synchronously — and then writes the account,
 * so a reinstall or a second phone starts on the right one instead of the
 * onboarding answer (the owner's choice, 2026-10-06). Offline, the write fails
 * and `instrumentUnsent` remembers it; this decides, each time the account
 * loads, whether to send it now.
 *
 * - Nothing owed: nothing to send.
 * - Owed, and the account already says the same: nothing to send — another
 *   device, or a write whose answer never came back, got there first — and
 *   the caller clears the flag.
 * - Owed, and the account says something else: send the device's.
 */
export function instrumentToSend(
  device: Instrument,
  unsent: boolean,
  account: Instrument | null | undefined,
): Instrument | null {
  if (!unsent) return null;
  if (account === undefined) return null; // the account has not loaded yet
  return account === device ? null : device;
}

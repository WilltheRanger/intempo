import type { LegalDocument } from '../../lib/legal';

/**
 * The documents a person can inspect before they create an account.
 *
 * Kept as data so the sign-up screen and its test use the same list. The
 * labels are actions, not legal shorthand: a first-time user should know
 * exactly what opens.
 */
export const SIGN_UP_DOCUMENTS: ReadonlyArray<{
  id: LegalDocument['id'];
  label: string;
}> = [
  { id: 'privacy', label: 'Privacy policy' },
  { id: 'terms', label: 'Terms of use' },
];

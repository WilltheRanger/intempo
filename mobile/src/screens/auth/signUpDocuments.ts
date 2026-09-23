import type { LegalDocument } from '../../lib/legal';

/**
 * The documents a person can inspect before they create an account.
 *
 * Kept as data so the sign-up screen and its test use the same list. In the
 * order and the words of the sentence they sit in (`redesign/SignIn.dc.html`):
 * "Creating an account means you accept the terms of use and the privacy
 * policy." Plain names rather than legal shorthand, so a first-time user
 * knows exactly what opens.
 */
export const SIGN_UP_DOCUMENTS: ReadonlyArray<{
  id: LegalDocument['id'];
  label: string;
}> = [
  { id: 'terms', label: 'terms of use' },
  { id: 'privacy', label: 'privacy policy' },
];

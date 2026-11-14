/**
 * What "Looks right" says, and whether it asks first, by whether the
 * photographs will survive it.
 *
 * **It said "Deletes the photo to save space" to everyone, and that was not
 * true of everyone** (the UI review, 2026-11-12). Accepting a reading deletes
 * its photographs unless the musician has switched on "Help improve score
 * reading", and then the server keeps them (`accept_transcription`,
 * `_consents_to_training`) — so the screen promised a deletion, asked "Delete
 * the photo? … can't be recovered", and kept the photo.
 *
 * With consent on, nothing is lost by accepting, so nothing is asked: the
 * dialog exists because a deletion cannot be undone.
 *
 * `keepsPhoto` is null while the account is still loading, and is answered as
 * a deletion: when it is not known which will happen, asking first is the
 * careful side to be wrong on.
 */
export interface AcceptCopy {
  /** The line under the button. */
  note: string;
  /** The button's label while the accept is in flight. */
  pending: string;
  /** Asked before accepting, or null where accepting loses nothing. */
  confirm: { title: string; message: string; confirmLabel: string } | null;
}

export function acceptCopy(keepsPhoto: boolean | null): AcceptCopy {
  if (keepsPhoto === true) {
    return {
      note: 'Keeps the photo to improve score reading.',
      pending: 'Saving…',
      confirm: null,
    };
  }
  return {
    note: 'Deletes the photo to save space.',
    pending: 'Deleting the photo…',
    confirm: {
      title: 'Delete the photo?',
      // The consequence, not the verb. Naming what survives matters as much as
      // naming what goes: someone who thinks they are deleting the piece will
      // cancel a thing they actually wanted.
      message: 'The notes stay. The photo can’t be recovered.',
      confirmLabel: 'Delete photo',
    },
  };
}

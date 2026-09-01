/**
 * What tapping back means on the record screen.
 *
 * The screen has four phases and one back chevron, and the chevron did two
 * different things without saying so: on the ready screen it left for the
 * piece, and during the count-in it silently became a second Cancel — same
 * glyph, same corner, different outcome, and a screen reader announcing
 * "Cancel count-in" twice because the big button below said it too.
 *
 * Worse than the duplicate: **while a take was being recorded, back threw it
 * away without asking.** Two minutes of playing, one reflex tap, gone. The
 * microphone is released on unmount, which is correct and is also the whole
 * problem — the cleanup is silent because nothing else needs to be said about
 * a microphone, and the recording went with it.
 *
 * A module rather than a branch inside the `.tsx`: there is no React Native
 * testing library here (`DECISIONS.md`, 2026-08-24), so a rule written in a
 * component is a rule nothing checks.
 */

/** The phase machine `RecordScreen` runs on. */
export type RecordPhase = 'ready' | 'counting_in' | 'recording' | 'analysing';

/**
 * What the screen should do when someone asks to leave it.
 *
 * Nothing here has to stop the count-in or release the microphone: the screen's
 * unmount cleanup does the first and `useMetronome`'s does the second, whichever
 * way the musician left. A rule that repeated them would be a second place for
 * them to be wrong.
 */
export type Leaving =
  | { kind: 'leave' }
  | {
      kind: 'confirm';
      title: string;
      message: string;
      confirmLabel: string;
      cancelLabel: string;
    };

/**
 * The one thing worth asking about is audio that exists and has not been sent.
 *
 * Deliberately **not** a duration threshold. "Longer than N seconds" would put
 * a number in the way of the question actually being asked, which is whether
 * anything would be lost; and by the time the phase is `recording` a musician
 * has already sat through a whole count-in bar, so there is no accidental-tap
 * case left for a threshold to absorb.
 */
export function leavingRecord({
  phase,
  unsentTake,
  pieceTitle,
}: {
  phase: RecordPhase;
  /** A finished take held on the screen because sending it failed. */
  unsentTake: boolean;
  pieceTitle?: string | null;
}): Leaving {
  if (phase === 'recording') {
    return {
      kind: 'confirm',
      title: 'Discard this take?',
      // Names the piece when the screen knows it, because the dialog covers
      // the header that was saying so.
      message: pieceTitle
        ? `You are still recording ${pieceTitle}. Leaving throws away what you have played.`
        : 'You are still recording. Leaving throws away what you have played.',
      confirmLabel: 'Discard',
      // Not "Cancel". Half the words on this screen are already about
      // cancelling something, and the button that keeps the take should say
      // what it keeps.
      cancelLabel: 'Keep recording',
    };
  }

  if (unsentTake) {
    return {
      kind: 'confirm',
      title: 'Discard this take?',
      // The screen is offering "Send it again" at this moment; the dialog has
      // to say that leaving is the end of that offer.
      message:
        'This take has not reached the server yet. Leaving is the last chance to send it.',
      confirmLabel: 'Discard',
      cancelLabel: 'Stay',
    };
  }

  return { kind: 'leave' };
}

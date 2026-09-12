/**
 * The sentences the Insights screen assembles, out of the component.
 *
 * There is no React Native testing library here (`DECISIONS.md`, 2026-08-24),
 * so a rule written inside a `.tsx` is a rule nothing checks. These are three
 * plural rules and one count, which is exactly the kind of thing that reads
 * fine in review and ships "1 sessions".
 */

/** "last 30 days", for the eyebrow. Lower case — it follows "Insights · ". */
export function windowLabel(days: number): string {
  return days === 1 ? 'last day' : `last ${days} days`;
}

/**
 * Why this piece is the one to practise next.
 *
 * One clause, because it is a row's detail line rather than a paragraph in a
 * box. It ran to three sentences in a card once, then to two on the row; the
 * second of those was "Record another take and compare", which is what the row
 * does when you press it. The chevron is already that sentence, and a row that
 * says out loud what its own affordance means is the interface reading itself
 * aloud.
 */
export function focusReason(sessions: number): string {
  const count = sessions === 1 ? '1 session' : `${sessions} sessions`;
  return `Your clearest timing pattern, across ${count}.`;
}

/**
 * What a musician with no practice history should do next, and where.
 *
 * **The screen used to name an action it did not offer.** "Record yourself
 * playing a piece and InTempo will show you where the tempo held and where it
 * drifted" — with nothing on the screen to press, on the tab a brand-new
 * account is one thumb-reach from. The Today screen had exactly this bug and
 * a comment recording the fix; Insights kept it.
 *
 * Which action it is depends on something this screen does not otherwise care
 * about: an empty library needs a piece before a take is even possible, and
 * sending someone to a record button they cannot use is the same dead end one
 * screen further on.
 */
export interface NextStep {
  description: string;
  label: string;
  /** Where the button goes. The screen owns the navigating; this owns the choice. */
  destination: 'add' | 'library';
}

export function firstStep(pieceCount: number): NextStep {
  if (pieceCount === 0) {
    return {
      description:
        'Add a piece and record yourself playing it. InTempo will show you where the tempo held and where it drifted.',
      label: 'Add your first piece',
      destination: 'add',
    };
  }
  return {
    description:
      'Record yourself playing a piece and InTempo will show you where the tempo held and where it drifted.',
    // Not "Record a take": with more than one piece in the library there is no
    // one take to start, and picking one on the musician's behalf would open
    // the microphone on something they did not choose.
    label: pieceCount === 1 ? 'Record this piece' : 'Choose a piece to record',
    destination: 'library',
  };
}

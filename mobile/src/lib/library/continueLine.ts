import type { Piece } from '../../data/types';
import { splitTitle } from '../pieceTitle';

/**
 * The line at the top of the Library that says what to play next.
 *
 * **Library is the first screen now, and this is what Today was for.** The
 * owner chose it on 2026-09-30 over giving Today a new job: Today had become a
 * photograph and one piece on it, and "which piece, and a button that starts a
 * take" fits in one ruled row above the shelf it came from. What the tab bar
 * loses is a screen that said the same thing as the one next to it.
 *
 * A rule rather than JSX because every part of it is conditional — whether the
 * row exists at all, what its second line says, what its button promises — and
 * there is no React Native testing library here (`DECISIONS.md`, 2026-08-24).
 */
export interface ContinueLine {
  /** The piece's name without its catalogue number (`lib/pieceTitle.ts`). */
  title: string;
  /**
   * One line under the title: why this piece, in as few words as the shelf
   * uses. How it last went where a take says; the composer where none does;
   * that the page is still being read while it is.
   */
  detail: string | null;
  /**
   * What the button promises, which is what the tap opens: the recorder for a
   * piece with notation, the piece itself for one without — a button saying
   * "Practice" over a screen that cannot record would be describing another
   * screen.
   */
  actionLabel: 'Practice' | 'Open';
}

export interface ContinueInput {
  /** `useCurrentPiece`: the most recently played piece, else the newest. */
  piece: Piece | null;
  /** `pieceStatus` for that piece — how it last went — or null. */
  status: string | null;
  /** Whether a search is narrowing the shelf. */
  searching: boolean;
}

/**
 * The row, or null for no row.
 *
 * **No row for an empty library**: the shelf's own empty state already offers
 * the one thing there is to do, and a second "Add your first piece" above it
 * would be the same invitation twice. **No row while searching**: a search is
 * the musician naming a piece, and a suggestion above the answer would push
 * the answer down.
 */
export function continueLineFor({ piece, status, searching }: ContinueInput): ContinueLine | null {
  if (!piece || searching) {
    return null;
  }
  const reading =
    piece.transcriptionStatus === 'queued' || piece.transcriptionStatus === 'reading';
  return {
    title: splitTitle(piece.title).name,
    detail: reading ? 'Reading your photo…' : status ?? piece.composer ?? null,
    actionLabel: hasNotation(piece) ? 'Practice' : 'Open',
  };
}

/** Whether the piece can be recorded against: it has bars to time. */
export function hasNotation(piece: Piece): boolean {
  return (piece.score?.measures.length ?? 0) > 0;
}

/**
 * How far along the take this device handed over is.
 *
 * Mirrors what one `GET /v1/analyses/:id` can say: the request is in flight,
 * the analysis is still running, there is a result, or the question could not
 * be asked.
 */
export type PendingCheck = 'checking' | 'working' | 'ready' | 'unavailable';

/** The one line the Library gives a take that was handed over and not yet read. */
export interface PendingLine {
  label: string;
  /**
   * Whether pressing it opens the result. When false the line is still a
   * control — it asks again — which is the whole reason it is not a caption:
   * a take recorded on a train finishes somewhere with no signal, and the only
   * other way back to it was to remember which piece it was.
   */
  ready: boolean;
}

/**
 * The last recording's hand-off, as one line under the Continue row.
 *
 * It lived under Today's button, and one line is still what it gets: four
 * states, each legible without a second line to explain it. The piece's title
 * goes in when it is known — "your last take" is true of every take, and a
 * musician who recorded three pieces in a rehearsal needs to know which one
 * came back.
 */
export function pendingLineFor(check: PendingCheck, pieceTitle: string | null): PendingLine {
  const named = pieceTitle ? `\u2009\u2014\u2009${pieceTitle}` : '';
  switch (check) {
    case 'ready':
      return { label: `Your result is ready${named}`, ready: true };
    case 'checking':
      return { label: 'Checking your last take…', ready: false };
    case 'unavailable':
      // Not "failed": the server accepted the recording and still has it. Only
      // the question went wrong, and a line implying otherwise would have a
      // musician re-record something that is safe.
      return { label: 'Couldn’t check your last take. Retry', ready: false };
    case 'working':
      return { label: `Analysing your last take${named}`, ready: false };
  }
}

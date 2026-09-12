import type { Piece, PracticeInsights } from '../data/types';
import { daysSincePracticed, formatLastPracticed } from './format';
import { readPieceWord, tempoWanders } from './insights/tendency';

/**
 * What to put under the practice card, and why.
 *
 * Pure, because "which piece needs attention" is a claim the app makes to a
 * musician about their own playing, and a claim like that should be checkable
 * without a renderer.
 *
 * The rule both suggestions obey: **never name a piece without saying why it
 * is on the screen.** A row that only names a piece is a list, and a list of
 * pieces on Today is the Library tab with fewer rows — which is the exact
 * thing this screen was pulled apart to stop being.
 */

export interface Suggestion {
  pieceId: string;
  title: string;
  /** The reason. Shown under the title, always present. */
  detail: string;
}

export interface SuggestionInput {
  pieces: Piece[];
  insights: PracticeInsights | null;
  /**
   * Pieces already named elsewhere on the screen — the one in the card, and
   * the one in the last take.
   *
   * Nothing here may repeat them. "60 Studies" appearing as both the take you
   * just finished and a piece worth a look is two true statements that read as
   * one bug, and the second tells you nothing the first didn't.
   */
  excludeIds: (string | null)[];
  now?: Date;
}

export interface Suggestions {
  /** The piece drifting furthest from the beat. Null when nothing is off. */
  attention: Suggestion | null;
  /** The piece left alone longest. Null when the library has nothing else. */
  neglected: Suggestion | null;
}

/**
 * The piece worth attention: the most drift, excluding the one being practiced.
 *
 * `insights.pieces` already arrives sorted most-drift-first — the source
 * comments say that is what the ordering is for — so this filters rather than
 * re-sorts. Anything the pipeline calls on-tempo is skipped: "worth attention"
 * over a piece that is fine would be an invented problem, and this app's whole
 * credibility rests on not inventing them.
 */
function attentionFrom(
  insights: PracticeInsights | null,
  excluded: (string | null)[],
): Suggestion | null {
  const entry = insights?.pieces.find(
    (piece) =>
      !excluded.includes(piece.pieceId) &&
      // **`verdict` alone is not "is anything wrong with this piece".** It is
      // a claim about a *direction*, and a piece played a long way off the
      // beat on both sides has no direction — its verdict is `on_tempo` and
      // its playing is the least steady in the library. Reading only the
      // verdict skipped exactly the piece most worth naming here.
      (piece.verdict !== 'on_tempo' || tempoWanders(piece)),
  );
  if (!entry) {
    return null;
  }
  const sessions = entry.sessions === 1 ? '1 session' : `${entry.sessions} sessions`;
  return {
    pieceId: entry.pieceId,
    title: entry.title,
    detail: `${readPieceWord(entry)} across ${sessions}`,
  };
}

/**
 * The piece left alone longest.
 *
 * Never-practiced beats long-ago: a piece added and never opened is more
 * neglected than one worked a month back, and it is also the only suggestion
 * that can appear before the pipeline has analysed anything — which is every
 * new account.
 */
function neglectedFrom(
  pieces: Piece[],
  excluded: (string | null)[],
  now: Date,
): Suggestion | null {
  const candidates = pieces.filter((piece) => !excluded.includes(piece.id));
  if (candidates.length === 0) {
    return null;
  }

  const never = candidates
    .filter((piece) => daysSincePracticed(piece.lastPracticedAt, now) === null)
    // Alphabetical, so the same library always suggests the same piece rather
    // than whichever the list happened to return first.
    .sort((a, b) => a.title.localeCompare(b.title));

  /**
   * **By the instant, not by the day, and that is a correctness fix rather
   * than a tidy-up.**
   *
   * This was a `reduce` keeping the largest `daysSincePracticed`, which counts
   * whole *calendar* days — so two pieces worked in the same session tie, and
   * a strict `>` then kept whichever the list happened to return first. The
   * branch above sorts alphabetically for exactly that reason and says so;
   * this one had the same problem and no answer to it, so "the piece you have
   * left longest" changed with row order. That is the Insights bug one screen
   * over: a claim about a musician's own practice that depends on the order
   * rows came back in.
   *
   * The timestamp is the better answer, not merely the deterministic one. Of
   * two pieces played on the same day, the one played at nine has genuinely
   * been left longer than the one played at nine in the evening — alphabetical
   * would only have made an arbitrary choice repeatable. Title breaks a true
   * tie, which needs two takes at the same instant.
   */
  const oldestFirst = [...candidates].sort((a, b) => {
    const at = Date.parse(a.lastPracticedAt ?? '');
    const bt = Date.parse(b.lastPracticedAt ?? '');
    if (at !== bt) {
      return at - bt;
    }
    return a.title.localeCompare(b.title);
  });

  const chosen = never[0] ?? oldestFirst[0];

  return {
    pieceId: chosen.id,
    title: chosen.title,
    detail:
      // The same `now` the choice was made against — see `formatLastPracticed`.
      formatLastPracticed(chosen.lastPracticedAt, now) ??
      'Ready for a first session',
  };
}

export function suggestionsFor({
  pieces,
  insights,
  excludeIds,
  now = new Date(),
}: SuggestionInput): Suggestions {
  const attention = attentionFrom(insights, excludeIds);
  const neglected = neglectedFrom(
    pieces,
    [...excludeIds, attention?.pieceId ?? null],
    now,
  );
  return { attention, neglected };
}

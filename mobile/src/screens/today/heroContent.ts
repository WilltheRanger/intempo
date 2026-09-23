import type { Piece } from '../../data/types';
import { joinMetadata } from '../../lib/format';
import { formatWorkingTempo } from '../../lib/tempo';

/**
 * What the Today hero says, as a rule rather than as JSX.
 *
 * **The screen is a photograph with five lines of type on it**, and every one
 * of those lines is a decision: which piece, what to call the thing you are
 * about to do, what the button says when there is no piece at all. There is
 * no React Native testing library here (`DECISIONS.md`, 2026-08-24), so a rule
 * written inside `PracticeHero.tsx` is a rule nothing checks — which is why it
 * is here.
 *
 * `CLAUDE.md` §3 states this as doctrine and files it under the capture path
 * "because that is where it was learned"; it applies to every screen, and a
 * screen whose whole content is conditional text is the clearest case for it.
 */

/** Which action the hero's button performs. */
export type HeroAction = 'continue' | 'add';

export interface HeroContent {
  /**
   * The small pill above the title. Names why this piece is the one shown,
   * not the piece.
   */
  label: string;
  /** The dominant element on the screen. */
  title: string;
  /** Composer and tempo, or null when there is no piece yet. */
  meta: string | null;
  /**
   * One line under the metadata, only while the piece is still being read.
   *
   * **It used to carry the last take's verdict too, and the owner cut it**
   * (2026-09-23): "don't need it and it takes time to load". Both halves were
   * true. The verdict is the Verdict screen's and Insights' to say, and it came
   * from a second request that landed after the title had drawn, so the block
   * rose by a line and the fall moved with it a moment after arrival.
   */
  detail: string | null;
  actionLabel: string;
  action: HeroAction;
}

export interface HeroInput {
  /** The piece to continue, or null for an account with none. */
  piece: Piece | null;
  /** The tempo this piece is worked at, from `practiceTempo`. */
  workingBpm: number;
}

/**
 * The empty case is a real screen, not a fallback.
 *
 * A brand-new account has no piece, and the hero is the whole screen — so
 * "nothing to show" would be a photograph with a greeting on it and no way in.
 * It gets the same shape: a label, a title that is an instruction, a sentence
 * naming the three ways to start, and the button that opens them.
 */
const NOTHING_YET: HeroContent = {
  label: 'Start here',
  title: 'Add your first piece',
  meta: null,
  detail: null,
  actionLabel: 'Add a piece',
  action: 'add',
};

export function heroContentFor({ piece, workingBpm }: HeroInput): HeroContent {
  if (!piece) {
    return NOTHING_YET;
  }

  const reading =
    piece.transcriptionStatus === 'queued' || piece.transcriptionStatus === 'reading';

  return {
    // **"Recommended" is a slightly bigger claim than the selection earns**,
    // and it is the owner's word, so it is here with the caveat attached
    // rather than silently. `getCurrentPiece` returns the most recently
    // *played* piece — the newest analysis — falling back to the newest score
    // for someone who has never recorded. That is a good default and it is not
    // a recommendation: nothing weighs how a take went, how long ago it was,
    // or what else is due. If the word is to keep earning its place, the
    // ranking is what has to change, not this string.
    label: 'Recommended',
    title: piece.title,
    meta: joinMetadata([
      piece.composer,
      piece.movement,
      formatWorkingTempo(workingBpm, piece.markedBpm, piece.score?.tempo_beat_unit),
    ]),
    // A piece still being read would otherwise be a title and a button with
    // no clue that the app is mid-way through something.
    detail: reading ? 'Reading your photo…' : null,
    // The button says what happens, and what happens depends on whether there
    // is notation to record against — `TodayScreen.openPractice` sends a piece
    // with no measures to its detail screen instead of to the recorder, so a
    // button promising "Continue practice" there would be describing a screen
    // the tap does not open.
    actionLabel: hasNotation(piece) ? 'Practice' : 'Open',
    action: 'continue',
  };
}

function hasNotation(piece: Piece): boolean {
  return (piece.score?.measures.length ?? 0) > 0;
}

/**
 * How far along the take this device handed over is.
 *
 * Mirrors what `TodayScreen` can learn from one `GET /v1/analyses/:id`:
 * the request is in flight, the analysis is still running, there is a result,
 * or the question could not be asked.
 */
export type PendingCheck = 'checking' | 'working' | 'ready' | 'unavailable';

/** The one line the hero gives a take that was handed over and not yet read. */
export interface PendingLine {
  /** What the line says. */
  label: string;
  /**
   * Whether pressing it opens the result.
   *
   * When false the line is still a control — it asks again — which is the
   * whole reason this is not a caption. A take recorded on a train finishes
   * somewhere with no signal, and the only other way back to it was to
   * remember which piece it was.
   */
  ready: boolean;
}

/**
 * The last recording's hand-off, as one line under the hero's button.
 *
 * **It used to be a card below the hero, and the card is why this exists.**
 * Today does not scroll any more — it is the photograph and nothing else — so
 * a block that only appears sometimes cannot live under the fold, because
 * there is no fold. One line is what fits, so the four states have to say
 * themselves in one line each. That is a rule about wording, which is why it
 * is here with tests rather than in the `.tsx`.
 *
 * The piece's title goes in when we know it: "your last take" is true of every
 * take, and a musician who recorded three pieces in a rehearsal needs to know
 * which one came back.
 */
export function pendingLineFor(
  check: PendingCheck,
  pieceTitle: string | null,
): PendingLine {
  const named = pieceTitle ? `\u2009\u2014\u2009${pieceTitle}` : '';
  switch (check) {
    case 'ready':
      return { label: `Your result is ready${named}`, ready: true };
    case 'checking':
      return { label: 'Checking your last take\u2026', ready: false };
    case 'unavailable':
      // Not "failed": the server accepted the recording and still has it. The
      // only thing that went wrong is this question, and the line says so
      // because the alternative is a musician re-recording something that is
      // safe.
      return { label: 'Couldn\u2019t check your last take. Retry', ready: false };
    case 'working':
      return { label: `Analysing your last take${named}`, ready: false };
  }
}

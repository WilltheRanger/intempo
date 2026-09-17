import type { Piece } from '../../data/types';

/**
 * What a tile on the shelf is looking at, and what can be done about it.
 *
 * **Every blank tile in the library used to mean four different things.**
 * `PieceTile` draws the engraving when there is one and an empty page-shaped
 * box when there is not — so a scan still being read, a scan that failed, a
 * piece typed in by hand and a piece whose backend predates the field were all
 * the same silent rectangle with a title under it. The owner's library held
 * nine of the second kind on 2026-09-17, some three weeks old: pieces with a
 * name, no music, and nothing on the shelf saying why or offering a way out.
 *
 * The way out existed the whole time, two screens down — `PieceScoreScreen` has
 * the failure sentence and a "Try reading it again". Nothing on the shelf said
 * so, and a musician looking at a blank tile has no reason to tap through a
 * piece with no notes in it to find out.
 *
 * So the tile says which of the four it is, and the two that can be acted on
 * carry their actions. Here rather than in the component because there is no
 * React Native testing library in this project (`DECISIONS.md`, 2026-08-24):
 * a rule inside a `.tsx` is a rule nothing checks.
 */
export type TileState =
  /** There is music to draw. The tile is the opening of the piece. */
  | { kind: 'engraved' }
  /** A scan is in flight. Worth waiting for, so the tile says so. */
  | { kind: 'reading' }
  /**
   * The page could not be read.
   *
   * `canReadAgain` is false once there is no photograph left to read — an
   * accepted transcription discards it, and a piece that never had one cannot
   * be re-read. Offering the button anyway would be an affordance that does
   * nothing, which §3 of `CLAUDE.md` forbids for the reason it costs a try
   * before it teaches you it is a lie.
   */
  | { kind: 'unreadable'; canReadAgain: boolean }
  /** No notation and nothing pending: typed in, or imported without notes. */
  | { kind: 'bare' };

/** On the page, where the music would be. Two words, not a paragraph. */
export const READING_MESSAGE = 'Reading the page…';
export const UNREADABLE_MESSAGE = 'Couldn’t be read';

export const READ_AGAIN_LABEL = 'Try again';
export const DISCARD_LABEL = 'Discard';

type TilePiece = Pick<Piece, 'score' | 'transcriptionStatus' | 'thumbnail'>;

/**
 * Which of the four a piece is.
 *
 * **Notation wins over status**, in that order and not the other way round. A
 * row can carry measures and a stale `failed` — a re-read that succeeded after
 * an earlier failure, a partial reading the musician kept — and a tile that
 * hid real music behind an error would be wrong about the one thing it is for.
 * The status only ever decides what an *empty* tile says.
 */
export function tileState(piece: TilePiece): TileState {
  if ((piece.score?.measures.length ?? 0) > 0) {
    return { kind: 'engraved' };
  }
  if (piece.transcriptionStatus === 'queued' || piece.transcriptionStatus === 'reading') {
    return { kind: 'reading' };
  }
  if (piece.transcriptionStatus === 'failed') {
    return { kind: 'unreadable', canReadAgain: piece.thumbnail !== null };
  }
  return { kind: 'bare' };
}

/** The line drawn on the page itself, or null when the music is drawn instead. */
export function tileMessage(state: TileState): string | null {
  switch (state.kind) {
    case 'reading':
      return READING_MESSAGE;
    case 'unreadable':
      return UNREADABLE_MESSAGE;
    default:
      return null;
  }
}

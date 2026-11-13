import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { PressableScale } from '../../components/motion';
import { PieceHeading } from '../../components/pieces/PieceHeading';
import { Text } from '../../components/primitives/Text';
import { TextAction } from '../../components/primitives/TextAction';
import { ScoreBand } from '../../components/score/ScoreBand';
import type { Piece, PieceInsight, TakeResult } from '../../data/types';
import { BORDER_WIDTH, colors, radii, spacing } from '../../design';
import { formatLastPracticedShort, joinMetadata } from '../../lib/format';
import { pieceStatus } from '../../lib/library/pieceStatus';
import {
  DISCARD_LABEL,
  READ_AGAIN_LABEL,
  readingLine,
  tileMessage,
  tileState,
} from '../../lib/library/tileState';
import { ReadingPage } from './ReadingPage';

/** Small enough that a tile is a spine, large enough that the notes are notes. */
const TILE_SCALE = 0.62;

/** Close to a page, without claiming to be one: a shelf of upright objects. */
const PAGE_ASPECT = 3 / 4;

/**
 * The page's own margin, above the first system and below the last — the
 * redesign's 16, where the systems are centred on the page rather than hung
 * from its top edge (`redesign/Library.dc.html`).
 */
const MUSIC_PADDING = spacing.lg;

export interface PieceTileProps {
  piece: Piece;
  /**
   * How this piece has sat against the beat across the insights window, drawn
   * as the rail under the title — the redesign's "one tempo rail drawn at
   * three scales", at its smallest. Null for a piece with no takes in the
   * window, which draws no rail rather than a rail at zero: nothing measured
   * is not the same as on the beat.
   */
  insight?: PieceInsight | null;
  /** The piece's newest take, for the line under its title. */
  lastTake?: TakeResult | null;
  onPress: () => void;
  /** The finger landing, before the tap: where the piece starts loading. */
  onPressIn?: () => void;
  /**
   * Read the page again. Absent where the shelf cannot act — a search result
   * list, a build with no backend — and the tile then says what is wrong
   * without offering to fix it.
   */
  onReadAgain?: () => void;
  /** Throw the piece and its photograph away. */
  onDiscard?: () => void;
  /**
   * Something is already running for this piece.
   *
   * Both actions go quiet rather than accepting a second tap: the server
   * refuses a second reading with a 409, and a musician should not have to
   * meet that refusal to learn the first tap landed — the same finding
   * `PieceScoreScreen` records about its own button.
   */
  busy?: boolean;
}

/**
 * One piece, as an object on a shelf.
 *
 * **The thumbnail that used to be here was a photograph, and it was removed
 * for two measured reasons.** One HTTPS fetch of a full-resolution phone
 * photograph per row, decoded on the client, on the screen built for scrolling
 * past forty of them — reported by the owner as "incredibly laggy". And a crop
 * of a page is a weak identifier anyway: every one is a band of staff lines on
 * white paper, at a size where the title that distinguishes them is
 * unreadable.
 *
 * **Neither objection applies to the engraving.** It is drawn from
 * `piece.score`, which arrives with the listing — no image fetch, no decode —
 * and what it draws is the *opening* of the piece: its clef, its key, its
 * metre and its first figure. Two pieces in different keys look different from
 * across the room, which is the whole claim of a shelf.
 *
 * **A piece with nothing engraved still gets a tile.** One entered by hand, one
 * still being read, one whose backend predates the field: the card is the same
 * page-shaped object with the title on it, so the shelf does not develop holes.
 */
export function PieceTile({
  piece,
  insight = null,
  lastTake = null,
  onPress,
  onPressIn,
  onReadAgain,
  onDiscard,
  busy = false,
}: PieceTileProps) {
  // How much page there is to fill. Measured rather than derived from the
  // aspect ratio, because the tile's width is whatever the shelf's column gap
  // leaves it and a second copy of that arithmetic would drift from the first.
  const [pageHeight, setPageHeight] = useState(0);

  function measurePage(event: LayoutChangeEvent) {
    const measured = event.nativeEvent.layout.height;
    setPageHeight((current) => (current === measured ? current : measured));
  }

  const meta = joinMetadata([
    piece.composer,
    formatLastPracticedShort(piece.lastPracticedAt),
  ]);

  // **What an empty page is empty for.** See `tileState`: a scan in flight, a
  // scan that failed, and a piece with no scan at all were one silent
  // rectangle, and the failed one had no way out anywhere on this screen.
  const state = tileState(piece);
  const message = tileMessage(state);
  const unreadable = state.kind === 'unreadable';
  const reading = state.kind === 'reading' ? readingLine(piece) : null;
  const status = unreadable ? null : pieceStatus({ lastTake, insight });

  return (
    <PressableScale
      onPress={onPress}
      onPressIn={onPressIn}
      accessibilityRole="button"
      // The composer and the date are no longer drawn — the redesign's tile is
      // the page, the title and the rail — but they are still worth hearing.
      // What the page says is part of it too: the reading's step, or that it
      // could not be read. The label replaces the tile's own text, so a line
      // drawn on the page and left out of here was a line nobody heard.
      accessibilityLabel={[piece.title, meta, message ?? reading ?? status]
        .filter(Boolean)
        .join(', ')}
      activeScale={0.98}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      {/*
        The page. **Whole systems, never a scaled one**: a system is as tall as
        its notes reach, and squashing one into a fixed box is the thing an
        engraving must never do. `paginateSystems` fills the page with as many
        as fit and stops, so what is left at the bottom is margin rather than a
        row of beamed notes with their heads cut off.
      */}
      <View style={styles.page} onLayout={measurePage}>
        {state.kind === 'engraved' && pageHeight > 0 && piece.score ? (
          <View style={styles.music}>
            <ScoreBand
              score={piece.score}
              scale={TILE_SCALE}
              plain
              // The music area, not the card: the padding above and below it is
              // the page's margin and is not for systems to sit in.
              viewport={Math.max(1, pageHeight - MUSIC_PADDING * 2)}
              // One tile a frame, top of the shelf first, rather than the whole
              // shelf in one block before any of it is drawn.
              queued
            />
          </View>
        ) : null}
        {/* A page being read: its staves, waiting for their notes. */}
        {reading !== null ? <ReadingPage line={reading} /> : null}
        {/*
          On the page rather than under the title, because it is a statement
          about the page: this is what would have been engraved here. Set in
          the metadata face so it recedes beside a tile that does have music —
          the shelf should still read as music first.
        */}
        {message ? (
          <View style={styles.message}>
            {/*
              **The failure reads one step louder than the progress note**, and
              that is the whole difference between them from three feet: one
              wants a tap and the other wants nothing. Measured on the shelf
              rather than argued — at `textTertiary` both were equally faint,
              and the tile that needed something looked like the tile that did
              not.
            */}
            <Text
              variant="metadataSmall"
              color={unreadable ? 'textSecondary' : 'textTertiary'}
              numberOfLines={2}
            >
              {message}
            </Text>
          </View>
        ) : null}
      </View>

      {/*
        The serif, like every other title in the app, and two lines because a
        tile is narrow — which is the shelf's own finding: a long repertoire
        title gets two narrow lines here rather than one wide one.

        **The name, broken before its key** (`PieceHeading`): the whole title
        set as plain text broke "Caprice No. 24 in A / minor, Op. 1". The
        catalogue number goes, as it does on the Continue band: on a shelf the
        engraving and the name tell pieces apart, and the piece's own screen
        prints the number under its title.
      */}
      <PieceHeading
        title={piece.title}
        variant="pieceTitle"
        numberOfLines={2}
        catalogue="hidden"
        // Its size here, not the token's: the line breaks are worked out
        // from the size the name is actually set at.
        style={styles.title}
        containerStyle={styles.titleBox}
      />
      {/*
        **How it last went, in the result screen's words** (the owner,
        2026-09-29, "words only"): "Rushed in the middle", where there is a
        reading to say it from. It replaced a verdict word
        over a slider bar ("Slight drag"), the old vocabulary. No date: the
        shelf is already grouped by when.
      */}
      {status ? (
        <Text variant="metadataSmall" color="textSecondary" numberOfLines={1} style={styles.status} accessible={false}>
          {status}
        </Text>
      ) : null}

      {/*
        **Typography, not two more buttons.** §3 law 6 reaches for type before
        containers, and a shelf two tiles across has no room for a pair of
        pills under every failed scan. The re-read leads: the photograph is
        usually fine and the reading is what failed, which is the same order
        `PieceScoreScreen` settled on.
      */}
      {unreadable && (onReadAgain || onDiscard) ? (
        <View style={styles.actions}>
          {state.canReadAgain && onReadAgain ? (
            <TextAction
              label={READ_AGAIN_LABEL}
              size="small"
              onPress={onReadAgain}
              disabled={busy}
              accessibilityLabel={`Read ${piece.title} again`}
            />
          ) : null}
          {onDiscard ? (
            <TextAction
              label={DISCARD_LABEL}
              size="small"
              onPress={onDiscard}
              disabled={busy}
              accessibilityLabel={`Discard ${piece.title}`}
            />
          ) : null}
        </View>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minWidth: 0,
  },
  pressed: {
    opacity: 0.8,
  },
  page: {
    width: '100%',
    aspectRatio: PAGE_ASPECT,
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    overflow: 'hidden',
    // Centred: a short piece is two systems in the middle of a page, as
    // engraved music is, not two systems at the top of a blank one.
    justifyContent: 'center',
  },
  music: {
    paddingVertical: MUSIC_PADDING,
    paddingHorizontal: spacing.md,
  },
  message: {
    // The whole page, so the line sits where the music would have been rather
    // than at the top of an empty box.
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    // **Wraps, because a tile is half a phone wide and type scales.** At the
    // 2x text size the accessibility audit runs at, "Discard" ran 35pt off the
    // right edge of the tile on one line — found by `audit-a11y`, which CI has
    // not been able to run since the Actions minutes ran out. One line at
    // ordinary sizes, two when the type is large enough to need them.
    flexWrap: 'wrap',
    columnGap: spacing.md,
  },
  // The shelf's serif, a size under `pieceTitle`: a tile is half a screen
  // wide and a repertoire title gets two narrow lines here.
  titleBox: {
    marginTop: spacing.md,
  },
  title: {
    fontSize: 17,
    lineHeight: 21,
  },
  // Pinned to the bottom of the tile, so the rails of two tiles side by side
  // line up whether their titles took one line or two.
  status: {
    marginTop: spacing.xs,
  },
});

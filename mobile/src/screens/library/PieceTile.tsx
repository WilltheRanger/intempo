import { useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { PressableScale } from '../../components/motion';
import { Text } from '../../components/primitives/Text';
import { ScoreBand } from '../../components/score/ScoreBand';
import type { Piece } from '../../data/types';
import { BORDER_WIDTH, MIN_TOUCH_TARGET, colors, radii, spacing } from '../../design';
import { formatLastPracticedShort, joinMetadata } from '../../lib/format';
import {
  DISCARD_LABEL,
  READ_AGAIN_LABEL,
  tileMessage,
  tileState,
} from '../../lib/library/tileState';

/** Small enough that a tile is a spine, large enough that the notes are notes. */
const TILE_SCALE = 0.62;

/** Close to a page, without claiming to be one: a shelf of upright objects. */
const PAGE_ASPECT = 3 / 4;

/** The page's own margin, above the first system and below the last. */
const MUSIC_PADDING = spacing.sm;

export interface PieceTileProps {
  piece: Piece;
  onPress: () => void;
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
  onPress,
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

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={meta ? `${piece.title}, ${meta}` : piece.title}
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
            />
          </View>
        ) : null}
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
      */}
      <Text variant="pieceTitle" numberOfLines={2} style={styles.title}>
        {piece.title}
      </Text>
      {meta ? (
        <Text
          variant="metadataSmall"
          color="textTertiary"
          numberOfLines={1}
          style={styles.meta}
        >
          {meta}
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
            <Pressable
              onPress={onReadAgain}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy, busy }}
              accessibilityLabel={`Read ${piece.title} again`}
              style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
            >
              <Text
                variant="sectionAction"
                color={busy ? 'textTertiary' : 'textPrimary'}
              >
                {READ_AGAIN_LABEL}
              </Text>
            </Pressable>
          ) : null}
          {onDiscard ? (
            <Pressable
              onPress={onDiscard}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              accessibilityLabel={`Discard ${piece.title}`}
              style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
            >
              <Text variant="sectionAction" color="textTertiary">
                {DISCARD_LABEL}
              </Text>
            </Pressable>
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
    justifyContent: 'flex-start',
  },
  music: {
    paddingVertical: MUSIC_PADDING,
    paddingHorizontal: spacing.sm,
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
    gap: spacing.md,
  },
  action: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  actionPressed: {
    opacity: 0.6,
  },
  title: {
    marginTop: spacing.sm,
  },
  meta: {
    marginTop: 2,
  },
});

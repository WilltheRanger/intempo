import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { PressableScale } from '../../components/motion';
import { Text } from '../../components/primitives/Text';
import { ScoreBand } from '../../components/score/ScoreBand';
import type { Piece } from '../../data/types';
import { BORDER_WIDTH, colors, radii, spacing } from '../../design';
import { formatLastPracticedShort, joinMetadata } from '../../lib/format';

/** Small enough that a tile is a spine, large enough that the notes are notes. */
const TILE_SCALE = 0.62;

/** Close to a page, without claiming to be one: a shelf of upright objects. */
const PAGE_ASPECT = 3 / 4;

/** The page's own margin, above the first system and below the last. */
const MUSIC_PADDING = spacing.sm;

export interface PieceTileProps {
  piece: Piece;
  onPress: () => void;
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
export function PieceTile({ piece, onPress }: PieceTileProps) {
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
        {piece.score && pageHeight > 0 ? (
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
  title: {
    marginTop: spacing.sm,
  },
  meta: {
    marginTop: 2,
  },
});

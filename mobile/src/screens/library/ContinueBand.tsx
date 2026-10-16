import type { ReactNode } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { PressableScale } from '../../components/motion';
import { KeyBand, type KeyBandScrim } from '../../components/pieces/KeyBand';
import { PrimaryButton } from '../../components/primitives/PrimaryButton';
import { SCREEN_GUTTER } from '../../components/primitives/ScreenContainer';
import { Text } from '../../components/primitives/Text';
import { spacing } from '../../design';
import type { ContinueLine } from '../../lib/library/continueLine';

/**
 * Inside a grand piano: the strings, and a brace crossing them
 * (`assets/hero/SOURCES.md`).
 */
const PHOTO = require('../../../assets/hero/library-strings.jpg');

/**
 * The band deepening behind the words: clear behind the header, then closing
 * over the photograph by the headline, so the headline and its small label sit
 * on colour rather than on strings.
 */
const SCRIM: KeyBandScrim = [
  [0, 0.15],
  [0.28, 0],
  [0.45, 0.45],
  [0.7, 0.8],
  [0.97, 1],
];

/**
 * The room the photograph gets between the header and the headline. Without
 * it the band is a coloured header with a title under it, and the picture is
 * a texture nobody sees.
 */
const PHOTO_WINDOW = 112;

export interface ContinueBandProps {
  /** The key the band takes its colour from. */
  keySignature: string | null | undefined;
  /** The screen's header — title, search and add — set in ivory on the band. */
  header: ReactNode;
  /**
   * The piece to play next. Null while searching: the band stays, as the
   * header's ground, and the headline steps out of the way of the results.
   */
  line: ContinueLine | null;
  /** The headline is a way into the piece, like a tile. */
  onOpen: () => void;
  /** The button: a take, or the piece where there is nothing to record against. */
  onAction: () => void;
  /** The page's scroll offset, which the photograph moves at half of. */
  scrollY: Animated.Value;
}

/**
 * The top of the Library: the piece to play next, set large on a band whose
 * colour is that piece's key, with a photograph printed into it (the owner's
 * pick, B2, 2026-10-16). The band itself is `KeyBand`, shared with the head of
 * the piece screen, so opening a piece carries its colour onto the next screen.
 *
 * **One dominant focal point** (§3 law 4): the headline. The band is the
 * loudest thing on the screen and everything in it serves the headline — the
 * photograph is darkened into the colour, and the scrim closes over it before
 * the words begin. The shelf below stays ivory and quiet.
 *
 * **The status line is not here.** "Rushed in the middle" sat under the title
 * in the ruled row this replaced; the owner took it out of the headline. It is
 * still in the label a screen reader hears, and still under each tile.
 */
export function ContinueBand({
  keySignature,
  header,
  line,
  onOpen,
  onAction,
  scrollY,
}: ContinueBandProps) {
  return (
    <KeyBand keySignature={keySignature} photo={PHOTO} scrim={SCRIM} scrollY={scrollY}>
      <View style={[styles.content, line ? styles.withLine : null]}>
        {header}
        {line ? (
          <View style={styles.continue}>
            <PressableScale
              onPress={onOpen}
              accessibilityRole="button"
              accessibilityLabel={['Continue', line.title, line.detail].filter(Boolean).join('. ')}
              accessibilityHint="Opens the piece"
              activeScale={0.99}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Text variant="sectionLabel" color="onDarkSecondary">
                Continue
              </Text>
              <Text variant="displayTitle" color="onDark" numberOfLines={3} style={styles.title}>
                {line.title}
              </Text>
            </PressableScale>
            <PrimaryButton
              label={line.actionLabel}
              onPress={onAction}
              tone="light"
              style={styles.action}
            />
          </View>
        ) : null}
      </View>
    </KeyBand>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: SCREEN_GUTTER,
    paddingBottom: spacing.md,
  },
  withLine: {
    paddingBottom: spacing['2xl'],
  },
  continue: {
    marginTop: PHOTO_WINDOW,
  },
  title: {
    marginTop: spacing.xs,
  },
  action: {
    marginTop: spacing.xl,
    alignSelf: 'flex-start',
  },
  pressed: {
    opacity: 0.7,
  },
});

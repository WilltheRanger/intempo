import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { Plus } from '../../components/icons';
import { IconButton } from '../../components/primitives/IconButton';
import { PrimaryButton } from '../../components/primitives/PrimaryButton';
import { Text } from '../../components/primitives/Text';
import { SCREEN_GUTTER } from '../../components/primitives/ScreenContainer';
import { PressableScale } from '../../components/motion';
import { useTabBarHeight } from '../../navigation/tabBarMetrics';
import { EASE_OUT, colors, motion, spacing } from '../../design';
import { useReducedMotion } from '../../lib/useReducedMotion';
import type { HeroContent, PendingLine } from './heroContent';
import { FALL_START, fallStops } from './heroFall';
import { TrailingChevron } from '../../components/primitives/TrailingChevron';

/**
 * Today, light (`redesign/TodayLight.dc.html`): a rehearsal-room photograph
 * across the top of the screen that falls away into the ivory page, with the
 * greeting written on the photograph and the next thing to practise written on
 * the ivory below it.
 *
 * It replaces a dark hero — a piano photograph under a black wash with every
 * line in ivory. The light version keeps the photograph as the picture it is
 * rather than as a dark ground for type, and puts the copy on the page, where
 * it reads in the app's own ink.
 *
 * ## Where the type may go
 *
 * Two grounds, and every line belongs to one of them:
 *
 *  - **The greeting and the "+" are ivory on the photograph**, in the top
 *    195pt, where a light ink scrim (`TOP_SCRIM`) settles the brightest part
 *    of the room behind them.
 *  - **Everything else is ink on the ivory fall.** The fall follows the copy
 *    rather than a fixed height (`heroFall.ts`): the prototype's sample is a
 *    one-line title with nothing under it, and a real piece is a two- or
 *    three-line title and its composer — which, against a fixed 47%, put the
 *    label and the title on the photograph. So the copy block is measured and
 *    the fall is moved up until it has settled by the block's first line.
 *
 * The fall is `colors.bg` at rising opacity, not a decorative gradient: take it
 * away and the title is ink on a dark photograph. That is the §3 law 6 test —
 * removing an ornament changes nothing, removing this breaks the screen.
 *
 * Three-foot test: the title, then the button, then the greeting.
 */

/**
 * The ink scrim behind the greeting: 31% at the top edge, gone by 195pt. The
 * prototype's `topScrim` and `scrimDepth`, and its four stops.
 */
const SCRIM_DEPTH = 195;
const TOP_SCRIM: ReadonlyArray<readonly [offset: number, opacity: number]> = [
  [0, 0.31],
  [0.359, 0.264],
  [0.677, 0.155],
  [1, 0],
];

/**
 * **The rehearsal room**, from the redesign handoff (`Image unsplash.png`).
 * Unsplash; the handoff did not record the photographer — see
 * `assets/hero/SOURCES.md` and `AcknowledgementsScreen`.
 */
const HERO_PHOTO = require('../../../assets/hero/today-hero.jpg');

export interface PracticeHeroProps {
  /**
   * What to write on the page, or null while the piece is still coming.
   *
   * Null draws the photograph and the fall and nothing else, so the screen
   * does not jump when the answer arrives.
   */
  content: HeroContent | null;
  /** The greeting line. "Good morning", from `getGreeting`. */
  greeting: string;
  /** Whose morning it is, when the account has said. */
  name: string | null;
  onAction: () => void;
  onAdd: () => void;
  /** "Recent results": the Insights tab, where every take is. */
  onRecent: () => void;
  /**
   * The take this device handed over and nobody has read yet, if there is one.
   *
   * It takes the "Recent results" line's place rather than adding a third
   * thing under the button: a take waiting to be read *is* the recent result,
   * and the one a musician wants. `pendingLineFor` decides what it says;
   * `onPending` opens it, or asks again.
   */
  pending?: PendingLine | null;
  onPending?: () => void;
}

/**
 * How much of Today is dark ground: the photograph above the fall.
 *
 * `TodayScreen` hands this to `ScreenContainer` as `darkGround`, which is what
 * tells the floating chrome which material to wear. The bar sits on the ivory
 * at the bottom, below this line, so it wears the light one — which is the
 * answer now that the page, not the photograph, reaches the bottom edge.
 */
export function useHeroHeight(): number {
  return Math.round(useWindowDimensions().height * FALL_START);
}

export function PracticeHero({
  content,
  greeting,
  name,
  onAction,
  onAdd,
  onRecent,
  pending = null,
  onPending,
}: PracticeHeroProps) {
  // The tab bar floats over this, so the copy has to end above it — a primary
  // action half behind the furniture is the thumb zone (§3 law 7) taken away
  // by the thing that is supposed to be out of the way.
  const tabBar = useTabBarHeight();
  const insets = useSafeAreaInsets();

  // The hero's height and where its copy starts, both in hero points: what
  // the fall is placed from. Zero until measured, which `fallStops` answers
  // with the prototype's own curve.
  const [height, setHeight] = useState(0);
  const [bottomY, setBottomY] = useState(0);
  const [blockY, setBlockY] = useState(0);
  const copyTop = height > 0 && content !== null ? bottomY + blockY : null;
  const measure = (set: (value: number) => void, key: 'y' | 'height') => (event: LayoutChangeEvent) => {
    const value = Math.round(event.nativeEvent.layout[key]);
    set(value);
  };

  /*
    **The copy arrives; it does not cut in.** When the piece is still coming
    the hero is the photograph alone, and the title and the Practice button
    used to appear in a single frame when it landed — "just appear all of a
    sudden" (owner, 2026-09-23). A short fade and an 8pt settle, on the scene
    timing, so it reads as arriving rather than as a layout jump. Copy that is
    there on the first render (a cached piece) does not animate at all.
  */
  const reduceMotion = useReducedMotion();
  const arrival = useRef(new Animated.Value(content === null ? 0 : 1)).current;
  const hasContent = content !== null;
  useEffect(() => {
    if (!hasContent) {
      return;
    }
    const animation = Animated.timing(arrival, {
      toValue: 1,
      duration: reduceMotion ? 0 : motion.push,
      easing: EASE_OUT,
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [arrival, hasContent, reduceMotion]);

  const recent =
    pending && onPending
      ? { label: pending.label, onPress: onPending }
      : { label: 'Recent results', onPress: onRecent };

  return (
    <View style={styles.hero} onLayout={measure(setHeight, 'height')}>
      <Image
        source={HERO_PHOTO}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        // The prototype's `object-position: 56% 40%`: the cello and the
        // stands, rather than the empty doorway, on a narrow phone.
        contentPosition={{ left: '56%', top: '40%' }}
        accessibilityIgnoresInvertColors
        pointerEvents="none"
      />
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
        <Defs>
          <LinearGradient id="today-fall" x1="0" y1="0" x2="0" y2="1">
            {fallStops(height, copyTop).map(([offset, opacity]) => (
              <Stop key={offset} offset={offset} stopColor={colors.bg} stopOpacity={opacity} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#today-fall)" />
      </Svg>
      <Svg
        style={[styles.scrim, { height: SCRIM_DEPTH + insets.top }]}
        width="100%"
        height={SCRIM_DEPTH + insets.top}
        pointerEvents="none"
      >
        <Defs>
          <LinearGradient id="today-scrim" x1="0" y1="0" x2="0" y2="1">
            {TOP_SCRIM.map(([offset, opacity]) => (
              <Stop key={offset} offset={offset} stopColor={colors.darkBg} stopOpacity={opacity} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#today-scrim)" />
      </Svg>

      <View
        style={[
          styles.content,
          // The copy ends 48pt above the bar's top edge, as the prototype's
          // does: close enough to the thumb, clear of the furniture.
          { paddingTop: insets.top + spacing.xl, paddingBottom: tabBar + spacing['3xl'] + spacing.lg },
        ]}
      >
        <View style={styles.topRow}>
          <View style={styles.greeting}>
            <Text variant="screenTitle" color="onDark">
              {greeting}
            </Text>
            {name ? (
              <Text variant="metadataSmall" color="onDark" style={styles.name}>
                {name}
              </Text>
            ) : null}
          </View>
          <IconButton
            icon={Plus}
            label="Add a piece"
            tone="onDark"
            variant="bare"
            onPress={onAdd}
            style={styles.add}
          />
        </View>

        <View style={styles.bottom} onLayout={measure(setBottomY, 'y')}>
          {content === null ? null : (
            <Animated.View
              onLayout={measure(setBlockY, 'y')}
              style={{
                opacity: arrival,
                transform: [
                  { translateY: arrival.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
                ],
              }}
            >
              <Text variant="eyebrow" color="textSecondary" style={styles.label}>
                {content.label}
              </Text>
              {/*
                Three lines and then an ellipsis. A long classical title wraps
                to two at 390pt and three at 320, and a fourth would push the
                button it belongs to under the tab bar.
              */}
              <Text variant="displayTitle" numberOfLines={3} style={styles.title}>
                {content.title}
              </Text>
              {content.meta ? (
                <Text variant="metadataSmall" color="textSecondary" style={styles.meta}>
                  {content.meta}
                </Text>
              ) : null}
              {content.detail ? (
                <Text variant="body" color="textSecondary" numberOfLines={2} style={styles.detail}>
                  {content.detail}
                </Text>
              ) : null}
              <PrimaryButton label={content.actionLabel} onPress={onAction} style={styles.action} />
              <PressableScale
                onPress={recent.onPress}
                accessibilityRole="button"
                accessibilityLabel={recent.label}
                activeScale={0.99}
                style={({ pressed }) => [styles.recent, pressed && styles.recentPressed]}
              >
                <Text variant="metadata" color="textSecondary" numberOfLines={1} style={styles.recentLabel}>
                  {recent.label}
                </Text>
                <TrailingChevron />
              </PressableScale>
            </Animated.View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    flex: 1,
    backgroundColor: colors.bg,
    overflow: 'hidden',
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  content: {
    flex: 1,
    paddingHorizontal: SCREEN_GUTTER,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  greeting: { flex: 1, minWidth: 0 },
  name: { marginTop: spacing.xs },
  // The glyph sits on the gutter line rather than the 44pt square's edge.
  add: { marginRight: -10 },
  bottom: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  label: { textTransform: 'uppercase' },
  title: {
    marginTop: 6,
    fontSize: 42,
    lineHeight: 46,
  },
  meta: { marginTop: 10 },
  detail: { marginTop: spacing.sm },
  action: {
    alignSelf: 'stretch',
    marginTop: 28,
  },
  // A row, not a caption: the whole 44pt strip is the target, and the chevron
  // says it opens something.
  recent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    marginTop: 14,
  },
  recentPressed: { opacity: 0.55 },
  recentLabel: { flex: 1 },
});

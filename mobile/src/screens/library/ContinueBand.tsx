import { useIsFocused } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { PressableScale } from '../../components/motion';
import { PrimaryButton } from '../../components/primitives/PrimaryButton';
import { SCREEN_GUTTER } from '../../components/primitives/ScreenContainer';
import { Text } from '../../components/primitives/Text';
import { spacing } from '../../design';
import type { ContinueLine } from '../../lib/library/continueLine';
import { keyBandFor } from '../../lib/library/keyBand';
import { useReducedMotion } from '../../lib/useReducedMotion';

/**
 * Inside a grand piano: the strings, and a brace crossing them
 * (`assets/hero/SOURCES.md`).
 */
const PHOTO = require('../../../assets/hero/library-strings.jpg');

/**
 * How strongly the photograph prints into the key's colour. Multiplied, so the
 * photograph can only darken the band: its highlights become the band's own
 * colour and its shadows go deeper, which is what keeps ivory type legible over
 * every part of it.
 */
const PHOTO_STRENGTH = 0.62;

/**
 * The band deepening behind the words: clear behind the header, then closing
 * over the photograph by the headline, so the headline and its small label sit
 * on colour rather than on strings. `[offset, opacity]` down the band.
 */
const SCRIM: readonly (readonly [number, number])[] = [
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

/**
 * How far the photograph drifts up and down, and how slowly.
 *
 * **A drift, not a zoom.** It was a slow zoom, and a photograph scaled past
 * its frame is wider than the screen: `audit-a11y` measured it 5pt off the
 * right edge, and the frame's clipping does not change what the layout says.
 * The photograph is drawn `SLACK` taller than the band at each end instead and
 * moves only vertically inside it, which reads the same and never leaves the
 * screen sideways.
 */
const DRIFT = { distance: 16, ms: 14000 } as const;
/** How far past the band's top and bottom edges the photograph is drawn. */
const SLACK = 24;

/** The web has no native driver, and asking for one there only warns. */
const NATIVE_DRIVER = Platform.OS !== 'web';

/**
 * Blend modes and isolation are styles React Native has had since 0.77 and the
 * web build passes straight to CSS; typed here once rather than at each use.
 */
const MULTIPLY = { mixBlendMode: 'multiply' } as ViewStyle;
const ISOLATE = { isolation: 'isolate' } as ViewStyle;

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
 * pick, B2, 2026-10-16).
 *
 * **One dominant focal point** (§3 law 4): the headline. The band is the
 * loudest thing on the screen and everything in it serves the headline — the
 * photograph is darkened into the colour, and the scrim closes over it before
 * the words begin. The shelf below stays ivory and quiet.
 *
 * **The status line is not here.** "Rushed in the middle" sat under the title
 * in the ruled row this replaced; the owner took it out of the headline. It is
 * still in the label a screen reader hears, and still under each tile.
 *
 * **It runs under the status bar.** The screen opts out of the top inset
 * (`ScreenContainer.underStatusBar`) and the band pays it back from the inside,
 * so the colour reaches the top edge and the words still clear the island.
 */
export function ContinueBand({
  keySignature,
  header,
  line,
  onOpen,
  onAction,
  scrollY,
}: ContinueBandProps) {
  const insets = useSafeAreaInsets();
  const band = keyBandFor(keySignature);
  const photoMotion = usePhotoMotion(scrollY);

  return (
    <View style={[styles.band, ISOLATE, { backgroundColor: band }]}>
      {/*
        The colour carried up past the top edge, so pulling the page down on
        iOS shows more band rather than a stripe of ivory above it.
      */}
      <View pointerEvents="none" style={[styles.overscroll, { backgroundColor: band }]} />

      {/*
        Decoration, hidden from a screen reader as a whole: the band says
        nothing the headline does not. `aria-hidden` rather than an unnamed
        image role, which the web announces as an image with no name.
      */}
      <View pointerEvents="none" style={styles.photoFrame} aria-hidden>
        <Animated.View style={[styles.photo, MULTIPLY, { transform: photoMotion }]}>
          <Image
            source={PHOTO}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
        </Animated.View>
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
          <Defs>
            <LinearGradient id="continueBandScrim" x1="0" y1="0" x2="0" y2="1">
              {SCRIM.map(([offset, opacity]) => (
                <Stop key={offset} offset={offset} stopColor={band} stopOpacity={opacity} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#continueBandScrim)" />
        </Svg>
      </View>

      <LightStatusBarWhileFocused />

      <View style={[styles.content, { paddingTop: insets.top }, line ? styles.withLine : null]}>
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
    </View>
  );
}

/**
 * The photograph moves at half the page's speed as it scrolls, and drifts up
 * and down very slowly while the Library is the screen in front.
 *
 * Both run on the native driver. The drift stops when the tab is left — tabs
 * stay mounted, and a loop nobody can see is a battery cost with nothing to
 * show — and does not run at all under Reduce Motion, where the photograph
 * sits still in the middle of its travel.
 */
function usePhotoMotion(scrollY: Animated.Value) {
  const reduced = useReducedMotion();
  const focused = useIsFocused();
  const drift = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    if (reduced || !focused) {
      return undefined;
    }
    const step = (toValue: number) =>
      Animated.timing(drift, {
        toValue,
        duration: DRIFT.ms,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: NATIVE_DRIVER,
      });
    const loop = Animated.loop(Animated.sequence([step(1), step(0)]));
    loop.start();
    return () => loop.stop();
  }, [drift, focused, reduced]);

  return [
    {
      // Clamped at the top: pulling the page down past its start holds the
      // photograph where it is instead of sliding it up out of the band.
      translateY: scrollY.interpolate({
        inputRange: [0, 1000],
        outputRange: [0, 500],
        extrapolateLeft: 'clamp',
      }),
    },
    {
      translateY: drift.interpolate({
        inputRange: [0, 1],
        outputRange: [-DRIFT.distance, DRIFT.distance],
      }),
    },
  ];
}

/**
 * The status bar sits on the band, so it is light while the Library is the
 * screen — and only then: tabs stay mounted, and a light status bar left behind
 * would vanish on the ivory of Insights and Profile. Its own component so a
 * change of tab redraws the status bar and nothing else (the reason Today's
 * hero had the same one).
 */
function LightStatusBarWhileFocused() {
  const focused = useIsFocused();
  return focused ? <StatusBar style="light" /> : null;
}

const styles = StyleSheet.create({
  band: {
    // Out to both edges of the screen and the reading measure, whichever is
    // narrower; the shelf below keeps its gutter.
    width: '100%',
  },
  overscroll: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '100%',
    height: 1000,
  },
  photoFrame: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
  photo: {
    position: 'absolute',
    top: -SLACK,
    right: 0,
    bottom: -SLACK,
    left: 0,
    opacity: PHOTO_STRENGTH,
  },
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

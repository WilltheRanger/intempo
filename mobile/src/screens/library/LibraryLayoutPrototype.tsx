/* PROTOTYPE — not for commit as the design. Three other layouts for the top of the Library. */
import { useContext, useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, useWindowDimensions, type ImageStyle } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Plus, Search } from '../../components/icons';
import { PressableScale } from '../../components/motion';
import { IconButton } from '../../components/primitives';
import { PrimaryButton } from '../../components/primitives/PrimaryButton';
import { SCREEN_GUTTER, ScreenScrollContext } from '../../components/primitives/ScreenContainer';
import { Text } from '../../components/primitives/Text';
import { ScoreBand } from '../../components/score/ScoreBand';
import type { Piece } from '../../data/types';
import { colors, spacing } from '../../design';
import type { ContinueLine } from '../../lib/library/continueLine';
import { accidentalCount } from '../../lib/notation/keySignature';
import { useReducedMotion } from '../../lib/useReducedMotion';
import { PALETTE } from './LibraryBackdropPrototype';

type LayoutVariant = 'glow' | 'key' | 'lining';

function readLayout(): LayoutVariant | null {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const name = new URLSearchParams(window.location.search).get('layout');
    if (name === 'glow' || name === 'key' || name === 'lining') return name;
  }
  return null;
}

export const LAYOUT_VARIANT = readLayout();

/**
 * A photograph behind the headline, chosen with `?photo=`.
 *
 * `score` and `strings` are the owner's two photographs. They are served from
 * the local preview only (`dist/prototype/`) and are **not in the repository**:
 * it is public, and their licences are not known yet. `own` is the Continue
 * piece's own photographed page, which the app already has.
 */
type Photo = 'score' | 'strings' | 'own';

function readPhoto(): Photo | null {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const name = new URLSearchParams(window.location.search).get('photo');
    if (name === 'score' || name === 'strings' || name === 'own') return name;
  }
  return null;
}

const PHOTO = readPhoto();
const PHOTO_URI: Record<'score' | 'strings', string> = {
  score: '/prototype/score.jpg',
  strings: '/prototype/strings.jpg',
};
/** The sample library's page is one strip of manuscript, eight times wider than tall. */
const STRIP_ASPECT = 1200 / 145;
const PAGE = '#F7F2E9';

/** Blend modes are a web style here, and this prototype only runs on the web. */
const MULTIPLY = { mixBlendMode: 'multiply' } as unknown as ImageStyle;

/** The lining layout's ground for the whole page: deep green, like the inside of a case. */
export const LINING_GROUND = '#1E3128';
export const LINED = LAYOUT_VARIANT === 'lining';

/**
 * A deep colour for each key, round the circle of fifths. Curated rather than
 * a rainbow, so every one carries ivory type at better than 7:1.
 */
const KEY_COLOURS: Record<number, string> = {
  [-7]: '#3A2440', [-6]: '#3A2440', [-5]: '#3A2440',
  [-4]: '#3F4220', [-3]: '#5A3418', [-2]: '#5B2427', [-1]: '#4A2639',
  0: '#22324A',
  1: '#1F3A2E', 2: '#1C3D40', 3: '#1D3550', 4: '#2A2D52',
  5: '#3B2A55', 6: '#3B2A55', 7: '#3B2A55',
};

function keyColour(keySignature: string | null | undefined): string {
  return KEY_COLOURS[accidentalCount(keySignature) ?? 0] ?? KEY_COLOURS[0];
}

/** The engraving behind the title drifts a little, and moves at half the page's speed. */
function useMusicMotion() {
  const scrollY = useContext(ScreenScrollContext);
  const reduced = useReducedMotion();
  const drift = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    if (reduced) return undefined;
    const step = (to: number) =>
      Animated.timing(drift, {
        toValue: to,
        duration: 9000,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: Platform.OS !== 'web',
      });
    const loop = Animated.loop(Animated.sequence([step(1), step(0)]));
    loop.start();
    return () => loop.stop();
  }, [drift, reduced]);
  const transform = [
    {
      translateY: scrollY
        ? scrollY.interpolate({ inputRange: [0, 1000], outputRange: [0, 500], extrapolate: 'extend' })
        : 0,
    },
    { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [-18, 18] }) },
    { rotate: '-4deg' },
  ];
  return transform;
}

/** A photograph moves at half the page's speed and breathes in very slowly. */
function usePhotoMotion() {
  const scrollY = useContext(ScreenScrollContext);
  const reduced = useReducedMotion();
  const zoom = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return undefined;
    const step = (to: number) =>
      Animated.timing(zoom, {
        toValue: to,
        duration: 14000,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: Platform.OS !== 'web',
      });
    const loop = Animated.loop(Animated.sequence([step(1), step(0)]));
    loop.start();
    return () => loop.stop();
  }, [zoom, reduced]);
  return [
    {
      translateY: scrollY
        ? scrollY.interpolate({ inputRange: [0, 1000], outputRange: [0, 500], extrapolate: 'extend' })
        : 0,
    },
    { scale: zoom.interpolate({ inputRange: [0, 1], outputRange: [1.02, 1.1] }) },
  ];
}

export function LibraryHero({
  variant,
  piece,
  line,
  onAdd,
  onOpen,
  onAction,
}: {
  variant: LayoutVariant;
  piece: Piece;
  line: ContinueLine;
  onAdd: () => void;
  onOpen: () => void;
  onAction: () => void;
}) {
  const { width } = useWindowDimensions();
  const musicMotion = useMusicMotion();
  const photoMotion = usePhotoMotion();
  const photo = PHOTO;
  const wide = photo === 'score' || photo === 'strings';
  const band = keyColour(piece.score?.key_signature);
  const photoHeight = variant === 'glow' ? 420 : 520;
  const dark = variant !== 'glow';
  const ink = dark ? 'onDark' : 'textPrimary';
  const quiet = dark ? 'onDarkSecondary' : 'textSecondary';

  return (
    <View
      style={[
        styles.hero,
        variant === 'key' ? { backgroundColor: band } : null,
      ]}
    >
      {wide ? (
        <View pointerEvents="none" style={[styles.photoFrame, { height: photoHeight }]}>
          <Animated.Image
            source={{ uri: PHOTO_URI[photo as 'score' | 'strings'] }}
            resizeMode="cover"
            style={[
              StyleSheet.absoluteFill,
              variant === 'key' ? MULTIPLY : null,
              variant === 'key' ? { opacity: 0.62 } : null,
              { transform: photoMotion },
            ]}
          />
          <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
            <Defs>
              <LinearGradient id="photoFade" x1="0" y1="0" x2="0" y2="1">
                {/*
                  Clear behind the header, gone by the headline: the title and
                  its small "Continue" label sit on the page, not on the photo.
                */}
                {(variant === 'key'
                  ? [[0, 0.15], [0.28, 0], [0.45, 0.45], [0.7, 0.8], [0.97, 1]]
                  : [[0, 0.12], [0.2, 0], [0.5, 0.72], [0.68, 0.95], [0.8, 1]]
                ).map(([offset, opacity]) => (
                  <Stop
                    key={offset}
                    offset={offset}
                    stopColor={variant === 'key' ? band : PAGE}
                    stopOpacity={opacity}
                  />
                ))}
              </LinearGradient>
            </Defs>
            {variant === 'glow' && photo === 'score' ? (
              // The score photograph is grey; a wash of brass puts it in the room.
              <Rect x="0" y="0" width="100%" height="100%" fill={PALETTE.HONEY} fillOpacity={0.22} />
            ) : null}
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#photoFade)" />
          </Svg>
        </View>
      ) : null}

      {variant === 'glow' && !wide ? (
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
          <Defs>
            <RadialGradient id="heroWarm" cx="90%" cy="5%" rx="120%" ry="95%" fx="90%" fy="5%">
              <Stop offset="0" stopColor={PALETTE.AMBER} stopOpacity={0.85} />
              <Stop offset="0.5" stopColor={PALETTE.HONEY} stopOpacity={0.5} />
              <Stop offset="1" stopColor="#F7F2E9" stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="heroSide" cx="0%" cy="55%" rx="70%" ry="55%" fx="0%" fy="55%">
              <Stop offset="0" stopColor={PALETTE.ROSE} stopOpacity={0.55} />
              <Stop offset="1" stopColor="#F7F2E9" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroWarm)" />
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroSide)" />
        </Svg>
      ) : null}

      {photo === 'own' && piece.thumbnail ? (
        // The piece's own page, bled off the edges: here, Bach's manuscript.
        <Animated.Image
          source={piece.thumbnail as never}
          resizeMode="cover"
          style={[
            styles.music,
            MULTIPLY,
            {
              width: width * 2,
              height: (width * 2) / STRIP_ASPECT,
              left: -width * 0.35,
              opacity: variant === 'glow' ? 0.7 : 0.8,
              transform: musicMotion,
            },
          ]}
        />
      ) : null}

      {!photo && piece.score ? (
        // The piece itself, bled off the edges: its opening, engraved large.
        <Animated.View
          pointerEvents="none"
          style={[
            styles.music,
            {
              width: width * 1.5,
              opacity: variant === 'glow' ? 0.22 : variant === 'key' ? 0.16 : 0.26,
              transform: musicMotion,
            },
          ]}
        >
          <ScoreBand
            score={piece.score}
            scale={2.1}
            plain
            tint={variant === 'glow' ? PALETTE.GOLD : variant === 'key' ? colors.onDark : colors.accentOnDark}
          />
        </Animated.View>
      ) : null}

      <View style={styles.titleRow}>
        <Text variant="screenTitle" color={ink} style={styles.flex}>
          Library
        </Text>
        <IconButton icon={Search} label="Search your library" variant="bare" tone={dark ? 'onDark' : 'auto'} onPress={() => {}} />
        <IconButton icon={Plus} label="Add piece" variant="bare" tone={dark ? 'onDark' : 'auto'} onPress={onAdd} />
      </View>

      <View style={styles.continue}>
        <PressableScale onPress={onOpen} accessibilityRole="button" activeScale={0.99}>
          <Text variant="sectionLabel" color={dark ? 'onDarkMuted' : 'textSecondary'}>
            Continue
          </Text>
          <Text variant="displayTitle" color={ink} numberOfLines={3} style={styles.title}>
            {line.title}
          </Text>
          {line.detail ? (
            <Text variant="metadata" color={quiet} numberOfLines={1} style={styles.detail}>
              {line.detail}
            </Text>
          ) : null}
        </PressableScale>
        <PrimaryButton
          label={line.actionLabel}
          onPress={onAction}
          tone={dark ? 'light' : 'ink'}
          style={styles.button}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    paddingHorizontal: SCREEN_GUTTER,
    paddingTop: spacing.lg,
    paddingBottom: spacing['2xl'],
    overflow: 'hidden',
    minHeight: 470,
    justifyContent: 'space-between',
  },
  music: {
    position: 'absolute',
    top: 72,
    left: -60,
  },
  photoFrame: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  flex: { flex: 1 },
  continue: {
    marginTop: spacing['2xl'],
  },
  title: {
    marginTop: spacing.xs,
  },
  detail: {
    marginTop: spacing.sm,
  },
  button: {
    marginTop: spacing.xl,
    alignSelf: 'flex-start',
  },
});

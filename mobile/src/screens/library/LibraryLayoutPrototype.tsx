/* PROTOTYPE — not for commit as the design. Three other layouts for the top of the Library. */
import { useContext, useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

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
  const dark = variant !== 'glow';
  const ink = dark ? 'onDark' : 'textPrimary';
  const quiet = dark ? 'onDarkSecondary' : 'textSecondary';

  return (
    <View
      style={[
        styles.hero,
        variant === 'key' ? { backgroundColor: keyColour(piece.score?.key_signature) } : null,
      ]}
    >
      {variant === 'glow' ? (
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

      {piece.score ? (
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

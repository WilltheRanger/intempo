import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import Svg, {
  Defs,
  Ellipse,
  G,
  Line,
  LinearGradient,
  Path,
  Polygon,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import { Text } from '../../components/primitives';
import { colors, fontFamily } from '../../design';
import { useReducedMotion } from '../../lib/useReducedMotion';
import { WELCOME_STAVES } from './welcomePage';

const PAGE_WIDTH = 220;
const PAGE_HEIGHT = 290;
const STAFF_LEFT = 22;
const STAFF_WIDTH = 176;
const LINE_GAP = 4.4;

/** One pass of the whole loop. */
const LOOP_MS = 4200;

const USE_NATIVE = Platform.OS !== 'web';

/**
 * Two inks for one page: grey as it was photographed, black once it is read.
 * The tempo marking goes gold when it is read, because the tempo is what the
 * app went looking for.
 */
const PHOTO_INK = {
  staff: colors.photoRule,
  ink: colors.photoInk,
  title: colors.photoInk,
  composer: colors.photoRule,
  tempo: colors.photoInk,
};

const READ_INK = {
  staff: colors.textSecondary,
  ink: colors.textPrimary,
  title: colors.textPrimary,
  composer: colors.textSecondary,
  tempo: colors.accent,
};

type Ink = typeof PHOTO_INK;

/**
 * The Welcome screen's picture of what the app does
 * (`redesign/OnboardWelcome.dc.html`): a photographed page sits grey and a
 * little crooked inside a loose frame, straightens, is read top to bottom
 * into clean notation, and once it is read the frame snaps tight and the tempo
 * it found pops up beside it. Then it eases back and goes again.
 *
 * **At rest it is the finished picture** — straight, read, tempo shown — and
 * that is what Reduce Motion gets. Every keyframe below says where a part comes
 * from, never where it lives, so nothing depends on the loop to be seen.
 *
 * One clock drives every part, each reading its own keyframes off it with its
 * own easing, as the prototype's six CSS animations did off one duration. The
 * reveal is two opposite translations rather than a changing height, so the
 * whole thing runs on the native driver.
 */
export function ScanIllustration() {
  const reduceMotion = useReducedMotion();
  const clock = useRef(new Animated.Value(reduceMotion ? REST : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      clock.setValue(REST);
      return;
    }
    clock.setValue(0);
    const loop = Animated.loop(
      Animated.timing(clock, {
        toValue: 1,
        duration: LOOP_MS,
        easing: Easing.linear,
        useNativeDriver: USE_NATIVE,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [clock, reduceMotion]);

  const frameEase = Easing.bezier(0.2, 0.7, 0.3, 1);
  const pageEase = Easing.bezier(0.3, 0.6, 0.2, 1);
  const foundEase = Easing.bezier(0.2, 0.8, 0.3, 1.2);

  const frame = {
    opacity: clock.interpolate({
      inputRange: [0, 0.6, 0.65, 0.7, 0.88, 1],
      outputRange: [0.45, 0.45, 1, 1, 1, 0.45],
      easing: frameEase,
    }),
    transform: [
      {
        scale: clock.interpolate({
          inputRange: [0, 0.6, 0.65, 0.7, 0.88, 1],
          outputRange: [1.05, 1.05, 0.97, 1, 1, 1.05],
          easing: frameEase,
        }),
      },
    ],
  };

  const page = {
    transform: [
      {
        rotate: clock.interpolate({
          inputRange: [0, 0.06, 0.2, 0.88, 1],
          outputRange: ['-3.5deg', '-3.5deg', '0deg', '0deg', '-3.5deg'],
          easing: pageEase,
        }),
      },
      {
        scale: clock.interpolate({
          inputRange: [0, 0.6, 0.65, 0.71, 1],
          outputRange: [1, 1, 1.035, 1, 1],
          easing: pageEase,
        }),
      },
    ],
  };

  /** How far down the page has been read, 0 to its full height. */
  const readTo = clock.interpolate({
    inputRange: [0, 0.18, 0.6, 1],
    outputRange: [0, 0, PAGE_HEIGHT, PAGE_HEIGHT],
  });
  const read = {
    opacity: clock.interpolate({ inputRange: [0, 0.88, 1], outputRange: [1, 1, 0] }),
    transform: [{ translateY: Animated.subtract(readTo, PAGE_HEIGHT) }],
  };
  const readInner = {
    transform: [{ translateY: Animated.subtract(PAGE_HEIGHT, readTo) }],
  };

  const scan = {
    opacity: clock.interpolate({
      inputRange: [0, 0.18, 0.2, 0.58, 0.6, 1],
      outputRange: [0, 0, 1, 1, 0, 0],
    }),
    transform: [
      {
        translateY: clock.interpolate({
          inputRange: [0, 0.18, 0.6, 1],
          outputRange: [0, 0, PAGE_HEIGHT - 2, PAGE_HEIGHT - 2],
        }),
      },
    ],
  };

  const found = {
    opacity: clock.interpolate({
      inputRange: [0, 0.62, 0.68, 0.88, 0.96, 1],
      outputRange: [0, 0, 1, 1, 0, 0],
      easing: foundEase,
    }),
    transform: [
      {
        scale: clock.interpolate({
          inputRange: [0, 0.62, 0.68, 0.73, 0.88, 0.96, 1],
          outputRange: [0.5, 0.5, 1.08, 1, 1, 0.9, 0.9],
          easing: foundEase,
        }),
      },
    ],
  };

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="A photographed page of music being straightened and read, its tempo marking picked out in gold"
      style={styles.stage}
    >
      <Animated.View style={[styles.frame, frame]}>
        <View style={[styles.corner, styles.topLeft]} />
        <View style={[styles.corner, styles.topRight]} />
        <View style={[styles.corner, styles.bottomLeft]} />
        <View style={[styles.corner, styles.bottomRight]} />
      </Animated.View>

      <Animated.View style={[styles.page, page]}>
        <Page ink={PHOTO_INK} />
        <Animated.View style={[styles.reveal, read]}>
          <Animated.View style={readInner}>
            <Page ink={READ_INK} />
          </Animated.View>
        </Animated.View>
        <Animated.View style={[styles.scan, scan]} pointerEvents="none">
          <View style={styles.scanLine} />
          {/* The light the line leaves behind it as it passes. */}
          <Svg width="100%" height={18}>
            <Defs>
              <LinearGradient id="scanWake" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.accent} stopOpacity={0.2} />
                <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect x={0} y={0} width="100%" height={18} fill="url(#scanWake)" />
          </Svg>
        </Animated.View>
      </Animated.View>

      <Animated.View style={[styles.found, found]}>
        <Text style={styles.foundNote}>♩</Text>
        <Text style={styles.foundTempo}>= 76</Text>
      </Animated.View>
    </View>
  );
}

/** Where the clock stands for Reduce Motion: straight, read, tempo showing. */
const REST = 0.8;

/** The page itself, in one of its two inks. */
function Page({ ink }: { ink: Ink }) {
  return (
    <Svg width={PAGE_WIDTH} height={PAGE_HEIGHT} viewBox={`0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}`}>
      <Rect
        x={0.5}
        y={0.5}
        width={PAGE_WIDTH - 1}
        height={PAGE_HEIGHT - 1}
        rx={3}
        fill={colors.paper}
        stroke={colors.border}
      />
      <SvgText
        x={110}
        y={26}
        fontFamily={fontFamily.serifMedium}
        fontSize={12}
        fill={ink.title}
        textAnchor="middle"
      >
        Elegy
      </SvgText>
      <SvgText
        x={110}
        y={37}
        fontFamily={fontFamily.serifRegular}
        fontSize={7}
        fill={ink.composer}
        textAnchor="middle"
      >
        G. Bottesini
      </SvgText>
      <SvgText
        x={22}
        y={50}
        fontFamily={fontFamily.serifRegular}
        fontStyle="italic"
        fontSize={8}
        fill={ink.tempo}
      >
        Adagio  ♩ = 76
      </SvgText>
      {WELCOME_STAVES.map((staff, index) => (
        <G key={staff.y} transform={`translate(${STAFF_LEFT} ${staff.y})`}>
          <G stroke={ink.staff} strokeWidth={0.9} opacity={0.85}>
            {[0, 1, 2, 3, 4].map((line) => (
              <Line key={line} x1={0} y1={line * LINE_GAP} x2={STAFF_WIDTH} y2={line * LINE_GAP} />
            ))}
          </G>
          {index === 0 ? <Opening ink={ink} /> : null}
          {staff.ledgers.map(([from, to, y]) => (
            <Line key={`l${from}`} x1={from} y1={y} x2={to} y2={y} stroke={ink.staff} strokeWidth={0.9} />
          ))}
          {staff.notes.map(([x, y, filled]) => (
            <Ellipse
              key={`n${x}`}
              cx={x}
              cy={y}
              rx={2.9}
              ry={2.07}
              transform={`rotate(-21 ${x} ${y})`}
              fill={filled ? ink.ink : 'none'}
              stroke={filled ? undefined : ink.ink}
              strokeWidth={filled ? undefined : 0.84}
            />
          ))}
          {staff.stems.map(([x, from, to]) => (
            <Line
              key={`s${x}`}
              x1={x}
              y1={from}
              x2={x}
              y2={to}
              stroke={ink.ink}
              strokeWidth={0.75}
              strokeLinecap="round"
            />
          ))}
          {staff.beams.map((corners) => (
            <Polygon key={`b${corners[0]}`} points={corners.join(' ')} fill={ink.ink} />
          ))}
          {staff.bars.map((x) => (
            <Line key={`r${x}`} x1={x} y1={0} x2={x} y2={4 * LINE_GAP} stroke={ink.staff} strokeWidth={0.9} />
          ))}
          <Line x1={175} y1={0} x2={175} y2={4 * LINE_GAP} stroke={ink.staff} strokeWidth={1.6} />
        </G>
      ))}
    </Svg>
  );
}

/** The treble clef and the common-time signature on the first staff. */
function Opening({ ink }: { ink: Ink }) {
  return (
    <>
      <G fill="none" stroke={ink.ink} strokeWidth={1.06} strokeLinecap="round">
        <Path d="M 16.37 -3.77 C 12.60 -0.63 11.03 4.40 12.29 8.49 C 13.29 11.82 15.74 14.46 16.56 17.60 C 17.44 20.99 15.55 23.51 13.04 22.88 C 11.28 22.44 10.78 20.11 12.16 19.23" />
        <Path d="M 16.37 -3.77 C 19.51 -1.26 20.14 3.77 17.00 7.23 C 14.49 10.06 10.71 11.00 10.15 13.70 C 9.71 16.09 11.78 17.98 14.05 17.10 C 15.93 16.34 16.43 14.08 15.30 12.57" />
      </G>
      {[8.6, 17.4].map((y) => (
        <SvgText
          key={y}
          x={24.9}
          y={y}
          fontFamily={fontFamily.serifMedium}
          fontSize={9}
          fill={ink.ink}
          textAnchor="middle"
        >
          4
        </SvgText>
      ))}
    </>
  );
}

const CORNER = 24;
const FRAME_OUTSET = 14;

const styles = StyleSheet.create({
  stage: {
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
  },
  frame: {
    position: 'absolute',
    left: -FRAME_OUTSET,
    right: -FRAME_OUTSET,
    top: -FRAME_OUTSET,
    bottom: -FRAME_OUTSET,
  },
  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
    borderColor: colors.textPrimary,
  },
  topLeft: { left: 0, top: 0, borderTopWidth: 2, borderLeftWidth: 2 },
  topRight: { right: 0, top: 0, borderTopWidth: 2, borderRightWidth: 2 },
  bottomLeft: { left: 0, bottom: 0, borderBottomWidth: 2, borderLeftWidth: 2 },
  bottomRight: { right: 0, bottom: 0, borderBottomWidth: 2, borderRightWidth: 2 },
  page: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
  },
  reveal: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    overflow: 'hidden',
  },
  scan: {
    position: 'absolute',
    left: -6,
    right: -6,
    top: 0,
    height: 20,
  },
  scanLine: {
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.accent,
  },
  found: {
    position: 'absolute',
    right: -26,
    top: -16,
    height: 28,
    paddingHorizontal: 11,
    borderRadius: 14,
    backgroundColor: colors.darkBg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  foundNote: {
    fontFamily: fontFamily.serifRegular,
    fontSize: 15,
    lineHeight: 17,
    color: colors.accentOnDark,
  },
  foundTempo: {
    fontFamily: fontFamily.sansMedium,
    fontSize: 12,
    lineHeight: 16,
    color: colors.onDark,
    fontVariant: ['tabular-nums'],
  },
});

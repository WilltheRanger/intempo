import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';

import { Mic } from '../../components/icons';
import { colors } from '../../design';
import { useReducedMotion } from '../../lib/useReducedMotion';

/** One breath of the ring and one pass of the waveform. */
const LOOP_MS = 3600;

const DISC = 96;
const STAGE = 128;
const RING_INSET = 8;

/** The waveform's own box, from the prototype; it is stretched to the column. */
const WAVE_WIDTH = 342;
const WAVE_HEIGHT = 104;
const MIDLINE = WAVE_HEIGHT / 2;

/**
 * A phrase's loudness, left to right: how far the prototype's waveform stands
 * off its midline at each of 77 evenly spaced points
 * (`redesign/OnboardMic.dc.html`). Mirrored below the line, it is the shape of
 * somebody playing — a swell, a peak, a fall — rather than a noise pattern.
 */
const PHRASE = [
  1, 1.3, 2.2, 3.1, 3.8, 4, 4, 4.1, 4.9, 6.9, 9.9, 13.3, 16.1, 17.8, 18.7, 19.2, 19.6, 19.8, 19.5,
  18.9, 18.7, 19.7, 22.2, 25.6, 28.5, 29.5, 27.8, 24.1, 20.2, 17.8, 18.2, 21, 25.1, 29.3, 32.9,
  36.1, 38.8, 40.4, 39.9, 36.6, 31.1, 25.3, 21.4, 20.3, 21.8, 24.4, 26.3, 26.6, 25.2, 22.9, 20.9,
  19.7, 19.3, 19.3, 19.5, 20.2, 22, 24.7, 27.4, 28.5, 27.1, 23.5, 18.7, 14.4, 11.5, 10.3, 10.2,
  10.4, 10.1, 9.2, 7.9, 6.4, 4.8, 3.3, 2, 1, 1,
];

/**
 * A smooth line through points, Catmull-Rom as cubic Béziers — the same
 * curve the prototype drew, which is why its control points sit a third of
 * the way to each neighbour.
 */
function smoothThrough(points: ReadonlyArray<readonly [number, number]>, move: boolean): string {
  const at = (index: number) => points[Math.max(0, Math.min(points.length - 1, index))];
  let path = move ? `M ${points[0][0]} ${points[0][1]}` : `L ${points[0][0]} ${points[0][1]}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const [x0, y0] = at(index - 1);
    const [x1, y1] = at(index);
    const [x2, y2] = at(index + 1);
    const [x3, y3] = at(index + 2);
    const c1 = [x1 + (x2 - x0) / 6, y1 + (y2 - y0) / 6];
    const c2 = [x2 - (x3 - x1) / 6, y2 - (y3 - y1) / 6];
    path += ` C ${c1[0].toFixed(2)} ${c1[1].toFixed(2)} ${c2[0].toFixed(2)} ${c2[1].toFixed(2)} ${x2} ${y2}`;
  }
  return path;
}

const STEP = WAVE_WIDTH / (PHRASE.length - 1);
const TOP = PHRASE.map((height, index) => [index * STEP, MIDLINE - height] as const);
const BOTTOM = PHRASE.map((height, index) => [index * STEP, MIDLINE + height] as const).reverse();
const OUTLINE = smoothThrough(TOP, true);
const ENVELOPE = `${OUTLINE} ${smoothThrough(BOTTOM, false)} Z`;

const USE_NATIVE = Platform.OS !== 'web';

/**
 * The microphone step's picture (`redesign/OnboardMic.dc.html`): the mic in an
 * ink disc with a gold ring breathing out from it, and under it a phrase
 * drawing itself in, left to right, as a take would.
 *
 * **At rest the waveform is whole and the ring is still and faint**, which is
 * what Reduce Motion shows: the loop only closes and reopens what is already
 * there.
 */
export function ListeningIllustration() {
  const reduceMotion = useReducedMotion();
  const ring = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(1)).current;
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (reduceMotion) {
      ring.setValue(0);
      sweep.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(ring, {
            toValue: 1,
            duration: LOOP_MS * 0.62,
            easing: Easing.bezier(0.3, 0, 0.2, 1),
            useNativeDriver: USE_NATIVE,
          }),
          Animated.delay(LOOP_MS * 0.38),
        ]),
        Animated.sequence([
          Animated.timing(sweep, {
            toValue: 1,
            duration: LOOP_MS * 0.68,
            easing: Easing.bezier(0.42, 0, 0.3, 1),
            // A width, so the layout has to move with it.
            useNativeDriver: false,
          }),
          Animated.delay(LOOP_MS * 0.32),
        ]),
      ]),
    );
    ring.setValue(0);
    sweep.setValue(0);
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, ring, sweep]);

  const ringStyle = reduceMotion
    ? styles.ringAtRest
    : {
        opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
        transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.24] }) }],
      };

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="A microphone, and a phrase of playing drawn as it is heard"
      style={styles.column}
    >
      <View style={styles.stage}>
        <Animated.View style={[styles.ring, ringStyle]} />
        <View style={styles.disc}>
          <Mic size={38} strokeWidth={1.6} color={colors.onDark} />
        </View>
      </View>

      <View
        style={styles.wave}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        {width > 0 ? (
          <>
            <Wave width={width} midline />
            <Animated.View
              style={[
                styles.reveal,
                { width: sweep.interpolate({ inputRange: [0, 1], outputRange: [0, width] }) },
              ]}
            >
              <Wave width={width} />
            </Animated.View>
          </>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The midline alone, or the phrase over it. Drawn at the column's width so the
 * reveal can clip it without the shape moving underneath.
 */
function Wave({ width, midline = false }: { width: number; midline?: boolean }) {
  return (
    <Svg
      width={width}
      height={WAVE_HEIGHT}
      viewBox={`0 0 ${WAVE_WIDTH} ${WAVE_HEIGHT}`}
      preserveAspectRatio="none"
    >
      {midline ? (
        <Line x1={0} y1={MIDLINE} x2={WAVE_WIDTH} y2={MIDLINE} stroke={colors.border} strokeWidth={1} />
      ) : (
        <>
          <Path d={ENVELOPE} fill={colors.accent} fillOpacity={0.17} />
          <Path
            d={OUTLINE}
            fill="none"
            stroke={colors.accent}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <Line
            x1={0}
            y1={MIDLINE}
            x2={WAVE_WIDTH}
            y2={MIDLINE}
            stroke={colors.accent}
            strokeWidth={1}
            strokeOpacity={0.5}
          />
        </>
      )}
    </Svg>
  );
}

const styles = StyleSheet.create({
  column: {
    alignItems: 'center',
  },
  stage: {
    width: STAGE,
    height: STAGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    left: RING_INSET,
    top: RING_INSET,
    right: RING_INSET,
    bottom: RING_INSET,
    borderRadius: (STAGE - RING_INSET * 2) / 2,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  ringAtRest: {
    opacity: 0.35,
  },
  disc: {
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    backgroundColor: colors.darkBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wave: {
    alignSelf: 'stretch',
    height: WAVE_HEIGHT,
    marginTop: 24,
  },
  reveal: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
  },
});

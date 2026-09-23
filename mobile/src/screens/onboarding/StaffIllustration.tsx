import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import Svg, { Ellipse, Line, Path, Polygon } from 'react-native-svg';

import { colors } from '../../design';
import { useReducedMotion } from '../../lib/useReducedMotion';

const WIDTH = 250;
const HEIGHT = 96;
const STAFF_TOP = 26;
const LINE_GAP = 9;

/** The staff drawing itself, the clef, and the notes landing: once. */
const WRITE_MS = 1700;
/** Then the playhead reading the bar back, for as long as the screen is up. */
const PLAY_MS = 2400;

const USE_NATIVE = Platform.OS !== 'web';

interface Note {
  heads: ReadonlyArray<readonly [number, number]>;
  stems: ReadonlyArray<readonly [number, number, number]>;
  beam?: readonly number[];
  /** When it lands, as a share of the writing. */
  lands: number;
  /** When the playhead reaches it, as a share of the reading. */
  heard: number;
}

/** The bar, from `redesign/OnboardDone.dc.html`. */
const NOTES: readonly Note[] = [
  { heads: [[84, 53]], stems: [[89.58, 53, 23.3]], lands: 0.44, heard: 0.112 },
  {
    heads: [
      [118, 44],
      [140, 48.5],
    ],
    stems: [
      [123.58, 44, 14.3],
      [145.58, 48.5, 18.8],
    ],
    beam: [123.58, 14.3, 145.58, 18.8, 145.58, 23.03, 123.58, 18.53],
    lands: 0.55,
    heard: 0.279,
  },
  { heads: [[176, 39.5]], stems: [[170.42, 39.5, 69.2]], lands: 0.66, heard: 0.562 },
  { heads: [[212, 30.5]], stems: [[206.42, 30.5, 60.2]], lands: 0.77, heard: 0.738 },
];

/**
 * The done screen's picture (`redesign/OnboardDone.dc.html`): a staff drawing
 * itself line by line, a clef, four beats landing on it, and then a gold
 * playhead reading the bar back with each note catching the light as it is
 * passed — what the app is about to do with the musician's own playing.
 *
 * **Complete at rest.** Reduce Motion gets the written bar and no playhead;
 * every keyframe only says where a part comes from.
 *
 * Built from views over one SVG per part rather than one SVG with animated
 * attributes, so every movement is an opacity or a transform on the native
 * driver, and a note's gold is a second copy of it fading in and out rather
 * than a colour being interpolated.
 */
export function StaffIllustration() {
  const reduceMotion = useReducedMotion();
  const write = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const play = useRef(new Animated.Value(0)).current;
  const playing = useRef(new Animated.Value(reduceMotion ? 0 : 1)).current;

  useEffect(() => {
    if (reduceMotion) {
      write.setValue(1);
      playing.setValue(0);
      return;
    }
    write.setValue(0);
    playing.setValue(1);
    const run = Animated.sequence([
      Animated.timing(write, {
        toValue: 1,
        duration: WRITE_MS,
        easing: Easing.linear,
        useNativeDriver: USE_NATIVE,
      }),
      Animated.loop(
        Animated.timing(play, {
          toValue: 1,
          duration: PLAY_MS,
          easing: Easing.linear,
          useNativeDriver: USE_NATIVE,
        }),
      ),
    ]);
    run.start();
    return () => run.stop();
  }, [reduceMotion, write, play, playing]);

  const drawEase = Easing.bezier(0.4, 0, 0.2, 1);
  const landEase = Easing.bezier(0.2, 0.7, 0.3, 1);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="A bar of music being written out, then read back on the beat"
      style={styles.stage}
    >
      {[0, 1, 2, 3, 4].map((line) => {
        // Each line a beat behind the one above it, left to right.
        const from = line * 0.07;
        const drawn =
          line === 0
            ? write.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1], easing: drawEase })
            : write.interpolate({
                inputRange: [0, from, from + 0.4, 1],
                outputRange: [0, 0, 1, 1],
                easing: drawEase,
              });
        return (
          <Animated.View
            key={line}
            style={[
              styles.staffLine,
              { top: STAFF_TOP + line * LINE_GAP - 0.5, transform: [{ scaleX: drawn }] },
            ]}
          />
        );
      })}
      <Animated.View
        style={[
          styles.finalBar,
          { opacity: write.interpolate({ inputRange: [0, 0.62, 0.68, 1], outputRange: [0, 0, 1, 1] }) },
        ]}
      />

      <Animated.View
        style={[
          styles.layer,
          { opacity: write.interpolate({ inputRange: [0, 0.22, 0.42, 1], outputRange: [0, 0, 1, 1] }) },
        ]}
      >
        <Svg width={WIDTH} height={HEIGHT}>
          <Path
            d="M 24.21 18.29 C 16.50 24.71 13.29 35.00 15.86 43.36 C 17.91 50.17 22.93 55.57 24.60 62.00 C 26.40 68.94 22.54 74.09 17.40 72.80 C 13.80 71.90 12.77 67.14 15.60 65.34"
            fill="none"
            stroke={colors.textPrimary}
            strokeWidth={2.16}
            strokeLinecap="round"
          />
          <Path
            d="M 24.21 18.29 C 30.64 23.43 31.93 33.71 25.50 40.79 C 20.36 46.57 12.64 48.50 11.49 54.03 C 10.59 58.91 14.83 62.77 19.46 60.97 C 23.31 59.43 24.34 54.80 22.03 51.71"
            fill="none"
            stroke={colors.textPrimary}
            strokeWidth={2.16}
            strokeLinecap="round"
          />
        </Svg>
      </Animated.View>

      {NOTES.map((note) => {
        const landing = {
          opacity: write.interpolate({
            inputRange: [0, note.lands, note.lands + 0.08, 1],
            outputRange: [0, 0, 1, 1],
            easing: landEase,
          }),
          transform: [
            {
              translateY: write.interpolate({
                inputRange: [0, note.lands, note.lands + 0.08, note.lands + 0.13, 1],
                outputRange: [-12, -12, 1.5, 0, 0],
                easing: landEase,
              }),
            },
          ],
        };
        const glow = Animated.multiply(
          playing,
          play.interpolate({
            inputRange: [0, note.heard, note.heard + 0.02, note.heard + 0.145, 1],
            outputRange: [0, 0, 1, 0, 0],
          }),
        );
        return (
          <Animated.View key={note.lands} style={[styles.layer, landing]}>
            <NoteShape note={note} color={colors.textPrimary} />
            <Animated.View style={[styles.layer, { opacity: glow }]}>
              <NoteShape note={note} color={colors.accent} />
            </Animated.View>
          </Animated.View>
        );
      })}

      <Animated.View
        style={[
          styles.playhead,
          {
            opacity: Animated.multiply(
              playing,
              play.interpolate({ inputRange: [0, 0.04, 0.9, 1], outputRange: [0, 1, 1, 0] }),
            ),
            transform: [
              {
                translateX: play.interpolate({
                  inputRange: [0, 0.9, 1],
                  outputRange: [0, 184, 184],
                }),
              },
            ],
          },
        ]}
      />
    </View>
  );
}

function NoteShape({ note, color }: { note: Note; color: string }) {
  return (
    <Svg width={WIDTH} height={HEIGHT}>
      {note.heads.map(([x, y]) => (
        <Ellipse
          key={x}
          cx={x}
          cy={y}
          rx={5.94}
          ry={4.23}
          transform={`rotate(-21 ${x} ${y})`}
          fill={color}
        />
      ))}
      {note.stems.map(([x, from, to]) => (
        <Line
          key={x}
          x1={x}
          y1={from}
          x2={x}
          y2={to}
          stroke={color}
          strokeWidth={1.53}
          strokeLinecap="round"
        />
      ))}
      {note.beam ? <Polygon points={note.beam.join(' ')} fill={color} /> : null}
    </Svg>
  );
}

const styles = StyleSheet.create({
  stage: {
    width: WIDTH,
    height: HEIGHT,
  },
  layer: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: WIDTH,
    height: HEIGHT,
  },
  staffLine: {
    position: 'absolute',
    left: 0,
    width: WIDTH,
    height: 1,
    backgroundColor: colors.textSecondary,
    opacity: 0.85,
    transformOrigin: 'left',
  },
  finalBar: {
    position: 'absolute',
    left: WIDTH - 1.8,
    top: STAFF_TOP,
    width: 1.6,
    height: LINE_GAP * 4,
    backgroundColor: colors.textSecondary,
  },
  playhead: {
    position: 'absolute',
    left: 59,
    top: 14,
    width: 2,
    height: 62,
    borderRadius: 1,
    backgroundColor: colors.accent,
  },
});

import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BrandMark } from '../../components/brand/BrandMark';
import { FadeIn } from '../../components/motion';
import { Text } from '../../components/primitives';
import { colors, fontFamily } from '../../design';
import { RESTING, WAKING_AFTER_MS, markFrame, openingLine } from '../../lib/brand/mark';
import { useReducedMotion } from '../../lib/useReducedMotion';

/** About thirty frames a second: enough for a line drawing itself and a slow pulse. */
const FRAME_MS = 33;

/**
 * Milliseconds since the screen appeared. Animated, it ticks every frame (at
 * most every `FRAME_MS`); held still, it moves once, when the line is due.
 */
function useElapsed(animate: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    if (!animate) {
      const timer = setTimeout(() => setElapsed(Date.now() - started), WAKING_AFTER_MS);
      return () => clearTimeout(timer);
    }
    let frame = 0;
    let last = 0;
    const tick = () => {
      const now = Date.now() - started;
      if (now - last >= FRAME_MS) {
        last = now;
        setElapsed(now);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animate]);
  return elapsed;
}

/**
 * Opening the app while the account loads (the owner, 2026-09-30, "S1 · Ink,
 * like the icon", in place of "Opening your practice space", two sentences and
 * a spinner).
 *
 * **The icon, opening.** The same ink ground and the same mark as the icon
 * that was tapped, so launching reads as one motion: the band fades up, the
 * line draws itself across it and settles, the gold dot lands, and then it
 * pulses at sixty to the minute — a metronome at rest — for as long as the
 * account takes. No words unless it is slow: most opens take a moment, and
 * "Waking up…" appears only after `WAKING_AFTER_MS`, which after a quiet
 * spell is the server starting.
 *
 * Reduced motion shows the mark at rest and no pulse.
 */
export function OpeningScreen() {
  const reduceMotion = useReducedMotion();
  const elapsed = useElapsed(!reduceMotion);
  const line = openingLine(elapsed);

  return (
    <View style={styles.screen} accessible accessibilityLabel="Opening InTempo">
      <StatusBar style="light" />
      <View style={styles.centre}>
        <BrandMark
          size={144}
          lineColor={colors.onDark}
          dotColor={colors.accent}
          frame={reduceMotion ? RESTING : markFrame(elapsed)}
        />
        <Text style={styles.name}>InTempo</Text>
      </View>
      <View style={styles.foot} accessibilityLiveRegion="polite">
        {line ? (
          <FadeIn>
            <Text variant="body" style={styles.line}>
              {line}
            </Text>
          </FadeIn>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.darkBg,
  },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // No margin of its own: the mark's box already leaves a quarter of itself
  // empty under the line, which is the gap.
  name: {
    fontFamily: fontFamily.serifMedium,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.4,
    color: colors.onDark,
  },
  // Where the thumb would be, and where the eye goes once the mark has
  // settled and nothing else is happening.
  foot: {
    height: 120,
    alignItems: 'center',
  },
  line: {
    color: colors.onDarkMuted,
  },
});

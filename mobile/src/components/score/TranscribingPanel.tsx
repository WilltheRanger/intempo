import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { Text } from '../primitives/Text';
import type { Piece } from '../../data/types';
import { colors, spacing } from '../../design';
import { useReducedMotion } from '../../lib/useReducedMotion';

/**
 * How far along each reported step is.
 *
 * **This is a position, not a prediction.** The bar moves when the worker
 * reports a step it has actually reached and at no other time — nothing here
 * creeps forward on a timer toward a number nobody is measuring, which is what
 * the mocked version of the scan flow used to do while performing no work at
 * all.
 *
 * The fractions are spaced by how much of the job is left after each step
 * rather than evenly, because the steps are not evenly sized: fetching a file
 * is quick and reading a page of notation is most of the wait. Two of the four
 * are skipped entirely when no OMR engine is installed, so a bar that divided
 * by the step count would jump differently depending on a server setting.
 *
 * Keyed on the worker's own words. They are the contract between
 * `transcription_runner.py` and this screen, and an unrecognised one simply
 * leaves the bar where it was — a new stage should never move it backwards.
 */
const STAGE_PROGRESS: Record<string, number> = {
  'Fetching the page': 0.15,
  'Finding the staves': 0.35,
  'Checking the reading': 0.6,
  'Reading the notation': 0.7,
};

/** Before the worker has said anything: accepted, not yet started. */
const QUEUED_PROGRESS = 0.05;

export interface TranscribingPanelProps {
  /** The piece being read. Only its transcription fields are consulted. */
  piece: Piece;
}

/**
 * What is happening to a page while it is being read.
 *
 * Reading a page takes tens of seconds, and for the whole of that a musician
 * has nothing to look at but the app. The failure this replaces was not
 * slowness — it was that a spinner and a hang are indistinguishable, so a scan
 * that was working looked exactly like one that had died. Naming the step is
 * the whole point; the bar is a secondary read of the same fact.
 *
 * One focal point: the step. The bar is a hairline under it and the caption
 * below is smaller still (§3 laws 4 and 8).
 */
export function TranscribingPanel({ piece }: TranscribingPanelProps) {
  const reducedMotion = useReducedMotion();
  const target =
    (piece.transcriptionStage ? STAGE_PROGRESS[piece.transcriptionStage] : undefined) ??
    QUEUED_PROGRESS;

  // Held in a ref so a re-render for any other reason doesn't restart the
  // animation from zero, which would read as the job starting over.
  const progress = useRef(new Animated.Value(target)).current;

  useEffect(() => {
    if (reducedMotion) {
      progress.setValue(target);
      return;
    }
    Animated.timing(progress, {
      toValue: target,
      duration: 400,
      // Width is a layout property, so this cannot run on the UI thread. It is
      // one hairline moving four times over a minute, not a per-frame effect.
      useNativeDriver: false,
    }).start();
  }, [target, reducedMotion, progress]);

  const width = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.panel} accessibilityRole="progressbar">
      <Text variant="pieceTitle">
        {piece.transcriptionStage ?? 'Getting ready to read this page'}
      </Text>

      <View style={styles.track}>
        <Animated.View style={[styles.fill, { width }]} />
      </View>

      <Text variant="metadataSmall" color="textTertiary" style={styles.caption}>
        Reading a page usually takes under a minute. You can leave this screen —
        it carries on without you, and the piece is already in your library.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginTop: spacing['2xl'],
  },
  // A rule across the column, not a rounded pill floating in a card (§3 law 6).
  track: {
    height: 2,
    marginTop: spacing.lg,
    backgroundColor: colors.border,
  },
  fill: {
    height: 2,
    backgroundColor: colors.accent,
  },
  caption: {
    marginTop: spacing.md,
  },
});

import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { Text } from '../primitives/Text';
import type { Piece } from '../../data/types';
import { colors, spacing } from '../../design';
import { QUEUED_PROGRESS, progressFor } from '../../lib/transcriptionProgress';
import { useReducedMotion } from '../../lib/useReducedMotion';


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
  // Where the bar goes, and the rule for a stage this build does not know:
  // hold, never fall back. See `progressFor`.
  const held = useRef(QUEUED_PROGRESS);
  const target = progressFor(piece.transcriptionStage, held.current);
  held.current = target;

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
      {/*
        A page with no stage yet is *queued* — waiting for another page to
        finish, because the server reads a bounded number at once. "Getting
        ready" described the app; this describes what is actually happening,
        which is the difference between a wait that makes sense and one that
        looks stuck.
      */}
      <Text variant="pieceTitle">
        {piece.transcriptionStage ??
          (piece.transcriptionStatus === 'queued'
            ? 'Waiting for another page to finish'
            : 'Getting ready to read this page')}
      </Text>

      <View style={styles.track}>
        <Animated.View style={[styles.fill, { width }]} />
      </View>

      {/*
        "Under a minute" was true when a page was one model call. It is read a
        stave at a time now — four at once, but a dense page is still three
        rounds of that — so the claim is softened rather than left to be wrong
        on exactly the pages that take longest.
      */}
      <Text variant="metadataSmall" color="textTertiary" style={styles.caption}>
        Reading a page usually takes under a minute, longer for a dense one. You
        can leave this screen — it carries on without you, and the piece is
        already in your library.
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

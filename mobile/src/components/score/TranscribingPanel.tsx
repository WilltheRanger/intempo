import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { Text } from '../primitives/Text';
import type { Piece } from '../../data/types';
import { colors, spacing } from '../../design';
import {
  QUEUED_PROGRESS,
  pageStates,
  progressFor,
  type PageProgress,
} from '../../lib/transcriptionProgress';
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
 * One focal point: the step. The bar is a hairline under it, the queue under
 * that is smaller again, and the caption smaller still (§3 laws 4 and 8).
 *
 * **The queue is the fact this screen most often failed to explain.** A scan's
 * pages are read one after another, and for most of a four-page wait the panel
 * said `Reading page 2 of 4` and nothing else — true, and no help to someone
 * wondering whether pages three and four were lost, queued, or never uploaded.
 * The rules are in `transcriptionProgress.ts`, with the bar's, because a rule
 * inside a `.tsx` is a rule nothing checks (`CLAUDE.md` §3).
 */
export function TranscribingPanel({ piece }: TranscribingPanelProps) {
  const reducedMotion = useReducedMotion();
  // Where the bar goes, and the rule for a stage this build does not know:
  // hold, never fall back. See `progressFor`.
  const held = useRef(QUEUED_PROGRESS);
  const target = progressFor(piece.transcriptionStage, held.current);
  held.current = target;

  // Same hold as the bar's, and for the same reason: a stage this build cannot
  // place leaves the queue where it was rather than redrawing it, which would
  // read as the scan starting over. `piece.pages` is the total because it is
  // the piece's own count — the stage string's is checked against it.
  const heldPages = useRef<PageProgress[] | null>(null);
  const queue = pageStates(
    piece.transcriptionStage,
    piece.pages.length,
    heldPages.current,
  );
  heldPages.current = queue;

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

      {queue ? (
        <View style={styles.queue}>
          {queue.map((entry) => (
            <View key={entry.page} style={styles.queueRow}>
              {/*
                No rules, no chips, no dots. Two columns of type, and the page
                being read is the only one at full strength — the hierarchy §3
                law 8 asks for, in a block that has to stay quieter than the
                step above it.
              */}
              <Text
                variant="metadataSmall"
                color={entry.state === 'reading' ? 'textSecondary' : 'textTertiary'}
              >
                Page {entry.page}
              </Text>
              <Text
                variant="metadataSmall"
                color={entry.state === 'reading' ? 'textPrimary' : 'textTertiary'}
              >
                {entry.note}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {/*
        "Under a minute" was true when a page was one model call. It is read a
        stave at a time now — four at once, but a dense page is still three
        rounds of that — so the claim is softened rather than left to be wrong
        on exactly the pages that take longest.
      */}
      <Text variant="metadataSmall" color="textTertiary" style={styles.caption}>
        Usually under a minute. You can leave; it keeps going.
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
  queue: {
    marginTop: spacing.lg,
  },
  queueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: spacing.xs,
  },
  caption: {
    marginTop: spacing.md,
  },
});

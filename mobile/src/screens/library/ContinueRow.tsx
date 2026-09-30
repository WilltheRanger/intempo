import { StyleSheet, View } from 'react-native';

import { PressableScale } from '../../components/motion';
import { PrimaryButton } from '../../components/primitives/PrimaryButton';
import { Text } from '../../components/primitives/Text';
import { TrailingChevron } from '../../components/primitives/TrailingChevron';
import { BORDER_WIDTH, colors, spacing } from '../../design';
import type { ContinueLine, PendingLine } from '../../lib/library/continueLine';

export interface ContinueRowProps {
  line: ContinueLine;
  /** The piece itself — the title is a way into it, like a tile. */
  onOpen: () => void;
  /** The button: a take, or the piece where there is nothing to record against. */
  onAction: () => void;
}

/**
 * The first thing on the Library: the piece to play next, why, and the button
 * that starts it (`LibraryHome.dc.html`, the owner's pick of 2026-09-30).
 *
 * **Ruled, not carded.** A rule in ink above and a hairline below make it the
 * one row on the page that is not a shelf, and that is all the separation it
 * needs — §3 law 3 keeps cards for grouping, and this is one line of intent.
 * The heading is the largest type under the page title and the button is the
 * only filled control on the screen, so the eye lands here first and the shelf
 * recedes behind it (law 4).
 *
 * Two targets, each a real one: the words open the piece, the button does
 * what it says. Neither draws an affordance the other honours.
 */
export function ContinueRow({ line, onOpen, onAction }: ContinueRowProps) {
  return (
    <View style={styles.row}>
      {/*
        The column that gives: `PressableScale` puts its style on the view
        inside the `Pressable`, so the flex has to be on a wrapper or the title
        sizes the row and pushes the button past the margin (measured at 390pt,
        2026-09-30: the button ended 16pt outside the gutter).
      */}
      <View style={styles.words}>
        <PressableScale
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={['Continue', line.title, line.detail].filter(Boolean).join('. ')}
          accessibilityHint="Opens the piece"
          activeScale={0.99}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Text variant="sectionLabel" color="textSecondary">
            Continue
          </Text>
          <Text variant="heroTitle" numberOfLines={2} style={styles.title}>
            {line.title}
          </Text>
          {line.detail ? (
            <Text variant="metadata" color="textSecondary" numberOfLines={1} style={styles.detail}>
              {line.detail}
            </Text>
          ) : null}
        </PressableScale>
      </View>
      <PrimaryButton
        size="compact"
        label={line.actionLabel}
        onPress={onAction}
        style={styles.action}
      />
    </View>
  );
}

/**
 * The take this device handed over, under the Continue row: one line, and a
 * control in every state — it opens the result when there is one and asks
 * again when there is not (`continueLine.pendingLineFor`).
 */
export function PendingTakeLine({
  line,
  onPress,
}: {
  line: PendingLine;
  /** Undefined while a check is in flight: nothing to do but wait. */
  onPress?: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={line.label}
      activeScale={0.99}
      style={({ pressed }) => [styles.pending, pressed && styles.pressed]}
    >
      <Text variant="metadata" color="textSecondary" numberOfLines={1} style={styles.pendingLabel}>
        {line.label}
      </Text>
      {onPress ? <TrailingChevron /> : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xl,
    paddingTop: 18,
    paddingBottom: spacing.xl,
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.textPrimary,
    borderBottomWidth: BORDER_WIDTH,
    borderBottomColor: colors.border,
  },
  words: {
    flex: 1,
    minWidth: 0,
  },
  action: {
    flexShrink: 0,
  },
  title: {
    marginTop: spacing.xs,
  },
  detail: {
    marginTop: spacing.xs,
  },
  pressed: {
    opacity: 0.55,
  },
  // A row, not a caption: the whole 44pt strip is the target.
  pending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    borderBottomWidth: BORDER_WIDTH,
    borderBottomColor: colors.border,
  },
  pendingLabel: {
    flex: 1,
  },
});

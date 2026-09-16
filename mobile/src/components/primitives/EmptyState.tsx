import type { LucideIcon } from '../icons';
import { StyleSheet, View } from 'react-native';

import { colors, ICON_SIZE, ICON_STROKE_WIDTH, spacing } from '../../design';
import { PrimaryButton } from './PrimaryButton';
import { SecondaryButton } from './SecondaryButton';
import { Text } from './Text';

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actionLabel?: string;
  onActionPress?: () => void;
  /**
   * Refuse further taps while the action is in flight.
   *
   * `SecondaryButton` has always taken this; nothing passed it. So a caller
   * that changed the label to say it was working — "Try reading it again"
   * becoming "Reading again…" — changed only the words, and the button stayed
   * pressable underneath them. Double-tapping the re-read on a failed scan
   * started two readings of the same page.
   */
  actionDisabled?: boolean;
  /**
   * Centre in the height left over, for a state that *is* the whole screen.
   *
   * Off by default because this is also used inside a list — Library's "No
   * matches" sits under a search field with rows above it, and centring that
   * in the page would pull it away from what it is about.
   *
   * On, the message and its action sit in the middle of the screen rather than
   * in the top quarter with two thirds of the page empty beneath them, and the
   * action lands near the thumb instead of near the status bar (§3 law 7).
   */
  fill?: boolean;
  /**
   * How much weight the action carries.
   *
   * Secondary by default, which is right where the empty state is one part of
   * a screen — Library's "No matches" under a search field, a failed load
   * beside other content.
   *
   * `'primary'` is for the screen where this action is the **only** thing a
   * person can do. Today, opened by someone who has just signed up, is that
   * screen: the app's whole proposition is add a piece, and it was offered in
   * the same outlined button the populated screen uses for its *secondary*
   * actions while "Continue practice" beside it is solid ink.
   */
  actionTone?: 'primary' | 'secondary';
  /**
   * A quieter line under the description.
   *
   * For the sentence that is worth saying and is not the point: the technique
   * that makes a page read well, what to do if a failure keeps happening. It
   * recedes to `textTertiary` so it cannot compete with the description above
   * it or the action below it (§3 laws 4 and 8).
   */
  hint?: string;
  /**
   * A second, quieter route out.
   *
   * Only where there genuinely are two — photograph a page or choose one
   * already on the phone, take it again or use the camera app. A screen with
   * one thing to do keeps one button; two identical-looking buttons is the
   * choice §3 law 10 asks to remove.
   */
  secondaryLabel?: string;
  onSecondaryPress?: () => void;
}

/** Shown when a screen has nothing to display. Plain and unapologetic. */
export function EmptyState({
  title,
  description,
  icon: Icon,
  actionLabel,
  onActionPress,
  actionDisabled = false,
  fill = false,
  actionTone = 'secondary',
  hint,
  secondaryLabel,
  onSecondaryPress,
}: EmptyStateProps) {
  const Action = actionTone === 'primary' ? PrimaryButton : SecondaryButton;
  return (
    <View style={[styles.container, fill && styles.filled]}>
      {Icon ? (
        <Icon
          size={ICON_SIZE.lg}
          strokeWidth={ICON_STROKE_WIDTH}
          color={colors.textTertiary}
          style={styles.icon}
        />
      ) : null}

      <Text variant="pieceTitle" style={styles.title}>
        {title}
      </Text>

      {description ? (
        <Text variant="body" color="textSecondary" style={styles.description}>
          {description}
        </Text>
      ) : null}

      {hint ? (
        <Text variant="metadataSmall" color="textTertiary" style={styles.hint}>
          {hint}
        </Text>
      ) : null}

      {actionLabel && onActionPress ? (
        <Action
          label={actionLabel}
          onPress={onActionPress}
          disabled={actionDisabled}
          style={styles.action}
        />
      ) : null}

      {secondaryLabel && onSecondaryPress ? (
        <SecondaryButton
          label={secondaryLabel}
          onPress={onSecondaryPress}
          style={styles.secondary}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: spacing['3xl'],
    paddingHorizontal: spacing.lg,
  },
  filled: {
    // Needs `flexGrow` on `ScreenContainer`'s content container to have any
    // effect — see the note there.
    flex: 1,
    justifyContent: 'center',
  },
  icon: {
    marginBottom: spacing.lg,
  },
  title: {
    textAlign: 'center',
  },
  description: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  hint: {
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  action: {
    marginTop: spacing.xl,
    alignSelf: 'stretch',
  },
  secondary: {
    marginTop: spacing.md,
    alignSelf: 'stretch',
  },
});

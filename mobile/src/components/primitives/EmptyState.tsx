import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { colors, ICON_SIZE, ICON_STROKE_WIDTH, spacing } from '../../design';
import { SecondaryButton } from './SecondaryButton';
import { Text } from './Text';

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actionLabel?: string;
  onActionPress?: () => void;
}

/** Shown when a screen has nothing to display. Plain and unapologetic. */
export function EmptyState({
  title,
  description,
  icon: Icon,
  actionLabel,
  onActionPress,
}: EmptyStateProps) {
  return (
    <View style={styles.container}>
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

      {actionLabel && onActionPress ? (
        <SecondaryButton
          label={actionLabel}
          onPress={onActionPress}
          style={styles.action}
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
  action: {
    marginTop: spacing.xl,
    alignSelf: 'stretch',
  },
});

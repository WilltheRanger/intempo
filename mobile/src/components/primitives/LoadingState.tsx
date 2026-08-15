import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { colors, spacing } from '../../design';
import { Text } from './Text';

export interface LoadingStateProps {
  /** Optional line explaining what is being waited on. */
  label?: string;
}

/**
 * Placeholder while content loads.
 *
 * Deliberately minimal. Per-component skeletons are Phase 6 polish; a calm
 * indicator is the right default until then.
 */
export function LoadingState({ label }: LoadingStateProps) {
  return (
    <View style={styles.container}>
      <ActivityIndicator color={colors.textTertiary} />
      {label ? (
        <Text variant="metadata" color="textTertiary" style={styles.label}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing['3xl'],
  },
  label: {
    marginTop: spacing.md,
  },
});

import { StyleSheet, View } from 'react-native';

import { spacing } from '../../design';
import { Text } from './Text';

export interface PageHeaderProps {
  title: string;
  /** Small line above the title — a date, a count. Omitted when null. */
  eyebrow?: string | null;
}

/** The serif screen title, with an optional line of context above it. */
export function PageHeader({ title, eyebrow }: PageHeaderProps) {
  return (
    <View style={styles.container}>
      {eyebrow ? (
        <Text variant="metadata" color="textTertiary" style={styles.eyebrow}>
          {eyebrow}
        </Text>
      ) : null}
      <Text variant="screenTitle">{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  eyebrow: {
    marginBottom: spacing.sm,
  },
});

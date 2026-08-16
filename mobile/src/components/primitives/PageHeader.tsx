import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '../../design';
import { Text } from './Text';

export interface PageHeaderProps {
  title: string;
  /** Small line above the title — a date, a count. Omitted when null. */
  eyebrow?: string | null;
  /**
   * Optional control aligned with the title, for a screen-level action that
   * shouldn't span the full width. Keep it compact — the title leads.
   */
  action?: ReactNode;
}

/** The serif screen title, with an optional line of context above it. */
export function PageHeader({ title, eyebrow, action }: PageHeaderProps) {
  return (
    <View style={styles.container}>
      {eyebrow ? (
        <Text variant="metadata" color="textTertiary" style={styles.eyebrow}>
          {eyebrow}
        </Text>
      ) : null}

      <View style={styles.titleRow}>
        {/* flex so a long title wraps instead of shoving the action off-screen. */}
        <Text variant="screenTitle" style={styles.title}>
          {title}
        </Text>
        {action}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    // Intentional breathing room *after* the top safe-area inset, which
    // `ScreenContainer` applies. Never a status-bar or notch offset of its
    // own — the inset is whatever the device reports.
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  eyebrow: {
    marginBottom: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  title: {
    flexShrink: 1,
  },
});

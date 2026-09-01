import { ChevronLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '../../design';
import { IconButton } from './IconButton';
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
  /**
   * Back control above the title, for a pushed screen.
   *
   * Worth being explicit rather than automatic: iOS's swipe-back gesture is
   * real but invisible, Android's system back is a different affordance again,
   * and neither exists on the web build. A screen someone can reach needs a
   * way out they can see.
   */
  onBack?: () => void;
  /** Announced by screen readers, e.g. "Back to library". */
  backLabel?: string;
}

/** The serif screen title, with an optional line of context above it. */
export function PageHeader({
  title,
  eyebrow,
  action,
  onBack,
  backLabel = 'Back',
}: PageHeaderProps) {
  return (
    <View style={styles.container}>
      {onBack ? (
        <View style={styles.backRow}>
          <IconButton
            icon={ChevronLeft}
            label={backLabel}
            onPress={onBack}
            // Pulled out to the gutter so the glyph lines up with the title
            // below it rather than sitting indented by its own padding.
            style={styles.back}
          />
        </View>
      ) : null}

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
  backRow: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  back: {
    marginLeft: -spacing.md,
  },
  eyebrow: {
    marginBottom: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    // **Top, not centre.** Centred is right for a one-line title and wrong for
    // every longer one: a real repertoire title — "Sonata for Violin and Piano
    // No. 9 in A major, Op. 47 'Kreutzer'" — runs to five lines at 320pt, and a
    // centred action lands in the *middle of the paragraph*, reading as a mark
    // inside the text rather than as a control beside it. Every platform header
    // aligns its trailing action to the first line, for this reason.
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.lg,
    /**
     * **The action drops below the title when they cannot share a line.**
     * At iOS's larger text sizes they often cannot: measured at 2x type,
     * Library's "Add piece" ran 58pt off a 390pt screen because the row was
     * `nowrap` and only the title could shrink. Wrapping costs nothing at any
     * size where they do fit, and it is the difference between a control that
     * moves and a control that is gone.
     */
    flexWrap: 'wrap',
  },
  title: {
    flexShrink: 1,
  },
});

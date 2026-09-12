import { ChevronLeft } from '../icons';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '../../design';
import { IconButton } from './IconButton';
import { Text } from './Text';

export interface PageHeaderProps {
  /**
   * The serif heading. Omitted when the screen's finding is centred below.
   *
   * The two Verdict outcomes a musician meets after a take that could not be
   * read put their finding in a centred `EmptyState`, so the header carries
   * only the back control and the piece it is about. They still need the back
   * row, and it lives here for a specific reason: the negative offset below is
   * a **touch-target** fix, and a second copy of that row somewhere else is how
   * the 32x44 back button comes back.
   */
  title?: string;
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
          {/*
            **The offset is on the row, not on the button**, and that is a
            touch-target fix rather than a tidy-up.

            `PressableScale` puts the caller's `style` on its inner animated
            view and leaves the outer `Pressable` — the element that actually
            receives the press — to size itself around it. A negative
            `marginLeft` there therefore came *off the outer box*: measured in
            Chromium, the back control was **32x44** against this app's own
            44pt floor, on the most-used control it has. Offsetting the row
            instead leaves the glyph in exactly the same place and gives the
            button all 44 points back.
          */}
          <IconButton icon={ChevronLeft} label={backLabel} onPress={onBack} />
        </View>
      ) : null}

      {eyebrow ? (
        <Text variant="metadata" color="textTertiary" style={styles.eyebrow}>
          {eyebrow}
        </Text>
      ) : null}

      {title || action ? (
        <View style={styles.titleRow}>
          {/* flex so a long title wraps instead of shoving the action off-screen. */}
          {title ? (
            <Text variant="screenTitle" style={styles.title}>
              {title}
            </Text>
          ) : null}
          {action}
        </View>
      ) : null}
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
    // Out to the gutter, so the glyph lines up with the title below it rather
    // than sitting indented by its own padding. On the row because putting it
    // on the button costs the button 12pt of touch target — see above.
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
    /**
     * **`flex: 1`, not `flexShrink: 1`, and the difference is `flexWrap`.**
     *
     * Flex decides wrapping from items' *base* sizes and only then shrinks, so
     * with `flexShrink` alone a long title demanded its full content width, the
     * line broke, and the action dropped below it — orphaned under a two-line
     * piece title at ordinary text size. That was a regression from adding
     * `flexWrap` for the large-text case, and it is why both are needed: a base
     * of zero means the title never forces a wrap, it just takes what is left
     * and sets its own text over as many lines as it needs. The wrap then fires
     * only when the *action* genuinely cannot fit, which is what it was added
     * for.
     */
    flex: 1,
  },
});

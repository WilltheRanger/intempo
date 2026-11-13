import { StyleSheet, View } from 'react-native';

import { spacing } from '../../design';
import { LargeTitle } from './ScreenChrome';
import { Text } from './Text';

export interface PageHeaderProps {
  /** The serif heading. Collapses into the navigation bar as the page scrolls. */
  title: string;
  /**
   * A smaller title, for a screen whose subject is not the words.
   *
   * `screenTitle` is 36pt and right for a screen the title names — Library,
   * Insights, a verdict. The score reader is the case it is wrong for: the
   * subject is the engraving, a real repertoire title runs to two or three
   * lines at 36pt, and §3 law 4 allows one dominant focal point per screen.
   * A title that big competes with the music it is the caption for.
   *
   * Deliberately two named steps of the existing scale rather than a free
   * `variant`: the choice is "this screen's subject is the page, not its
   * name", not an invitation to size a header per screen (§3 law 5).
   */
  titleSize?: 'screen' | 'hero';
  /**
   * `onDark` for a header set on a band of colour or a photograph that is dark
   * in both appearances: the title in ivory.
   */
  tone?: 'auto' | 'onDark';
}

/**
 * The screen's large title: the serif heading at the top of its content.
 *
 * **The way back and the screen's actions are not here any more.** They are
 * in the navigation bar (`ScreenContainer.navigationBar`, 2026-11-13), which
 * stays put while this scrolls; a back link drawn above the title scrolled
 * away with it, so a long screen had no way back without scrolling up. This
 * is the title alone, and once it has scrolled under the bar the bar shows it
 * small (`LargeTitle`).
 *
 * **No line of context above the title** (owner, 2026-09-23: "remove this
 * subtitle from everything that has something like it. Makes it look
 * crowded"). The prop is gone rather than unused, so it does not come back
 * one screen at a time.
 */
export function PageHeader({ title, titleSize = 'screen', tone = 'auto' }: PageHeaderProps) {
  return (
    <View style={styles.container}>
      <LargeTitle text={title}>
        <Text
          variant={titleSize === 'hero' ? 'heroTitle' : 'screenTitle'}
          color={tone === 'onDark' ? 'onDark' : 'textPrimary'}
          accessibilityRole="header"
        >
          {title}
        </Text>
      </LargeTitle>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    // The bar is above the title now, so the title needs only a step of air
    // under it — not the 16 that used to separate it from the status bar.
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
});

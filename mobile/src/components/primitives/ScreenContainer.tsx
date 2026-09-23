import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import {
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BORDER_WIDTH, colors, spacing } from '../../design';
import { useChromeToneReporter } from '../../navigation/ChromeToneContext';
import { chromeToneFor } from '../../navigation/chromeTone';
import { useTabBarHeight, useTabBarMidline } from '../../navigation/tabBarMetrics';

const WEB_SCROLL_STYLE = Platform.select({
  web: {
    // Keep wheel, trackpad, and touch scrolling inside the app's own viewport
    // and let the browser compositor carry momentum independently of React.
    overscrollBehaviorY: 'contain',
    overscrollBehaviorX: 'hidden',
    // Gesture scrolling already has the browser's native momentum. CSS smooth
    // scrolling only stretches programmatic jumps (focus, back, scroll-to-top)
    // and makes them feel as though the interface is catching up.
    scrollBehavior: 'auto',
    WebkitOverflowScrolling: 'touch',
    scrollbarWidth: 'thin',
    scrollbarColor: `${colors.borderStrong} transparent`,
    scrollbarGutter: 'stable',
    touchAction: 'pan-y pinch-zoom',
  } as unknown as ViewStyle,
  default: undefined,
});

/**
 * The scrollbar gutter, given back.
 *
 * `WEB_SCROLL_STYLE` reserves it permanently with `scrollbarGutter: 'stable'`
 * so a page does not jump sideways the moment its content grows past a screen.
 * On every screen with a margin that reservation *is* part of the margin and
 * nobody can see it. On a full-bleed one it is a 10pt stripe of page
 * background running down the right of a photograph — measured at exactly 20
 * device pixels on the Today hero, ivory in light mode and black in dark.
 *
 * A phone has no scrollbar at all, so this only ever affects the web build,
 * which §3 law 1 calls the adaptation rather than the product.
 */
const WEB_NO_GUTTER = Platform.select({
  web: { scrollbarWidth: 'none', scrollbarGutter: 'auto' } as unknown as ViewStyle,
  default: undefined,
});

export interface ScreenContainerProps {
  children: ReactNode;
  /** Wrap content in a ScrollView. Screens that own their own list say false. */
  scrollable?: boolean;
  /** Extra padding at the bottom so content clears the tab bar. */
  contentStyle?: StyleProp<ViewStyle>;
  /**
   * Action pinned below the scroll area.
   *
   * For screens whose content grows without bound — a scan can be four pages
   * or thirty — so the action that ends the screen stays one tap away instead
   * of one long scroll away.
   */
  footer?: ReactNode;
  /**
   * Pull-to-refresh. Omit on screens with nothing to re-fetch — a spinner that
   * resolves instantly teaches people the gesture does nothing.
   */
  onRefresh?: () => Promise<unknown>;
  /**
   * Let content run to the edge of the screen.
   *
   * Drops the horizontal gutter, and on the web build drops the **scrollbar
   * gutter with it**. Those two go together or neither works: `scrollbarGutter:
   * 'stable'` below reserves about 10pt permanently so a page does not jump
   * when its content grows past a screen, and that reservation is invisible on
   * every screen with a margin — it is simply part of the margin. On a
   * full-bleed screen it is a 10pt stripe of page background down the right of
   * a photograph, which is what it looked like on the Today hero.
   *
   * Only for a screen whose *content* owns the full width. Everything inside
   * still has to put the gutter back for its own text; `PracticeHero` does
   * that for the type it writes across the photograph.
   */
  bleed?: boolean;
  /**
   * The footer's ground.
   *
   * `page` is the default and the app's usual bottom bar: the ivory carried
   * down behind a hairline, the way the tab bar does it. `surface` lifts it
   * onto the card colour, for a screen whose footer is a control area you work
   * in rather than a single action you finish with.
   */
  footerTone?: 'page' | 'surface';
  /**
   * How much of the top of this screen's content is a dark ground, in points.
   *
   * For a screen whose own content — a photograph, a viewfinder — is dark in
   * both appearances, so the floating chrome over it has to be dark too. The
   * height rather than a flag, because the chrome is only over it until the
   * screen scrolls; `chromeTone.ts` holds that rule and the measurements that
   * made it necessary.
   *
   * Omit it and the chrome takes the appearance's own glass, which is right
   * for every screen whose ground is the app's page.
   */
  darkGround?: number;
}

/**
 * The shared screen shell: warm page background, top safe-area inset, and the
 * standard horizontal gutter.
 *
 * Only the top edge is claimed here — the tab bar handles the bottom inset, so
 * claiming it twice would double the gap.
 */
export function ScreenContainer({
  children,
  scrollable = true,
  contentStyle,
  footer,
  onRefresh,
  bleed = false,
  footerTone = 'page',
  darkGround,
}: ScreenContainerProps) {
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await onRefresh?.();
    } finally {
      setRefreshing(false);
    }
  }
  // The context tells us *whether* a tab bar is below us — it's absent on
  // screens pushed above the tabs, like Practice. It does not tell us how
  // tall ours is: with a custom `tabBar` React Navigation publishes its own
  // 49pt default rather than measuring what we render. So take presence from
  // the context and the height from the bar's own tokens.
  const hasTabBar = useContext(BottomTabBarHeightContext) != null;
  const tabBarHeight = useTabBarHeight();
  const insets = useSafeAreaInsets();
  const barHeight = hasTabBar ? tabBarHeight : 0;

  // The footer's rule marks content passing underneath. With nothing to
  // scroll there's nothing to divide, so it stays hidden and the action sits
  // on the page like any other.
  const [overflows, setOverflows] = useState(false);
  const viewportHeight = useRef(0);
  const contentHeight = useRef(0);

  // **What is behind the tab bar, reported as it changes.** Only a screen with
  // a dark ground has anything to say here; for every other one `darkGround`
  // is undefined, `reportTone` is never called from the scroll handler, and
  // the context keeps its `auto` default.
  const reportTone = useChromeToneReporter();
  const chromeMidline = useTabBarMidline(useWindowDimensions().height);
  const toneFor = useCallback(
    (scrollY: number) =>
      chromeToneFor({ scrollY, darkGroundHeight: darkGround ?? 0, chromeMidline }),
    [darkGround, chromeMidline],
  );

  // **Cleared on blur, and that is not belt-and-braces.** React Navigation
  // keeps a tab's screen mounted when you leave it, so a screen that reported
  // `onDark` and then went quiet would hand its material to Library, Insights
  // and Profile — a dark capsule on an ivory page, which is the exact defect
  // this whole mechanism exists to fix. Re-reported on focus from the top,
  // because a tab that is returned to has its old offset.
  const scrollY = useRef(0);
  useFocusEffect(
    useCallback(() => {
      reportTone(toneFor(scrollY.current));
      return () => reportTone('auto');
    }, [reportTone, toneFor]),
  );

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    scrollY.current = event.nativeEvent.contentOffset.y;
    if (darkGround !== undefined) {
      reportTone(toneFor(scrollY.current));
    }
  }

  function measureOverflow() {
    if (!footer) {
      return;
    }
    const next = contentHeight.current > viewportHeight.current + 1;
    setOverflows((current) => (current === next ? current : next));
  }

  // A footer ends the scroll area early, so content scrolls clear of it on its
  // own — no measuring, and no padding that has to be kept in sync with
  // whatever the footer holds. Without one the content still has to clear the
  // tab bar itself, since that bar overlays the screen.
  const bottomInset = {
    paddingBottom: spacing['2xl'] + (footer ? 0 : Math.max(barHeight, insets.bottom)),
  };

  // The footer takes over the bottom edge: the home indicator on a phone that
  // has one, the tab bar on the rare screen that has both.
  const footerInset = {
    paddingBottom: hasTabBar
      ? tabBarHeight
      : Math.max(insets.bottom, spacing.lg),
  };

  const scrollArea = scrollable ? (
    <ScrollView
      style={[styles.flex, WEB_SCROLL_STYLE, bleed ? WEB_NO_GUTTER : null]}
      directionalLockEnabled
      decelerationRate="normal"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={[
        styles.content,
        bleed ? styles.contentBleed : null,
        bottomInset,
        contentStyle,
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
            // The spinner is chrome, so it takes the accent rather than the
            // platform's default blue.
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        ) : undefined
      }
      onLayout={(event) => {
        viewportHeight.current = event.nativeEvent.layout.height;
        measureOverflow();
      }}
      onScroll={handleScroll}
      // 16ms so the flip lands within a frame of the capsule crossing the
      // ground's edge. It sets state only when the tone actually changes, so
      // the cost of a tighter interval is the handler, not a re-render.
      scrollEventThrottle={16}
      onContentSizeChange={(_width, height) => {
        contentHeight.current = height;
        measureOverflow();
      }}
    >
      {children}
    </ScrollView>
  ) : (
    // **`bleed` counts here too.** It was only read on the scrolling branch,
    // so a full-bleed screen that does not scroll — Today — kept the 20pt
    // gutter and drew a stripe of page background down each side of a
    // photograph. The scrollbar half of `bleed` has nothing to do here: there
    // is no scroll view to reserve a gutter in.
    <View
      style={[
        styles.flex,
        styles.content,
        bleed ? styles.contentBleed : null,
        bottomInset,
        contentStyle,
      ]}
    >
      {children}
    </View>
  );

  return (
    // `edges={['top']}` pads by the inset the device actually reports, so a
    // Dynamic Island (59pt), an older notch (47pt), and a flat-top phone
    // (20pt) each get the right gap with no per-device branching. The bar
    // below owns the bottom inset; claiming it here too would double it.
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {scrollArea}

      {footer ? (
        // Same construction as the tab bar: page background behind a hairline
        // rule, not a raised surface. Content passes above the rule and stops.
        <View
          style={[
            styles.footer,
            footerTone === 'surface' ? styles.footerSurface : null,
            overflows ? styles.footerDivided : null,
            footerInset,
          ]}
        >
          <View style={styles.footerRow}>{footer}</View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

/**
 * The horizontal gutter, exported so full-bleed sections can cancel it out.
 *
 * 24, from the redesign (2026-09-23), which sets every screen at 24 — it was
 * 20. One margin for the whole app is design law 5, so it moves here rather
 * than screen by screen.
 */
export const SCREEN_GUTTER = spacing['2xl'];

/**
 * How wide the column of content is allowed to get.
 *
 * A reading measure. This is a phone product built to the web as well, and a
 * laptop browser will happily set a piece title in 36pt serif across two
 * thousand pixels if nothing stops it.
 */
export const CONTENT_MAX_WIDTH = 560;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  /** No gutter: a `bleed` screen's own content puts it back where it wants it. */
  contentBleed: { paddingHorizontal: 0 },
  content: {
    paddingHorizontal: SCREEN_GUTTER,
    // **A reading measure, on every screen.**
    //
    // This app is a phone product and it is also the web build on Cloudflare
    // Pages, so a laptop browser gave every row the full two thousand pixels:
    // a piece title in 36pt serif running the width of a desk, a deviation bar
    // two thousand pixels long, a library row whose composer sat a foot from
    // its title. A printed page has a measure for the same reason.
    //
    // Here rather than on each screen so no screen has to remember. Screens
    // that set their own `contentStyle` still win, which is what that prop is
    // for.
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    /**
     * **So a child can ask for the height that is left.**
     *
     * A `ScrollView`'s content container is sized by its content, so `flex: 1`
     * on a child of it does nothing — which is why every screen-level
     * `EmptyState` sat in the top quarter with the rest of the screen blank
     * beneath it. `flexGrow` makes the container at least a viewport tall and
     * changes nothing else: with no `justifyContent` here, shorter content
     * still stacks from the top and longer content still scrolls.
     */
    flexGrow: 1,
  },
  /**
   * The footer holds the measure too.
   *
   * It sits outside the scroll area, so it does not inherit `content` — and a
   * full-width action bar under a 560pt column reads as a different screen's
   * furniture. The background still spans the window, because a bar that stops
   * short of the edges is a floating card, and §3 law 9 is explicit that this
   * is app furniture.
   */
  footerRow: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
  footer: {
    backgroundColor: colors.bg,
    // The border is always laid out and only ever changes colour. Toggling its
    // width would resize the footer, which resizes the scroll area, which can
    // flip the overflow test that drew it — content within a point of filling
    // the screen would sit there oscillating.
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: 'transparent',
    paddingHorizontal: SCREEN_GUTTER,
    paddingTop: spacing.lg,
  },
  footerSurface: {
    backgroundColor: colors.surface,
    // Always drawn on this tone: the surface is what marks the control area
    // off, and it needs an edge whether or not the content above scrolls.
    borderTopColor: colors.border,
  },
  footerDivided: {
    borderTopColor: colors.border,
  },
});

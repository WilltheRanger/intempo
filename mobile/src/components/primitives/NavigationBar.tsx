import { NavigationContext, useIsFocused } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useContext, useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';

import {
  BORDER_WIDTH,
  colors,
  EASE_OUT,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  MIN_TOUCH_TARGET,
  motion,
  spacing,
} from '../../design';
import { useReducedMotion } from '../../lib/useReducedMotion';
import { NAV_BAR_HEIGHT, type BarAppearance } from '../../navigation/navigationBar';
import type { BackButton } from '../../navigation/useGoBack';
import { ChevronLeft, type LucideIcon } from '../icons';
import { MenuButton, type MenuItem } from '../overlays/Menu';
import { IconButton } from './IconButton';
import { Text } from './Text';

/** A glyph on the bar's trailing side: a press, or a menu of choices (the •••). */
export type BarAction = {
  icon: LucideIcon;
  /** Required: a glyph alone tells a screen reader nothing. */
  label: string;
  disabled?: boolean;
} & ({ onPress: () => void; menu?: never } | { menu: readonly MenuItem[]; onPress?: never });

/** What a screen puts in its navigation bar (`ScreenContainer.navigationBar`). */
export interface NavigationBarConfig {
  /** From `useBackButton`. Left out on a tab's own screen, which has nowhere to go back to. */
  back?: BackButton;
  /** Glyph buttons on the trailing side, in reading order. */
  actions?: readonly BarAction[];
  /**
   * The bar's title when it is not the large title's words — Insights, whose
   * heading is a finding about the musician's playing rather than the screen's
   * name. Otherwise the large title supplies it (`LargeTitle`).
   */
  title?: string;
}

const NATIVE_DRIVER = Platform.OS !== 'web';

/**
 * The navigation bar: back, the screen's title once it has scrolled up into
 * the bar, and the screen's actions — pinned while the page moves under it.
 *
 * **The rules are in `navigation/navigationBar.ts`**: when the bar draws its
 * ground, when the title arrives, and what the back button says. This file is
 * how those look.
 *
 * **A solid ground and a hairline, never glass.** §3 law 6 keeps the material
 * for the tab bar alone (2026-09-20), so the bar's ground is the page's own
 * paper with the app's hairline under it — what UIKit draws on scroll, made
 * of this app's materials. At rest it draws nothing at all: the words of the
 * bar sit on the page or on the photograph like any other words.
 *
 * **Gold is the back button's colour** because gold means a word can be
 * tapped (`TextAction`), and that is the job iOS gives a bar button's tint.
 * The glyphs stay ink, as they are everywhere else in the app.
 */
export function NavigationBar({
  config,
  title,
  appearance,
  insetTop,
  overlay,
}: {
  config: NavigationBarConfig;
  /** The words for the middle of the bar, or null for none. */
  title: string | null;
  appearance: BarAppearance;
  /** The status bar's height, on a screen whose photograph runs up under it. */
  insetTop: number;
  /**
   * Laid over the top of the scroll view instead of above it: for a screen
   * whose photograph runs up under the bar. Everywhere else the bar takes its
   * own 44 points and the page starts below it, which leaves every screen's
   * own padding exactly as it was.
   */
  overlay: boolean;
}) {
  const { back, actions = [] } = config;
  const tone = appearance.tone;
  const ground = useFade(appearance.solid);
  const titleFade = useFade(appearance.showTitle && title !== null);
  // Signing in reads a legal document outside the navigator, where there is no
  // screen to be focused and asking would throw.
  const isScreen = useContext(NavigationContext) !== undefined;
  const statusBar = tone === 'onDark' ? 'light' : 'dark';

  /*
    **The title is centred on the bar, between whichever side is wider.** UIKit
    centres it on the screen and lets it run until it would touch either side.
    Measured rather than reserved, because "‹ Your takes" and a single "+" are
    a hundred points apart and a fixed reservation would truncate titles that
    fit.
  */
  const [leading, setLeading] = useState(0);
  const [trailing, setTrailing] = useState(0);
  const side = Math.max(leading, trailing) + spacing.xs;

  const words = tone === 'onDark' ? 'onDark' : 'accentText';

  return (
    <View
      style={[
        overlay ? styles.overlay : null,
        { paddingTop: insetTop, height: insetTop + NAV_BAR_HEIGHT },
      ]}
      // Drawn before the scroll view either way, which puts it first in the
      // order a keyboard and a screen reader meet things.
    >
      <Animated.View pointerEvents="none" style={[styles.ground, { opacity: ground }]} />

      <View style={styles.row}>
        <View style={styles.leading} onLayout={(e) => setLeading(e.nativeEvent.layout.width)}>
          {back ? (
            <Pressable
              onPress={back.onPress}
              accessibilityRole="button"
              accessibilityLabel={back.accessibilityLabel}
              style={({ pressed }) => [styles.back, pressed && styles.pressed]}
            >
              <ChevronLeft
                size={ICON_SIZE.lg}
                strokeWidth={ICON_STROKE_WIDTH}
                color={tone === 'onDark' ? colors.onDark : colors.accentText}
                style={styles.chevron}
              />
              <Text variant="body" color={words} numberOfLines={1}>
                {back.label}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/*
          The title repeats the large title the screen still has in its
          content, so it is the screen's name a second time: hidden from a
          screen reader, which has already read the heading, and from the
          browser's title, which reads the heading too (`documentTitle.ts`).
        */}
        <Animated.View
          pointerEvents="none"
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.title,
            { left: side, right: side, opacity: titleFade },
          ]}
        >
          {title ? (
            <Text variant="barTitle" numberOfLines={1} style={styles.titleText}>
              {title}
            </Text>
          ) : null}
        </Animated.View>

        <View style={styles.trailing} onLayout={(e) => setTrailing(e.nativeEvent.layout.width)}>
          {actions.map((action) =>
            action.menu ? (
              <MenuButton
                key={action.label}
                icon={action.icon}
                label={action.label}
                items={action.menu}
                tone={tone}
              />
            ) : (
              <IconButton
                key={action.label}
                icon={action.icon}
                label={action.label}
                onPress={action.onPress}
                disabled={action.disabled}
                variant="bare"
                tone={tone}
              />
            ),
          )}
        </View>
      </View>

      {/*
        The clock over a photograph is ivory, and over paper it is ink. Only
        while this screen is in front: a screen underneath does not get a say.
      */}
      {isScreen ? <StatusBarWhileFocused style={statusBar} /> : <StatusBar style={statusBar} />}
    </View>
  );
}

/** Its own component so `useIsFocused` runs only inside a navigator. */
function StatusBarWhileFocused({ style }: { style: 'light' | 'dark' }) {
  return useIsFocused() ? <StatusBar style={style} /> : null;
}

/**
 * 0 or 1, faded between: UIKit crossfades the bar's ground and title rather
 * than sliding them. Instant under Reduce Motion.
 */
function useFade(visible: boolean): Animated.Value {
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(visible ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) {
      value.setValue(visible ? 1 : 0);
      return undefined;
    }
    const animation = Animated.timing(value, {
      toValue: visible ? 1 : 0,
      duration: motion.fast,
      easing: EASE_OUT,
      useNativeDriver: NATIVE_DRIVER,
    });
    animation.start();
    return () => animation.stop();
  }, [reduced, value, visible]);
  return value;
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
  },
  /**
   * The page's paper and the app's hairline: the bar is part of the page that
   * the content scrolls under, not a panel laid over it.
   */
  ground: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.bg,
    borderBottomWidth: BORDER_WIDTH,
    borderBottomColor: colors.border,
  },
  row: {
    height: NAV_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // The glyphs' own whitespace brings the chevron and the last action in to
    // about 17pt from the edges, just outside the 24pt column of text — where
    // UIKit puts a bar's items against its title column.
    paddingHorizontal: spacing.sm,
  },
  leading: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    height: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    paddingRight: spacing.sm,
  },
  // Lucide draws the chevron in the left half of its box; the box's right
  // half would leave a gap before the word that no platform's back button has.
  chevron: {
    marginRight: -spacing.xs,
  },
  // The dim every word-sized control uses under the finger (`TextAction`).
  pressed: {
    opacity: 0.55,
  },
  title: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleText: {
    textAlign: 'center',
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});

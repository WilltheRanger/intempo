import { useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BORDER_WIDTH,
  colors,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  SPRING,
} from '../../design';
import { useReducedMotion } from '../../lib/useReducedMotion';
import type { LucideIcon } from '../icons';
import { IconButton } from '../primitives/IconButton';
import { Text } from '../primitives/Text';
import { DismissArea } from './DismissArea';
import { originOffset, placeMenu, type Rect } from './menuPlacement';
import { useInertAppRoot, useReturnFocus } from './modalAccessibility';
import { useOverlayPresence } from './useOverlayPresence';

/** One choice in a menu. */
export interface MenuItem {
  label: string;
  /** Drawn on the trailing side of the row, as UIKit draws a menu's symbols. */
  icon?: LucideIcon;
  /** A second, smaller line under the label — UIKit's menu subtitle. */
  detail?: string;
  onPress: () => void;
}

/** How small a menu starts as it grows from its corner, as UIKit's does. */
const ENTER_SCALE = 0.8;

const NATIVE_DRIVER = Platform.OS !== 'web';

/** A row's height in the layout the placement is worked out from. */
const ROW_HEIGHT = MIN_TOUCH_TARGET;
/** A row with a second line: the label's and the detail's line heights, and the row's air. */
const DETAILED_ROW_HEIGHT = 20 + 18 + spacing.lg;

function rowHeight(item: MenuItem): number {
  return item.detail ? DETAILED_ROW_HEIGHT : ROW_HEIGHT;
}

/**
 * A pull-down menu, opened from the control that asked for it.
 *
 * **Where a finger already is, not across the bottom of the screen.** UIKit
 * opens a control's choices in a menu beside it — the bar's •••, a long press
 * on something in a list — and keeps the sheet for a task with room in it.
 * The placement is `menuPlacement.ts`'s, with tests.
 *
 * **The app's own materials** (§3 law 6): the card white and a hairline, at
 * the field and choice radius (`radii.md`), not UIKit's blurred glass, which
 * this app keeps for the tab bar alone. It grows from the corner nearest the
 * control on the app's spring and leaves faster than it came, as UIKit's
 * does. Nothing behind it is dimmed: a pull-down menu is a quick choice, not a
 * question that stops the screen.
 *
 * It is a modal for focus the way the sheets are (`modalAccessibility`): the
 * app behind is inert while it is open, and focus goes back to the control
 * that opened it when it closes.
 */
export function Menu({
  visible,
  anchor,
  items,
  onClose,
  label,
}: {
  visible: boolean;
  /** The control's rectangle in the window, measured when it was pressed. */
  anchor: Rect | null;
  items: readonly MenuItem[];
  onClose: () => void;
  /** What a screen reader calls the menu: the control's own name. */
  label: string;
}) {
  const reduceMotion = useReducedMotion();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { mounted, progress } = useOverlayPresence(visible, reduceMotion, (value) =>
    Animated.spring(value, { toValue: 1, ...SPRING, useNativeDriver: NATIVE_DRIVER }),
  );
  useInertAppRoot(mounted);
  useReturnFocus(mounted);

  if (!mounted || !anchor) {
    return null;
  }

  const height =
    items.reduce((sum, item) => sum + rowHeight(item), 0) +
    Math.max(0, items.length - 1) * BORDER_WIDTH;
  const placed = placeMenu({ anchor, window, insets, height });
  const corner = originOffset(placed.origin, { width: placed.width, height });
  // A scale about a corner: the scale about the centre, plus the corner's
  // share of what the scale took away (`originOffset`).
  const growth = 1 - ENTER_SCALE;
  const transform = [
    { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [corner.x * growth, 0] }) },
    { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [corner.y * growth, 0] }) },
    { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [ENTER_SCALE, 1] }) },
  ];

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.fill}>
        {/* A tap anywhere else closes it, and does nothing else. */}
        <DismissArea onDismiss={onClose} />
        <Animated.View
          accessibilityRole="menu"
          accessibilityLabel={label}
          style={[
            styles.menu,
            {
              left: placed.left,
              top: placed.top,
              width: placed.width,
              opacity: progress,
              transform,
            },
          ]}
        >
          {items.map((item, index) => (
            <Pressable
              key={item.label}
              accessibilityRole="menuitem"
              onPress={() => {
                // The choice and the closing are one moment, as in UIKit: the
                // menu goes as what was chosen begins.
                onClose();
                item.onPress();
              }}
              style={({ pressed }) => [
                styles.row,
                { minHeight: rowHeight(item) },
                index > 0 && styles.divided,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.label}>
                <Text variant="body" numberOfLines={1}>
                  {item.label}
                </Text>
                {item.detail ? (
                  <Text variant="metadataSmall" color="textSecondary" numberOfLines={1}>
                    {item.detail}
                  </Text>
                ) : null}
              </View>
              {item.icon ? (
                <item.icon
                  size={ICON_SIZE.md}
                  strokeWidth={ICON_STROKE_WIDTH}
                  color={colors.textPrimary}
                />
              ) : null}
            </Pressable>
          ))}
        </Animated.View>
      </View>
    </Modal>
  );
}

/**
 * A bare glyph that opens a menu: the navigation bar's •••.
 *
 * It measures itself when pressed, so the menu opens from where it is even
 * after the page under it has scrolled.
 */
export function MenuButton({
  icon,
  label,
  items,
  tone = 'auto',
}: {
  icon: LucideIcon;
  label: string;
  items: readonly MenuItem[];
  tone?: 'auto' | 'onDark';
}) {
  const ref = useRef<View>(null);
  const [open, setOpen] = useState(false);
  // Kept after closing, so the menu can leave from where it opened.
  const [anchor, setAnchor] = useState<Rect | null>(null);

  return (
    <>
      <View ref={ref} collapsable={false}>
        <IconButton
          icon={icon}
          label={label}
          variant="bare"
          tone={tone}
          onPress={() => {
            ref.current?.measureInWindow((x, y, width, height) => {
              setAnchor({ x, y, width, height });
              setOpen(true);
            });
          }}
        />
      </View>
      <Menu
        visible={open}
        anchor={anchor}
        items={items}
        label={label}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  menu: {
    position: 'absolute',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    overflow: 'hidden',
    // Above the dismiss area whatever the DOM order, as the dialog is: on the
    // web a positioned sibling paints over an unpositioned one.
    zIndex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  divided: {
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
  label: {
    flex: 1,
  },
});

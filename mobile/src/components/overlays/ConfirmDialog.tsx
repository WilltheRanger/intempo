import { Animated, Modal, Platform, StyleSheet, View } from 'react-native';

import {
  colors,
  DIALOG_ENTER_SCALE,
  radii,
  spacing,
  SPRING,
} from '../../design';
import { useReducedMotion } from '../../lib/useReducedMotion';
import { PrimaryButton } from '../primitives/PrimaryButton';
import { SecondaryButton } from '../primitives/SecondaryButton';
import { Text } from '../primitives/Text';
import { DismissArea } from './DismissArea';
import { useInertAppRoot, useReturnFocus } from './modalAccessibility';
import { useOverlayPresence } from './useOverlayPresence';

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  /** One or two sentences on what happens. Say the consequence, not the verb. */
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Asks before something that can't be taken back.
 *
 * A card on a scrim, in the app's own type and colour, rather than the system
 * `Alert` — `Alert` renders nothing on web, which is the only place this build
 * can be driven, and it would be the one piece of UI in the app wearing the
 * platform's styling instead of ours.
 *
 * Cancel leads and sits on the left: the dialog exists for the moment someone
 * arrived here by accident.
 *
 * **It grows into place.** This was `animationType="fade"`, so the card
 * cross-faded at a fixed size and read as having been behind the scrim the
 * whole time — the one modal in the app that arrives without saying it just
 * arrived, next to a sheet that rises and a screen that pushes. The entrance is
 * hand-animated for the same reason `BottomSheet`'s is: `Modal`'s built-in
 * types cannot move the card and the scrim on different curves.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const reduceMotion = useReducedMotion();
  // A spring in, so the card settles rather than stopping dead; the shared exit
  // is a timing, because an overshoot on the way to gone is motion with nothing
  // left to confirm.
  const { mounted, progress } = useOverlayPresence(visible, reduceMotion, (value) =>
    Animated.spring(value, {
      toValue: 1,
      useNativeDriver: Platform.OS !== 'web',
      ...SPRING,
    }),
  );

  // Held for the whole enter/exit, not just while `visible` — the web Modal is
  // a portal beside #root, and focus must not slip behind a card still leaving.
  useInertAppRoot(mounted);
  useReturnFocus(mounted);

  if (!mounted) {
    return null;
  }

  // Clamped: the spring overshoots past 1, which is right for the scale and
  // meaningless for opacity.
  const opacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [DIALOG_ENTER_SCALE, 1],
  });

  return (
    <Modal visible transparent animationType="none" onRequestClose={onCancel}>
      <View style={styles.container}>
        {/* Tapping the scrim dismisses, the way a sheet does. */}
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity }]}>
          {/*
            **Pointer dismissal only.** As a button it was an invisible
            full-screen "Dismiss" that took keyboard focus before the dialog's
            real choices and was read out as one of them (2026-10-05); then,
            as a Pressable out of the Tab order, it was still where the focus
            trap put focus on opening (2026-10-06). See `DismissArea`.
          */}
          <DismissArea onDismiss={onCancel} />
        </Animated.View>

        <Animated.View
          style={[styles.dialog, { opacity, transform: [{ scale }] }]}
          accessibilityViewIsModal
        >
          <Text variant="pieceTitle">{title}</Text>
          <Text variant="body" color="textSecondary" style={styles.message}>
            {message}
          </Text>

          {/*
            **The share of the row is on a wrapper, not on the button.** A
            button puts the caller's `style` on its inner view, which sits in a
            column — so `flex: 1` there set a zero basis on the *vertical* axis,
            and on the web a flex basis beats `height`: both buttons drew 22pt
            tall, half the touch minimum (measured 2026-10-05).
          */}
          <View style={styles.actions}>
            <View style={styles.action}>
              <SecondaryButton label={cancelLabel} onPress={onCancel} />
            </View>
            <View style={styles.action}>
              <PrimaryButton label={confirmLabel} onPress={onConfirm} />
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  scrim: {
    backgroundColor: colors.scrim,
  },
  dialog: {
    backgroundColor: colors.bg,
    borderRadius: radii.lg,
    padding: spacing.xl,
    // The scrim is absolutely positioned and this card is not, and on the web
    // build a positioned sibling paints above an unpositioned one whatever the
    // DOM order — without this the scrim covers the dialog and eats its taps.
    zIndex: 1,
  },
  message: {
    marginTop: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  action: {
    flex: 1,
  },
});

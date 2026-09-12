import { Animated, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

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
import { useInertAppRoot } from './modalAccessibility';
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
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          />
        </Animated.View>

        <Animated.View
          style={[styles.dialog, { opacity, transform: [{ scale }] }]}
          accessibilityViewIsModal
        >
          <Text variant="pieceTitle">{title}</Text>
          <Text variant="body" color="textSecondary" style={styles.message}>
            {message}
          </Text>

          <View style={styles.actions}>
            <SecondaryButton
              label={cancelLabel}
              onPress={onCancel}
              style={styles.action}
            />
            <PrimaryButton
              label={confirmLabel}
              onPress={onConfirm}
              style={styles.action}
            />
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

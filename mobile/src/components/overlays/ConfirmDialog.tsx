import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '../../design';
import { PrimaryButton } from '../primitives/PrimaryButton';
import { SecondaryButton } from '../primitives/SecondaryButton';
import { Text } from '../primitives/Text';

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
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      {/* Tapping the scrim dismisses, the way a sheet does. */}
      <Pressable
        style={styles.scrim}
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
      >
        {/* Swallows taps so they don't fall through to the scrim. */}
        <Pressable
          style={styles.dialog}
          accessibilityViewIsModal
          onPress={() => {}}
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
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  dialog: {
    backgroundColor: colors.bg,
    borderRadius: radii.lg,
    padding: spacing.xl,
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

import {
  ArrowDown,
  ArrowUp,
  RotateCcw,
  Trash2,
  type LucideIcon,
} from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { ScoreThumbnail } from '../../components/pieces/ScoreThumbnail';
import { Card } from '../../components/primitives/Card';
import { Text } from '../../components/primitives/Text';
import type { CapturedPage } from '../../data/captureSession';
import {
  colors,
  disabledOpacity,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
} from '../../design';

export interface PageRowProps {
  page: CapturedPage;
  /** 1-based, shown to the user. */
  position: number;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRetake: () => void;
  onDelete: () => void;
}

const THUMBNAIL_WIDTH = 52;
const THUMBNAIL_HEIGHT = 68;

/** One captured page: its image, its place in the order, and what you can do to it. */
export function PageRow({
  page,
  position,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onRetake,
  onDelete,
}: PageRowProps) {
  return (
    <Card padded={false}>
      <View style={styles.row}>
        <ScoreThumbnail source={page.source} style={styles.thumbnail} />

        <Text variant="button" style={styles.position}>
          Page {position}
        </Text>

        <View style={styles.actions}>
          <PageAction
            icon={ArrowUp}
            label={`Move page ${position} up`}
            onPress={onMoveUp}
            disabled={isFirst}
          />
          <PageAction
            icon={ArrowDown}
            label={`Move page ${position} down`}
            onPress={onMoveDown}
            disabled={isLast}
          />
          <PageAction
            icon={RotateCcw}
            label={`Retake page ${position}`}
            onPress={onRetake}
          />
          <PageAction
            icon={Trash2}
            label={`Delete page ${position}`}
            onPress={onDelete}
          />
        </View>
      </View>
    </Card>
  );
}

interface PageActionProps {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

function PageAction({ icon: Icon, label, onPress, disabled }: PageActionProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ pressed }) => [
        styles.action,
        pressed && !disabled && styles.actionPressed,
        disabled && styles.actionDisabled,
      ]}
    >
      <Icon
        size={ICON_SIZE.md}
        strokeWidth={ICON_STROKE_WIDTH}
        color={disabled ? colors.textTertiary : colors.textSecondary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    gap: spacing.md,
  },
  thumbnail: {
    width: THUMBNAIL_WIDTH,
    height: THUMBNAIL_HEIGHT,
  },
  position: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  action: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  actionPressed: {
    backgroundColor: colors.surfacePressed,
  },
  actionDisabled: {
    opacity: disabledOpacity,
  },
});

import { GripVertical, RotateCcw, Trash2, type LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, View, type PanResponderInstance } from 'react-native';

import { ScoreThumbnail } from '../../components/pieces/ScoreThumbnail';
import { Card } from '../../components/primitives/Card';
import { Text } from '../../components/primitives/Text';
import type { CapturedPage } from '../../data/captureSession';
import {
  colors,
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
  total: number;
  dragging: boolean;
  /** Spread onto the drag handle. */
  panHandlers: PanResponderInstance['panHandlers'];
  onRetake: () => void;
  onDelete: () => void;
  /** Keyboard and screen-reader route to reordering, since drag isn't one. */
  onMoveUp: () => void;
  onMoveDown: () => void;
}

const THUMBNAIL_WIDTH = 52;
const THUMBNAIL_HEIGHT = 68;

/** One captured page: its image, its place in the order, and what you can do to it. */
export function PageRow({
  page,
  position,
  total,
  dragging,
  panHandlers,
  onRetake,
  onDelete,
  onMoveUp,
  onMoveDown,
}: PageRowProps) {
  return (
    <Card style={dragging ? styles.lifted : undefined} padded={false}>
      <View
        style={styles.row}
        accessible
        accessibilityLabel={`Page ${position} of ${total}`}
        accessibilityActions={[
          { name: 'moveUp', label: 'Move up' },
          { name: 'moveDown', label: 'Move down' },
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'moveUp') {
            onMoveUp();
          }
          if (event.nativeEvent.actionName === 'moveDown') {
            onMoveDown();
          }
        }}
      >
        <ScoreThumbnail source={page.source} style={styles.thumbnail} />

        <Text variant="button" style={styles.position}>
          Page {position}
        </Text>

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

        <View
          {...panHandlers}
          style={styles.handle}
          accessibilityRole="adjustable"
          accessibilityLabel={`Reorder page ${position}`}
          accessibilityHint="Drag to move this page. Or use the move up and move down actions."
        >
          <GripVertical
            size={ICON_SIZE.md}
            strokeWidth={ICON_STROKE_WIDTH}
            color={dragging ? colors.textPrimary : colors.textTertiary}
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
}

function PageAction({ icon: Icon, label, onPress }: PageActionProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
    >
      <Icon
        size={ICON_SIZE.md}
        strokeWidth={ICON_STROKE_WIDTH}
        color={colors.textSecondary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  lifted: {
    // Elevation without a shadow: the border firms up instead.
    borderColor: colors.borderStrong,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    gap: spacing.sm,
  },
  thumbnail: {
    width: THUMBNAIL_WIDTH,
    height: THUMBNAIL_HEIGHT,
  },
  position: {
    flex: 1,
    marginLeft: spacing.xs,
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
  handle: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

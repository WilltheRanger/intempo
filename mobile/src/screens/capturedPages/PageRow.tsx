import { GripVertical, RotateCcw, Trash2, type LucideIcon } from '../../components/icons';
import { Pressable, StyleSheet, View, type PanResponderInstance } from 'react-native';

import { ScoreThumbnail } from '../../components/pieces/ScoreThumbnail';
import { Card } from '../../components/primitives/Card';
import { Text } from '../../components/primitives/Text';
import type { CapturedPage } from '../../data/captureSession';
import { pageNote } from '../../lib/scan/pageQueue';
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
  /** Open the page at full size, which is the only way to actually review it. */
  onOpen: () => void;
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
  onOpen,
  onRetake,
  onDelete,
  onMoveUp,
  onMoveDown,
}: PageRowProps) {
  const note = pageNote(page);
  return (
    <Card style={dragging ? styles.lifted : undefined} padded={false}>
      <View
        style={styles.row}
        accessible
        accessibilityLabel={
          note ? `Page ${position} of ${total}. ${note}` : `Page ${position} of ${total}`
        }
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
        {/*
          **The one thing this row did not offer was looking at the page.**
          Retake, delete and reorder were all here; the thumbnail beside them
          was inert, at 52x68, under a heading that calls this a review. See
          `PagePreview`.
        */}
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={`View page ${position} full size`}
          style={({ pressed }) => [styles.thumbnailPress, pressed && styles.thumbnailPressed]}
        >
          <ScoreThumbnail source={page.source} style={styles.thumbnail} />
        </Pressable>

        {/*
          **The condition, where the page is, before anything is sent.** The
          scanner measures every photograph it takes and the finding used to
          live and die on that screen, so a page the app had already decided it
          could not read queued up looking like every other one. Only a page
          worth another look says anything — see `pageQueue.ts`, which owns the
          rule and the wording.
        */}
        <View style={styles.position}>
          <Text variant="button">Page {position}</Text>
          {note ? (
            <Text variant="metadataSmall" color="accentText" style={styles.note}>
              {note}
            </Text>
          ) : null}
        </View>

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
  thumbnailPress: {
    borderRadius: radii.sm,
    overflow: 'hidden',
  },
  // A tap gets an immediate response, before the sheet it opens arrives —
  // `CLAUDE.md` §3. Opacity rather than scale: the target is small.
  thumbnailPressed: {
    opacity: 0.7,
  },
  thumbnail: {
    width: THUMBNAIL_WIDTH,
    height: THUMBNAIL_HEIGHT,
  },
  position: {
    flex: 1,
    marginLeft: spacing.xs,
  },
  note: {
    marginTop: 2,
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

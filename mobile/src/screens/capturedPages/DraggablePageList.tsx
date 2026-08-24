import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import type { CapturedPage } from '../../data/captureSession';
import { motion, spacing } from '../../design';
import { reorderTarget, slotOffsetFor, type DragOutcome } from '../../lib/scan/drag';
import { useReducedMotion } from '../../lib/useReducedMotion';
import { PageRow } from './PageRow';

const GAP = spacing.md;
/** Used until the first row reports its real height. */
const ESTIMATED_ROW_HEIGHT = 86;

export interface DraggablePageListProps {
  pages: CapturedPage[];
  onReorder: (id: string, toIndex: number) => void;
  onRetake: (page: CapturedPage, index: number) => void;
  onDelete: (id: string) => void;
  onNudge: (id: string, direction: -1 | 1) => void;
}

/**
 * The captured pages, reorderable by dragging a row's handle.
 *
 * Built on PanResponder and Animated rather than a gesture library: the list
 * is short, every row is the same height, and adding Reanimated to a working
 * project for one interaction is a poor trade. Rows the dragged one passes
 * slide out of its way, so the drop position is visible before release.
 *
 * Dragging is not an accessible gesture, so every row also exposes move-up and
 * move-down accessibility actions.
 */
export function DraggablePageList({
  pages,
  onReorder,
  onRetake,
  onDelete,
  onNudge,
}: DraggablePageListProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [slotOffset, setSlotOffset] = useState(0);
  const pitch = useRef(ESTIMATED_ROW_HEIGHT + GAP);

  function handleRowLayout(event: LayoutChangeEvent) {
    pitch.current = event.nativeEvent.layout.height + GAP;
  }

  return (
    <View style={styles.list}>
      {pages.map((page, index) => (
        <DraggableRow
          key={page.id}
          page={page}
          index={index}
          total={pages.length}
          activeIndex={activeIndex}
          slotOffset={slotOffset}
          pitch={pitch}
          onLayout={index === 0 ? handleRowLayout : undefined}
          onDragStart={() => {
            setActiveIndex(index);
            setSlotOffset(0);
          }}
          onDragMove={(dy) => {
            const next = slotOffsetFor(dy, pitch.current, index, pages.length);
            setSlotOffset((current) => (current === next ? current : next));
          }}
          onDragEnd={(outcome) => {
            const to = reorderTarget(outcome, index, slotOffset);
            if (to !== null) {
              onReorder(page.id, to);
            }
            setActiveIndex(null);
            setSlotOffset(0);
          }}
          onRetake={() => onRetake(page, index)}
          onDelete={() => onDelete(page.id)}
          onMoveUp={() => onNudge(page.id, -1)}
          onMoveDown={() => onNudge(page.id, 1)}
        />
      ))}
    </View>
  );
}

interface DraggableRowProps {
  page: CapturedPage;
  index: number;
  total: number;
  activeIndex: number | null;
  slotOffset: number;
  pitch: React.RefObject<number>;
  onLayout?: (event: LayoutChangeEvent) => void;
  onDragStart: () => void;
  onDragMove: (dy: number) => void;
  onDragEnd: (outcome: DragOutcome) => void;
  onRetake: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function DraggableRow({
  page,
  index,
  total,
  activeIndex,
  slotOffset,
  pitch,
  onLayout,
  onDragStart,
  onDragMove,
  onDragEnd,
  onRetake,
  onDelete,
  onMoveUp,
  onMoveDown,
}: DraggableRowProps) {
  const reduceMotion = useReducedMotion();
  const dragY = useRef(new Animated.Value(0)).current;
  const shiftY = useRef(new Animated.Value(0)).current;
  const isActive = activeIndex === index;

  // Latest callbacks, so the responder can stay stable across renders.
  const handlers = useRef({ onDragStart, onDragMove, onDragEnd });
  handlers.current = { onDragStart, onDragMove, onDragEnd };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dy) > 2,
        onPanResponderGrant: () => handlers.current.onDragStart(),
        onPanResponderMove: (_event, gesture) => {
          dragY.setValue(gesture.dy);
          handlers.current.onDragMove(gesture.dy);
        },
        // A drag in progress is not up for grabs. Without this the default
        // applies and the responder is surrendered on request — and this list
        // sits inside `ScreenContainer`'s ScrollView, which asks.
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: () => {
          dragY.setValue(0);
          handlers.current.onDragEnd('released');
        },
        // Terminate is the gesture being taken away, not finished: refusing
        // the request above does not cover the app going to the background or
        // a call arriving. The row goes back where it was rather than
        // committing a move the musician never completed.
        onPanResponderTerminate: () => {
          dragY.setValue(0);
          handlers.current.onDragEnd('cancelled');
        },
      }),
    [dragY],
  );

  // How far this row steps aside for the one being dragged.
  const displacement = (() => {
    if (activeIndex === null || isActive) {
      return 0;
    }
    const target = activeIndex + slotOffset;
    if (activeIndex < target && index > activeIndex && index <= target) {
      return -1;
    }
    if (activeIndex > target && index < activeIndex && index >= target) {
      return 1;
    }
    return 0;
  })();

  useEffect(() => {
    const toValue = displacement * pitch.current;

    // No drag in progress means the list has just settled into its real
    // order, and this row is already laid out in its final slot. Animating a
    // leftover offset back to zero would slide it across the neighbour now
    // occupying that space — the rows visibly overlap for the duration.
    // Drop the offset instantly instead; the layout already moved.
    if (reduceMotion || activeIndex === null) {
      shiftY.stopAnimation();
      shiftY.setValue(toValue);
      return;
    }

    const animation = Animated.timing(shiftY, {
      toValue,
      duration: motion.fast,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [activeIndex, displacement, pitch, reduceMotion, shiftY]);

  return (
    <Animated.View
      onLayout={onLayout}
      style={[
        isActive ? styles.active : null,
        { transform: [{ translateY: isActive ? dragY : shiftY }] },
      ]}
    >
      <PageRow
        page={page}
        position={index + 1}
        total={total}
        dragging={isActive}
        panHandlers={responder.panHandlers}
        onRetake={onRetake}
        onDelete={onDelete}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: GAP,
  },
  active: {
    zIndex: 2,
  },
});

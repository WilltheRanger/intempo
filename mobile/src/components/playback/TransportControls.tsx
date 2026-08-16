import { Pause, Play, SkipBack, SkipForward } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  colors,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  MIN_TOUCH_TARGET,
  spacing,
} from '../../design';
import { IconButton } from '../primitives/IconButton';

export interface TransportControlsProps {
  isPlaying: boolean;
  onTogglePlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
  /** What the step buttons move through, for screen readers. */
  unit?: string;
}

/**
 * Step back, play/pause, step forward.
 *
 * Playback is mocked everywhere this appears — these move a position marker
 * and make no sound. The audio engine plugs in behind `onTogglePlay` without
 * the control changing.
 */
export function TransportControls({
  isPlaying,
  onTogglePlay,
  onPrevious,
  onNext,
  previousDisabled = false,
  nextDisabled = false,
  unit = 'measure',
}: TransportControlsProps) {
  return (
    <View style={styles.row}>
      <IconButton
        icon={SkipBack}
        label={`Previous ${unit}`}
        onPress={onPrevious}
        disabled={previousDisabled}
      />

      <Pressable
        onPress={onTogglePlay}
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
        accessibilityState={{ selected: isPlaying }}
        style={({ pressed }) => [styles.play, pressed && styles.playPressed]}
      >
        {isPlaying ? (
          <Pause
            size={ICON_SIZE.md}
            strokeWidth={ICON_STROKE_WIDTH}
            color={colors.actionText}
          />
        ) : (
          <Play
            size={ICON_SIZE.md}
            strokeWidth={ICON_STROKE_WIDTH}
            color={colors.actionText}
          />
        )}
      </Pressable>

      <IconButton
        icon={SkipForward}
        label={`Next ${unit}`}
        onPress={onNext}
        disabled={nextDisabled}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  play: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    backgroundColor: colors.actionBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playPressed: {
    backgroundColor: colors.actionBgPressed,
  },
});

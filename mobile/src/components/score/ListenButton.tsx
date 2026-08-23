import { Pause, Play } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../primitives/Text';
import type { ScoreJson } from '../../data/types';
import {
  BORDER_WIDTH,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  colors,
  radii,
  spacing,
} from '../../design';
import { impact, ImpactFeedbackStyle } from '../../lib/haptics';
import { scheduleScore, type PlaybackHandle } from '../../lib/score';
import { playSchedule } from '../../lib/scorePlayer';

export interface ListenButtonProps {
  score: ScoreJson | null;
  bpm: number;
  /** Locked during a take. */
  disabled?: boolean;
  /**
   * Where the playhead is, about once a frame, and `(0, 0)` when it stops.
   *
   * For a caller that wants to say something about the position this button is
   * already tracking — which measure is sounding, say. The button keeps
   * drawing its own progress line either way; this doesn't replace it, and a
   * caller that doesn't need the numbers omits it.
   */
  onProgress?: (elapsedS: number, totalS: number) => void;
}

/**
 * Hear the piece at the tempo you're about to play it at.
 *
 * Before the take, never during: §4 is unambiguous that anything through the
 * speaker while recording lands in the microphone as phantom onsets and
 * corrupts the analysis. So this disables itself the moment recording starts,
 * and stops anything already sounding.
 *
 * Shared rather than owned by the record screen, which is where it was built.
 * The score screen needs the same control for a different reason — hearing
 * what OCR read back is the fastest way to catch a bar it got wrong — and two
 * copies of a playback button would drift.
 *
 * A progress line rather than a timer. The question being answered is "how far
 * through is it", and a line answers that without adding a second number to a
 * screen that already shows a tempo and a clock.
 */
export function ListenButton({
  score,
  bpm,
  disabled = false,
  onProgress,
}: ListenButtonProps) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const handle = useRef<PlaybackHandle | null>(null);

  // Read through a ref inside the callbacks below: `stop` runs from an unmount
  // effect with no dependency list, so capturing the prop directly would pin
  // the first render's copy for the life of the component.
  const report = useRef(onProgress);
  report.current = onProgress;

  function stop() {
    handle.current?.stop();
    handle.current = null;
    setPlaying(false);
    setProgress(0);
    report.current?.(0, 0);
  }

  // Leaving the screen, or starting a take, must silence it. A note still
  // sounding into a recording is the exact failure this guards against.
  useEffect(() => stop, []);
  useEffect(() => {
    if (disabled) {
      stop();
    }
  }, [disabled]);

  if (!score || score.measures.length === 0) {
    return null;
  }

  function toggle() {
    if (playing) {
      impact(ImpactFeedbackStyle.Light);
      stop();
      return;
    }

    impact(ImpactFeedbackStyle.Light);
    const schedule = scheduleScore(score as ScoreJson, bpm);
    if (schedule.notes.length === 0) {
      return;
    }

    setPlaying(true);
    setProgress(0);
    handle.current = playSchedule(schedule, {
      onProgress: (elapsed, total) => {
        setProgress(total > 0 ? elapsed / total : 0);
        report.current?.(elapsed, total);
      },
      onEnd: () => {
        handle.current = null;
        setPlaying(false);
        setProgress(0);
        report.current?.(0, 0);
      },
    });
  }

  return (
    <Pressable
      onPress={toggle}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={playing ? 'Stop listening' : 'Listen at this tempo'}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {playing ? (
        <Pause
          size={ICON_SIZE.sm}
          strokeWidth={ICON_STROKE_WIDTH}
          color={colors.textPrimary}
          fill={colors.textPrimary}
        />
      ) : (
        <Play
          size={ICON_SIZE.sm}
          strokeWidth={ICON_STROKE_WIDTH}
          color={colors.textPrimary}
          fill={colors.textPrimary}
        />
      )}
      <Text variant="metadataSmall">{playing ? 'Stop' : 'Listen'}</Text>

      {/* Sits inside the control's border rather than under it, so the button
          keeps one outline instead of growing a second element beneath it. */}
      <View style={styles.track} pointerEvents="none">
        <View style={[styles.fill, { width: `${Math.min(1, progress) * 100}%` }]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    // A 44pt row: this is a real target, not a caption.
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
  disabled: {
    opacity: 0.4,
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
  },
  fill: {
    height: 2,
    backgroundColor: colors.accent,
  },
});

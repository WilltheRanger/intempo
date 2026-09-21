import { Pause, Play } from '../icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { warmPlayback } from '../../lib/score/warmPlayback';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../primitives/Text';
import type { ScoreJson } from '../../data/types';
import {
  BORDER_WIDTH,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  MIN_TOUCH_TARGET,
  colors,
  disabledOpacity,
  radii,
  spacing,
} from '../../design';
import { impact, ImpactFeedbackStyle } from '../../lib/haptics';
import {
  scheduleScore,
  startAtMeasure,
  voiceForInstrument,
  type PlaybackHandle,
} from '../../lib/score';
import { usePreferences } from '../../data/preferences';
import { playSchedule } from '../../lib/scorePlayer';
import { INSTRUMENT_LABELS } from '../../lib/warmup';
import { ROW_PADDING_VERTICAL } from '../rowMetrics';

export interface ListenButtonProps {
  score: ScoreJson | null;
  bpm: number;
  /**
   * Which bar to enter on. The first bar of the piece unless said.
   *
   * A whole movement is a long way to sit through to check bar 40, and
   * repeating a passage is what practice *is*. `startAtMeasure` trims the
   * schedule rather than the score, which is what makes a repeated bar mean
   * the first time it comes round.
   */
  fromMeasure?: number;
  /** Locked during a take. */
  disabled?: boolean;
  /**
   * How this draws itself.
   *
   * `button` is the bordered control the score reader uses, where it is the
   * only thing on its line and a box is what marks it as tappable.
   *
   * `row` is the record panel, where it is the fourth of five settings rows
   * and a box around one of them is the odd one out. Measured on a built app
   * before the change: the panel put a stepper, two ruled rows, a bordered
   * pill and two unruled lines of small type in one column, with gaps of 44,
   * 29, 40, 11 and 2 points between them. A row here is what makes the last
   * three of those numbers the same as the first two.
   *
   * A density rather than a second component, for the reason `TempoStepper`
   * gives: the playback wiring, the warm-up, the focus cleanup and the
   * progress reporting are the component, and two copies of them is how one
   * stops being fixed.
   */
  density?: 'button' | 'row';
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
  fromMeasure,
  disabled = false,
  onProgress,
  density = 'button',
}: ListenButtonProps) {
  const { instrument } = usePreferences();
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const handle = useRef<PlaybackHandle | null>(null);

  // Read through a ref inside the callbacks below: `stop` runs from an unmount
  // effect with no dependency list, so capturing the prop directly would pin
  // the first render's copy for the life of the component.
  const report = useRef(onProgress);
  report.current = onProgress;

  const stop = useCallback(() => {
    handle.current?.stop();
    handle.current = null;
    setPlaying(false);
    setLoading(false);
    setProgress(0);
    report.current?.(0, 0);
  }, []);

  // Leaving the screen, or starting a take, must silence it. A note still
  // sounding into a recording is the exact failure this guards against.
  // Stack/tab navigation may keep this component mounted after leaving it.
  // Focus cleanup stops both sounding audio and a pending load/render.
  useFocusEffect(useCallback(() => stop, [stop]));
  useEffect(() => stop, [instrument, score, bpm, fromMeasure, stop]);
  useEffect(() => {
    if (disabled) {
      stop();
    }
  }, [disabled, stop]);

  // **Fetch what Listen needs while the musician is still reading the page.**
  // The tap used to be the first moment anything was downloaded: a 620 KB
  // synthesiser chunk and a ~1 MB instrument bank, both between the press and
  // the first note. The synthesis itself is not the cost — it runs 23–45x
  // faster than real time — so moving the two downloads ahead of the press is
  // the whole of it. See `warmPlayback`, which is idempotent, respects Data
  // Saver, and cannot fail in a way the musician sees.
  //
  // Guarded on `disabled` so a screen that is showing the button but refusing
  // it — no score, mid-recording — does not spend the bandwidth. The score
  // condition repeats the early return below rather than sitting after it: a
  // hook below an early return is React error #310, which this project has
  // shipped before.
  useEffect(() => {
    if (!disabled && score && score.measures.length > 0) {
      warmPlayback(instrument);
    }
  }, [disabled, instrument, score]);

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
    const whole = scheduleScore(score as ScoreJson, bpm);
    const schedule =
      fromMeasure === undefined ? whole : startAtMeasure(whole, fromMeasure);
    if (schedule.notes.length === 0) {
      return;
    }

    setProgress(0);
    setError(null);
    // **The button follows the player, it does not lead it.** `setPlaying(true)`
    // used to run before the schedule was handed over, so a playback that could
    // not start left the label on Stop with nothing sounding — press again and
    // you stop silence, press a third time and it works. That is the shape the
    // owner reported as *"Listen only works on the first listen"*, and it is
    // reachable whenever `playSchedule` declines: no Web Audio at all, or a
    // browser that refuses another context.
    const started = playSchedule(schedule, {
      // **The instrument in the musician's hands.** Every Listen in the app
      // used to play the same four-harmonic reference tone, whoever was
      // holding whatever — which is what the owner meant by "that default
      // computer sound". Read from the device preference rather than the
      // account because it always has a value (`usePreferences`), so there is
      // no screen here that needs a "no instrument yet" branch.
      voice: voiceForInstrument(instrument),
      onLoading: setLoading,
      onError: setError,
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

    // A schedule with nothing playable calls `onEnd` before this line, so read
    // the handle rather than assuming: it is the only thing that knows.
    const sounding = started.isPlaying();
    handle.current = sounding ? started : null;
    setPlaying(sounding);
  }

  const glyph = loading ? (
    <ActivityIndicator size="small" color={colors.textPrimary} />
  ) : playing ? (
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
  );

  const spokenLabel = loading
    ? 'Loading instrument, tap to cancel'
    : playing
      ? 'Stop listening'
      : `Listen with ${INSTRUMENT_LABELS[instrument]} at this tempo`;

  const row = density === 'row';

  return (
    <View>
      <Pressable
        onPress={toggle}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled, busy: loading }}
        accessibilityLabel={spokenLabel}
        style={({ pressed }) => [
          row ? styles.row : styles.button,
          pressed && (row ? styles.rowPressed : styles.pressed),
          disabled && styles.disabled,
        ]}
      >
        {row ? (
          <>
            {/*
              The label never changes, the value does. That is the grammar of
              every other row in the panel — "Metronome / Off", "Start at /
              Bar 1" — and it is what lets a musician read the column down the
              left instead of re-reading a control whose own name moved.
            */}
            <Text variant="button">Listen</Text>
            <View style={styles.rowValue}>
              {glyph}
              <Text variant="metadata" color="textTertiary" numberOfLines={1}>
                {loading
                  ? 'Loading'
                  : playing
                    ? 'Playing'
                    : INSTRUMENT_LABELS[instrument]}
              </Text>
            </View>
          </>
        ) : (
          <>
            {glyph}
            <Text variant="metadataSmall">
              {loading
                ? 'Loading · Cancel'
                : playing
                  ? 'Stop'
                  : `Listen · ${INSTRUMENT_LABELS[instrument]}`}
            </Text>
          </>
        )}

        {/* Sits inside the control's border rather than under it, so the button
          keeps one outline instead of growing a second element beneath it.

          In `row` form there is no border to sit inside, so it rules the row's
          own bottom edge — visible only while something is sounding, which is
          the only time it has anything to report. */}
        <View style={styles.track} pointerEvents="none">
          <View
            style={[styles.fill, { width: `${Math.min(1, progress) * 100}%` }]}
          />
        </View>
      </Pressable>
      {error ? (
        <Text variant="metadataSmall" selectable accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    /*
      **A real target, not a caption** — and deliberately not `SecondaryButton`,
      which a design review once proposed swapping this for. That control is
      `CONTROL_HEIGHT` (52), pill-radius, glass-filled, and sets its label in
      `button`. This one is quieter on purpose, and it has to host the progress
      track below *inside* its own border, which needs a clipped rectangle
      rather than a glass pill. Two controls that look adjacent are not one
      control.
    */
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
  /**
   * The panel's row, to `rowMetrics`' grammar: label left, value right, a
   * hairline on the top edge, `ROW_PADDING_VERTICAL` above and below.
   *
   * `overflow: 'hidden'` is kept from the button form and does a different job
   * here — it clips the progress fill to the row so a take of a long movement
   * cannot draw a gold line out past the panel's gutter.
   */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: ROW_PADDING_VERTICAL,
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
    overflow: 'hidden',
  },
  rowPressed: {
    backgroundColor: colors.surfacePressed,
    opacity: 0.88,
  },
  rowValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
    // See `LinkRow`: a flex item's CSS min-width is its content, so a long
    // instrument name would push the row off the web build's screen.
    minWidth: 0,
  },
  disabled: {
    opacity: disabledOpacity,
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

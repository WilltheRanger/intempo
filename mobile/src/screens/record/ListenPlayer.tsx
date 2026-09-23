import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { Pause, Play } from '../../components/icons';
import { Text } from '../../components/primitives';
import { usePreferences } from '../../data/preferences';
import type { ScoreJson } from '../../data/types';
import { colors, ICON_STROKE_WIDTH, MIN_TOUCH_TARGET, radii } from '../../design';
import { impact, ImpactFeedbackStyle } from '../../lib/haptics';
import {
  scheduleScore,
  startAtMeasure,
  voiceForInstrument,
} from '../../lib/score';
import {
  barAt,
  barStarts,
  clockLabel,
  startOfBar,
} from '../../lib/score/listenPosition';
import { warmPlayback } from '../../lib/score/warmPlayback';
import { playSchedule } from '../../lib/scorePlayer';
import type { PlaybackHandle } from '../../lib/score/player.types';
import { INSTRUMENT_LABELS } from '../../lib/warmup';

/**
 * The redesign's Listen player: a round play button, a scrubber, and the
 * instrument with the clock under it (`redesign/RecordReady.dc.html`).
 *
 * **It listens from the start bar** unless it has been scrubbed somewhere
 * else, because hearing the passage you are about to play is what it is for
 * — and choosing a new start bar brings it back there.
 *
 * **The scrubber seeks by bar.** The engine starts from a bar and cannot seek
 * inside one (`lib/score/listenPosition.ts`), so a drag lands on the bar under
 * the finger and the clock shows that bar's start.
 */

const BUTTON = MIN_TOUCH_TARGET;
const THUMB = 12;

export function ListenPlayer({
  score,
  bpm,
  startFrom,
  disabled = false,
}: {
  score: ScoreJson;
  bpm: number;
  startFrom: number;
  disabled?: boolean;
}) {
  const { instrument } = usePreferences();
  const whole = useMemo(() => scheduleScore(score, bpm), [score, bpm]);
  const starts = useMemo(() => barStarts(whole), [whole]);
  const total = whole.durationS;

  const [fromBar, setFromBar] = useState(startFrom);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [dragS, setDragS] = useState<number | null>(null);
  const [railWidth, setRailWidth] = useState(0);
  const handle = useRef<PlaybackHandle | null>(null);

  const stop = useCallback(() => {
    handle.current?.stop();
    handle.current = null;
    setPlaying(false);
    setLoading(false);
    setElapsed(0);
  }, []);

  const play = useCallback(
    (bar: number) => {
      handle.current?.stop();
      const schedule = startAtMeasure(whole, bar);
      if (schedule.notes.length === 0) {
        return;
      }
      setElapsed(0);
      setError(null);
      const started = playSchedule(schedule, {
        voice: voiceForInstrument(instrument),
        onLoading: setLoading,
        onError: setError,
        onProgress: (seconds) => setElapsed(seconds),
        onEnd: () => {
          handle.current = null;
          setPlaying(false);
          setElapsed(0);
        },
      });
      const sounding = started.isPlaying();
      handle.current = sounding ? started : null;
      setPlaying(sounding);
    },
    [instrument, whole],
  );

  // A new start bar is where listening begins again.
  useEffect(() => {
    stop();
    setFromBar(startFrom);
  }, [startFrom, stop]);

  useFocusEffect(useCallback(() => stop, [stop]));
  useEffect(() => stop, [instrument, whole, stop]);
  useEffect(() => {
    if (disabled) {
      stop();
    }
  }, [disabled, stop]);
  useEffect(() => {
    if (!disabled) {
      warmPlayback(instrument);
    }
  }, [disabled, instrument]);

  const offset = startOfBar(starts, fromBar);
  const position = dragS ?? (playing ? offset + elapsed : offset);
  const through = total > 0 ? Math.min(1, Math.max(0, position / total)) : 0;

  // Read through refs inside the responder, which is created once.
  const live = useRef({ railWidth, total, starts, playing, play, disabled });
  live.current = { railWidth, total, starts, playing, play, disabled };

  const scrub = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !live.current.disabled,
        onMoveShouldSetPanResponder: () => !live.current.disabled,
        onPanResponderGrant: (event) => {
          const { railWidth: w, total: t } = live.current;
          if (w > 0) setDragS((event.nativeEvent.locationX / w) * t);
        },
        onPanResponderMove: (event) => {
          const { railWidth: w, total: t } = live.current;
          if (w > 0) {
            const x = Math.min(w, Math.max(0, event.nativeEvent.locationX));
            setDragS((x / w) * t);
          }
        },
        onPanResponderRelease: (event) => {
          const { railWidth: w, total: t, starts: s, playing: p, play: go } =
            live.current;
          setDragS(null);
          if (w <= 0) return;
          const x = Math.min(w, Math.max(0, event.nativeEvent.locationX));
          const bar = barAt(s, (x / w) * t);
          if (!bar) return;
          setFromBar(bar.measure);
          impact(ImpactFeedbackStyle.Light);
          if (p) go(bar.measure);
        },
        onPanResponderTerminate: () => setDragS(null),
      }),
    [],
  );

  function toggle() {
    impact(ImpactFeedbackStyle.Light);
    if (playing || loading) {
      stop();
    } else {
      play(fromBar);
    }
  }

  function handleRailLayout(event: LayoutChangeEvent) {
    const measured = event.nativeEvent.layout.width;
    setRailWidth((current) => (current === measured ? current : measured));
  }

  const glyphProps = {
    size: 16,
    strokeWidth: ICON_STROKE_WIDTH,
    color: colors.textPrimary,
    fill: colors.textPrimary,
  };

  return (
    <View>
      <View style={styles.player}>
        <Pressable
          onPress={toggle}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityState={{ disabled, busy: loading }}
          accessibilityLabel={
            loading
              ? 'Loading instrument, tap to cancel'
              : playing
                ? 'Stop listening'
                : `Listen from bar ${fromBar}`
          }
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            disabled && styles.disabled,
          ]}
        >
          {loading ? (
            <ActivityIndicator size="small" color={colors.textPrimary} />
          ) : playing ? (
            <Pause {...glyphProps} />
          ) : (
            // Nudged right: a triangle's visual centre is left of its box.
            <View style={styles.playGlyph}>
              <Play {...glyphProps} />
            </View>
          )}
        </Pressable>

        <View style={styles.scrubber}>
          <View
            style={styles.hit}
            onLayout={handleRailLayout}
            accessibilityRole="adjustable"
            accessibilityLabel={`Listening position, ${clockLabel(position)} of ${clockLabel(total)}`}
            {...scrub.panHandlers}
          >
            <View style={styles.rail} pointerEvents="none">
              <View style={[styles.fill, { width: `${through * 100}%` }]} />
            </View>
            <View
              pointerEvents="none"
              style={[styles.thumb, { left: `${through * 100}%` }]}
            />
          </View>
          <View style={styles.caption}>
            <Text variant="caption" color="textTertiary" style={styles.clock}>
              {INSTRUMENT_LABELS[instrument]} · {clockLabel(position)}
            </Text>
            <Text variant="caption" color="textTertiary" style={styles.clock}>
              {clockLabel(total)}
            </Text>
          </View>
        </View>
      </View>
      {error ? (
        <Text variant="metadataSmall" color="textSecondary" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  player: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  button: {
    width: BUTTON,
    height: BUTTON,
    borderRadius: BUTTON / 2,
    backgroundColor: colors.controlFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    backgroundColor: colors.borderStrong,
  },
  disabled: {
    opacity: 0.45,
  },
  playGlyph: {
    marginLeft: 2,
  },
  scrubber: {
    flex: 1,
    minWidth: 0,
  },
  // A 20pt strip around a 4pt rail: the rail is what is drawn, the strip is
  // what a finger has to find.
  hit: {
    height: 20,
    justifyContent: 'center',
  },
  rail: {
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  thumb: {
    position: 'absolute',
    top: (20 - THUMB) / 2,
    width: THUMB,
    height: THUMB,
    marginLeft: -THUMB / 2,
    borderRadius: THUMB / 2,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.panel,
  },
  caption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 1,
  },
  clock: {
    fontVariant: ['tabular-nums'],
  },
});

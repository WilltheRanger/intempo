import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { Pause, Play } from '../../components/icons';
import { Text } from '../../components/primitives';
import { BORDER_WIDTH, ICON_SIZE, ICON_STROKE_WIDTH, MIN_TOUCH_TARGET, colors, radii, spacing } from '../../design';
import { sliderMove } from '../../lib/sliderKeys';
import { SCRUB_BIG_STEPS, SCRUB_STEP_S, scrubFraction, scrubSeconds, scrubStep } from '../../lib/verdict/scrub';
import { formatPlaybackTime } from './playbackTime';
import { useTakeAudio } from './useTakeAudio';

export interface ScrubPlayerProps {
  /** The recording: a signed link to a saved take, or a held take's local URL. */
  uri: string;
}

/**
 * A recording to hear and move through: a round play button beside a
 * scrubber, the position and length under it — the shape every voice-memo and
 * podcast player has, which is why it needs no words (the owner, 2026-09-29:
 * the listening page "doesn't fit common UX practices"). One control for the
 * verdict's saved take and for a take still held after Stop; `useTakeAudio`
 * is what lets it open both.
 *
 * The rail answers a tap as well as a drag, and to assistive tech it is one
 * adjustable control stepped a few seconds at a time.
 */
export function ScrubPlayer({ uri }: ScrubPlayerProps) {
  const [broken, setBroken] = useState(false);
  const audio = useTakeAudio(uri);
  const generation = useRef(0);
  const starting = useRef(false);
  const { pause, seekTo } = audio;
  useFocusEffect(
    useCallback(
      () => () => {
        generation.current += 1;
        pause();
      },
      [pause],
    ),
  );

  // Read inside the pan responder, which is created once.
  const trackWidth = useRef(0);
  const durationRef = useRef(0);
  const measureTrack = useCallback((event: LayoutChangeEvent) => {
    trackWidth.current = event.nativeEvent.layout.width;
  }, []);

  const { current, duration } = audio;
  durationRef.current = duration;
  const progress = duration > 0 ? Math.min(1, current / duration) : 0;
  const failed = broken || audio.failed;

  async function toggle() {
    if (starting.current) return;
    const requested = generation.current;
    starting.current = true;
    try {
      if (audio.playing) {
        pause();
        return;
      }
      await audio.play(() => generation.current === requested);
    } catch {
      if (generation.current === requested) setBroken(true);
    } finally {
      starting.current = false;
    }
  }

  const seekFraction = useCallback(
    (fraction: number | null) => {
      const seconds = scrubSeconds(fraction, durationRef.current);
      if (seconds !== null) void seekTo(seconds);
    },
    [seekTo],
  );

  const scrubber = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) =>
          seekFraction(scrubFraction(event.nativeEvent.locationX, trackWidth.current)),
        onPanResponderMove: (event) =>
          seekFraction(scrubFraction(event.nativeEvent.locationX, trackWidth.current)),
      }),
    [seekFraction],
  );

  // The keys on the web, where a plain view has no keyboard prop: the handler
  // goes on the DOM node react-native-web renders, as `TempoSlider` does.
  // Read through a ref because the listener is attached once.
  const track = useRef<View>(null);
  const position = useRef({ current, duration });
  position.current = { current, duration };
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const element = track.current as unknown as HTMLElement | null;
    if (!element?.addEventListener) return;
    function onKey(event: KeyboardEvent) {
      const move = sliderMove(event.key, { big: SCRUB_BIG_STEPS, shift: event.shiftKey });
      if (!move) return;
      event.preventDefault();
      const next = scrubStep(position.current.current, position.current.duration, move);
      if (next !== null) void seekTo(next);
    }
    element.addEventListener('keydown', onKey);
    return () => element.removeEventListener('keydown', onKey);
  }, [seekTo]);

  const disabled = failed || !audio.ready;
  const Icon = audio.playing ? Pause : Play;

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => void toggle()}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={audio.playing ? 'Pause' : 'Play'}
        accessibilityState={{ disabled }}
        style={({ pressed }) => [styles.play, pressed && styles.pressed, disabled && styles.dim]}
      >
        <Icon size={ICON_SIZE.md} strokeWidth={ICON_STROKE_WIDTH} color={colors.textPrimary} />
      </Pressable>
      <View style={styles.rail}>
        <View
          ref={track}
          {...scrubber.panHandlers}
          onLayout={measureTrack}
          accessibilityRole="adjustable"
          accessibilityLabel="Playback position"
          accessibilityHint={`Drag to move through the recording, or step by ${SCRUB_STEP_S} seconds.`}
          // The `aria-value*` props, not `accessibilityValue`, which
          // react-native-web drops: the web slider had no value at all.
          // Native reads these as the same accessibility value.
          aria-valuemin={0}
          aria-valuemax={Math.max(1, Math.round(duration))}
          aria-valuenow={Math.round(current)}
          aria-valuetext={`${formatPlaybackTime(current)} of ${formatPlaybackTime(duration)}`}
          focusable={!disabled}
          accessibilityActions={[
            { name: 'increment', label: 'Forward' },
            { name: 'decrement', label: 'Back' },
          ]}
          onAccessibilityAction={(event) => {
            const next = scrubStep(current, duration, { by: event.nativeEvent.actionName === 'increment' ? 1 : -1 });
            if (next !== null) void seekTo(next);
          }}
          style={styles.trackTarget}
        >
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${progress * 100}%` }]} />
          </View>
        </View>
        <View style={styles.times}>
          <Text variant="metadataSmall" color="textTertiary" style={styles.time}>
            {formatPlaybackTime(current)}
          </Text>
          <Text variant="metadataSmall" color="textTertiary" style={styles.time}>
            {failed ? 'Can’t play' : duration > 0 ? formatPlaybackTime(duration) : '…'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const PLAY = 48;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  play: {
    width: Math.max(PLAY, MIN_TOUCH_TARGET),
    height: Math.max(PLAY, MIN_TOUCH_TARGET),
    borderRadius: Math.max(PLAY, MIN_TOUCH_TARGET) / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
  },
  pressed: {
    opacity: 0.55,
  },
  dim: {
    opacity: 0.4,
  },
  rail: {
    flex: 1,
    // The time row sits under the rail; lift the pair so the rail, not the
    // pair, lines up with the button's centre.
    marginTop: 18,
  },
  trackTarget: {
    // 44pt of target around a 6pt rail.
    paddingVertical: 19,
    marginVertical: -19,
  },
  track: {
    height: 6,
    overflow: 'hidden',
    borderRadius: radii.pill,
    backgroundColor: colors.surfacePressed,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
  },
  fill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  time: {
    fontVariant: ['tabular-nums'],
  },
});

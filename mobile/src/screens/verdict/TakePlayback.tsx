import { useQuery } from '@tanstack/react-query';
import { Pause, Play } from '../../components/icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import {
  LoadingState,
  SecondaryButton,
  SectionHeader,
  Text,
} from '../../components/primitives';
import { takeSource } from '../../data/sources';
import { BORDER_WIDTH, colors, radii, spacing } from '../../design';
import { prepareForPlayback } from '../../lib/audio/session';
import { formatPlaybackTime } from './playbackTime';
import {
  SCRUB_STEP_S,
  scrubFraction,
  scrubSeconds,
  scrubStep,
} from '../../lib/verdict/scrub';

interface TakePlaybackProps {
  analysisId: string;
}

/**
 * Hear the recording that produced a verdict.
 *
 * The URL is fetched only while this result is open and discarded as soon as
 * it closes. It is a one-hour read permission for one private object, never the
 * permanent upload reference stored by the backend. `useAudioPlayer` owns the
 * player lifetime, so leaving the screen also stops and releases the sound.
 *
 * **The track moves now.** It was drawn as a scrubber — a rounded rail with a
 * filled portion and a time at either end — and the only control under it was
 * play and pause, so a musician checking bar seven against the row that names
 * it had to listen to the six before it every time. §3 is explicit that a drawn
 * affordance must do the thing it depicts. `lib/verdict/scrub.ts` has the
 * arithmetic and the tests.
 *
 * **What is deliberately not drawn on it is the take's own shape.** The survey
 * frame this comes from puts a pill per bar along the track, its height the
 * deviation and its colour the band, so reading the take and hearing it become
 * one control. The analysis does not say where each bar *falls in the
 * recording* — `MeasureVerdict` carries a number, a band and a deviation, and
 * no time — so every pill would be placed by dividing the duration evenly
 * between the bars. On a take that rushed, which is the take this screen exists
 * for, that placement is wrong by construction, and a pill you can touch that
 * seeks to the wrong bar is worse than no pill. It needs onset times from the
 * pipeline, which it already has and does not send.
 */
export function TakePlayback({ analysisId }: TakePlaybackProps) {
  const [playError, setPlayError] = useState<string | null>(null);
  const recording = useQuery({
    queryKey: ['take-recording', analysisId],
    queryFn: () => takeSource.getRecordingUrl(analysisId),
    // Keep a still-open screen from minting URLs repeatedly. Once it closes,
    // forget the bearer credential immediately instead of retaining it in the
    // ordinary five-minute query cache.
    staleTime: 50 * 60 * 1000,
    gcTime: 0,
    retry: 1,
  });
  const player = useAudioPlayer(
    recording.data ? { uri: recording.data } : null,
    { updateInterval: 250 },
  );
  const status = useAudioPlayerStatus(player);
  const generation = useRef(0);
  const starting = useRef(false);
  useFocusEffect(useCallback(() => () => {
    generation.current += 1;
    try { player.pause(); } catch { /* Player already released. */ }
  }, [player]));

  // Both read inside the pan responder, which is created once — a value
  // captured in its closure would be the duration and the width as they were
  // before the recording loaded and before the track was measured.
  const trackWidth = useRef(0);
  const durationRef = useRef(0);
  const measureTrack = useCallback((event: LayoutChangeEvent) => {
    trackWidth.current = event.nativeEvent.layout.width;
  }, []);

  const duration = Math.max(0, status.duration || 0);
  durationRef.current = duration;
  const current = Math.min(duration || Infinity, Math.max(0, status.currentTime || 0));
  const finished =
    duration > 0 && current >= Math.max(0, duration - 0.05) && !status.playing;
  const progress = duration > 0 ? Math.min(1, current / duration) : 0;
  const unavailable = recording.isError || Boolean(status.error) || playError;

  async function toggle() {
    if (starting.current) return;
    const requestedGeneration = generation.current;
    starting.current = true;
    setPlayError(null);
    try {
      if (status.playing) {
        player.pause();
        return;
      }
      await prepareForPlayback();
      if (generation.current !== requestedGeneration) return;
      if (finished) {
        await player.seekTo(0);
      }
      if (generation.current !== requestedGeneration) return;
      player.play();
    } catch {
      if (generation.current === requestedGeneration)
        setPlayError('Can’t play this recording.');
    } finally {
      starting.current = false;
    }
  }

  /** Move the recording, ignoring a position it could not work out. */
  const seekTo = useCallback(
    async (seconds: number | null) => {
      if (seconds === null) {
        return;
      }
      try {
        await player.seekTo(seconds);
      } catch {
        // A player released underneath us, which leaving the screen does. The
        // position is not worth an error message.
      }
    },
    [player],
  );

  /**
   * The finger on the rail.
   *
   * Claims the gesture on the way down rather than on movement, so a tap moves
   * the position too — a scrubber that only answers a drag is one a musician
   * taps at, watches do nothing, and stops using. The whole track is inside a
   * `ScrollView`, so the responder has to be taken deliberately.
   */
  const scrubber = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          void seekTo(
            scrubSeconds(
              scrubFraction(event.nativeEvent.locationX, trackWidth.current),
              durationRef.current,
            ),
          );
        },
        onPanResponderMove: (event) => {
          void seekTo(
            scrubSeconds(
              scrubFraction(event.nativeEvent.locationX, trackWidth.current),
              durationRef.current,
            ),
          );
        },
      }),
    [seekTo],
  );

  async function retry() {
    setPlayError(null);
    await recording.refetch();
  }

  return (
    <View style={styles.section}>
      <SectionHeader label="Your recording" />
      {recording.isPending ? (
        <LoadingState layout="inline" label="Loading…" />
      ) : unavailable ? (
        <View style={styles.errorBlock}>
          <Text variant="body" color="textSecondary">
            Can’t load the recording right now.
          </Text>
          <SecondaryButton
            label="Try again"
            onPress={() => void retry()}
            style={styles.action}
          />
        </View>
      ) : recording.data ? (
        <View style={styles.player}>
          <View
            {...scrubber.panHandlers}
            onLayout={measureTrack}
            /*
              `adjustable`, not `progressbar`: it reports a position *and*
              takes one. The increment and decrement actions are the route for
              anyone not dragging a finger along a 6pt rail, which is why the
              gesture cannot be the only way in.
            */
            accessibilityRole="adjustable"
            accessibilityLabel="Recording playback position"
            accessibilityHint={`Drag to move through the recording, or step by ${SCRUB_STEP_S} seconds.`}
            accessibilityValue={{
              min: 0,
              max: Math.max(1, Math.round(duration)),
              now: Math.round(current),
              text: `${formatPlaybackTime(current)} of ${formatPlaybackTime(duration)}`,
            }}
            accessibilityActions={[
              { name: 'increment', label: 'Forward' },
              { name: 'decrement', label: 'Back' },
            ]}
            onAccessibilityAction={(event) => {
              const direction = event.nativeEvent.actionName === 'increment' ? 1 : -1;
              void seekTo(scrubStep(current, duration, direction));
            }}
            /*
              The rail is 6pt and a finger is not. The padding is on this view
              so the *target* clears the platform minimum while the drawn rail
              stays a hairline — `hitSlop` does nothing on the web build, which
              `touchTargets.test.ts` holds the whole app to.
            */
            style={styles.trackTarget}
          >
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${progress * 100}%` }]} />
            </View>
          </View>
          <View style={styles.timeRow}>
            <Text variant="metadataSmall" color="textTertiary">
              {formatPlaybackTime(current)}
            </Text>
            <Text variant="metadataSmall" color="textTertiary">
              {duration > 0 ? formatPlaybackTime(duration) : 'Loading…'}
            </Text>
          </View>
          <SecondaryButton
            label={status.playing ? 'Pause recording' : finished ? 'Play again' : 'Play recording'}
            icon={status.playing ? Pause : Play}
            onPress={() => void toggle()}
            // A stream can rebuffer after it has started. Pause must remain
            // reachable then; otherwise the one control on the player goes
            // dead exactly when someone most wants to stop it.
            disabled={!status.isLoaded || (status.isBuffering && !status.playing)}
            style={styles.action}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing['2xl'],
  },
  player: {
    marginTop: spacing.md,
  },
  trackTarget: {
    // 44pt of target around a 6pt rail: (44 - 6) / 2 = 19 each side.
    paddingVertical: 19,
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
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  action: {
    marginTop: spacing.md,
  },
  errorBlock: {
    marginTop: spacing.md,
  },
});

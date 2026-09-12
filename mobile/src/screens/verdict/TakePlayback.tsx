import { useQuery } from '@tanstack/react-query';
import { Pause, Play } from '../../components/icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { StyleSheet, View } from 'react-native';

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

  const duration = Math.max(0, status.duration || 0);
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
        setPlayError('This recording could not be played.');
    } finally {
      starting.current = false;
    }
  }

  async function retry() {
    setPlayError(null);
    await recording.refetch();
  }

  return (
    <View style={styles.section}>
      <SectionHeader label="Your recording" />
      {recording.isPending ? (
        <LoadingState layout="inline" label="Preparing your recording…" />
      ) : unavailable ? (
        <View style={styles.errorBlock}>
          <Text variant="body" color="textSecondary">
            The recording is temporarily unavailable. Your timing result is
            still safe.
          </Text>
          <SecondaryButton
            label="Try playback again"
            onPress={() => void retry()}
            style={styles.action}
          />
        </View>
      ) : recording.data ? (
        <View style={styles.player}>
          <View
            accessibilityRole="progressbar"
            accessibilityLabel="Recording playback position"
            accessibilityValue={{
              min: 0,
              max: Math.max(1, Math.round(duration)),
              now: Math.round(current),
              text: `${formatPlaybackTime(current)} of ${formatPlaybackTime(duration)}`,
            }}
            style={styles.track}
          >
            <View style={[styles.fill, { width: `${progress * 100}%` }]} />
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

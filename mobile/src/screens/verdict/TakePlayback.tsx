import { useQuery } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { LoadingState, SecondaryButton, Text } from '../../components/primitives';
import { takeSource } from '../../data/sources';
import { spacing } from '../../design';
import { ScrubPlayer } from './ScrubPlayer';

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
 * **A player shaped like every other one** (2026-09-29): a round play button
 * beside the rail (`ScrubPlayer`), shared with the review step after Stop,
 * where a wide "Play recording" button under the rail used to be.
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

  if (recording.isPending) {
    return <LoadingState layout="inline" label="Loading…" />;
  }
  if (recording.isError || !recording.data) {
    return (
      <View>
        <Text variant="body" color="textSecondary">
          Can’t load the recording right now.
        </Text>
        <SecondaryButton
          label="Try again"
          onPress={() => void recording.refetch()}
          style={styles.action}
        />
      </View>
    );
  }
  return <ScrubPlayer uri={recording.data} />;
}

const styles = StyleSheet.create({
  action: {
    marginTop: spacing.md,
  },
});

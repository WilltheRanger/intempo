import { useNavigation } from '@react-navigation/native';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Stave } from '../../components/notation/Stave';
import { TempoStepper } from '../../components/practice/TempoStepper';
import {
  PageHeader,
  ScreenContainer,
  SectionHeader,
  Text,
} from '../../components/primitives';
import {
  practiceTempo,
  usePracticeTempos,
  clampBpm,
} from '../../data/practiceTempo';
import { usePreferences } from '../../data/preferences';
import { spacing } from '../../design';
import { INSTRUMENT_LABELS, warmupFor, warmupScore } from '../../lib/warmup';
import type { RootNavigation } from '../../navigation/types';
import { ListenButton } from '../record/ListenButton';

/**
 * The warmup, in full.
 *
 * A page rather than a block on Today because working from notation needs the
 * notation at a size you can read from a stand, and because the tempo is
 * something you set once and then play against — neither fits under a
 * two-line preview.
 *
 * **Nothing here is recorded.** A take is analysed against a score row in the
 * backend and a warmup this app authored has no such row, so the page offers
 * the reference and the tempo and stops there. The honest shape of the
 * feature, not a placeholder for a Record button.
 */
export function WarmupScreen() {
  const navigation = useNavigation<RootNavigation>();
  const { instrument } = usePreferences();

  // The remembered tempo is keyed by piece id everywhere else; a warmup's id
  // slots into the same store, so slowing one down is remembered exactly the
  // way slowing a piece down is.
  usePracticeTempos();

  const warmup = warmupFor(instrument);
  const bpm = practiceTempo.for(warmup.id, warmup.bpm);
  const score = warmupScore(warmup);

  return (
    // Listen is pinned rather than left in the flow: it is this page's one
    // action, and §3 law 7 puts a primary action within the thumb's reach
    // instead of floating it in the middle of a short screen.
    <ScreenContainer
      footer={
        <View style={styles.listen}>
          <ListenButton score={score} bpm={bpm} />
        </View>
      }
    >
      <PageHeader
        eyebrow="Warmup"
        title={warmup.name}
        onBack={() => navigation.goBack()}
        backLabel="Back to today"
      />

      <Text variant="body" color="textSecondary">
        {warmup.focus}
      </Text>

      <View style={styles.section}>
        <SectionHeader label={`${INSTRUMENT_LABELS[instrument]} · first position`} />
        {/*
          Scrolls sideways rather than shrinking. Notation compressed to fit a
          phone stops being readable, and a stave you have to squint at
          teaches nothing.
        */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.staveContent}
        >
          <Stave notes={warmup.notes} clef={warmup.clef} />
        </ScrollView>
      </View>

      <TempoStepper
        label="Play at"
        bpm={bpm}
        onChange={(next) => practiceTempo.set(warmup.id, clampBpm(next))}
        style={styles.tempo}
      />

      <Text variant="metadataSmall" color="textTertiary" style={styles.note}>
        Written for {INSTRUMENT_LABELS[instrument].toLowerCase()}. Change your
        instrument in your profile and tomorrow’s warmup follows it.
      </Text>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing['2xl'],
  },
  staveContent: {
    // Room for a stem or a ledger line at either end of the run.
    paddingRight: spacing.lg,
  },
  tempo: {
    marginTop: spacing['3xl'],
  },
  listen: {
    alignItems: 'center',
  },
  note: {
    marginTop: spacing['2xl'],
    textAlign: 'center',
  },
});

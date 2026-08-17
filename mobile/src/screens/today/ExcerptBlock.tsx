import { ScrollView, StyleSheet, View } from 'react-native';

import { Stave } from '../../components/notation/Stave';
import { Text } from '../../components/primitives/Text';
import type { Instrument } from '../../data/types';
import { spacing } from '../../design';
import { excerptFor, excerptScore, INSTRUMENT_LABELS } from '../../lib/excerpt';
import { ListenButton } from '../record/ListenButton';

export interface ExcerptBlockProps {
  instrument: Instrument;
}

/**
 * A few bars to work today, written for the instrument in your hands.
 *
 * Optional by construction: it sits below the piece you are actually
 * practising and asks for nothing. A daily exercise that nags is a daily
 * exercise people stop opening the app to avoid.
 *
 * **It can be heard but not recorded.** `Listen` sounds it through the same
 * player a piece uses, so you can check the tempo and the shape before you
 * play. Recording is not offered because a take is analysed against a score
 * row in the backend, and an exercise the app authored has no such row — a
 * "record" button here would either fail or quietly analyse against the wrong
 * music. Better absent than dishonest.
 */
export function ExcerptBlock({ instrument }: ExcerptBlockProps) {
  const excerpt = excerptFor(instrument);
  const score = excerptScore(excerpt);

  return (
    <View>
      <Text variant="pieceTitle">{excerpt.name}</Text>
      <Text variant="metadataSmall" color="textSecondary" style={styles.focus}>
        {excerpt.focus}
      </Text>

      {/*
        Scrolls sideways rather than shrinking: notation compressed to fit a
        phone stops being readable, and a stave you have to squint at teaches
        nothing. Two bars are visible at a glance and the rest is a nudge away.
      */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.stave}
        contentContainerStyle={styles.staveContent}
      >
        <Stave notes={excerpt.notes} clef={excerpt.clef} />
      </ScrollView>

      <View style={styles.footer}>
        <Text variant="metadataSmall" color="textTertiary" style={styles.meta}>
          {INSTRUMENT_LABELS[instrument]}  ·  {excerpt.bpm} BPM
        </Text>
        <ListenButton score={score} bpm={excerpt.bpm} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  focus: {
    marginTop: 2,
  },
  stave: {
    marginTop: spacing.lg,
  },
  staveContent: {
    // Room for a stem or a ledger line at either end of the run.
    paddingRight: spacing.lg,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  meta: {
    flexShrink: 1,
  },
});

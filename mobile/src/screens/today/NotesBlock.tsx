import { StyleSheet, View } from 'react-native';

import { Text } from '../../components/primitives/Text';
import type { ScoreJson } from '../../data/types';
import { BORDER_WIDTH, colors, spacing } from '../../design';
import { factFor, termFor } from '../../lib/terms';

export interface NotesBlockProps {
  /** The score being practised, so the term can come from its own markings. */
  score: ScoreJson | null;
}

/**
 * A term and a fact, closing the screen.
 *
 * Last on Today on purpose. It is the one block that asks nothing of you, so
 * it belongs where a footnote belongs — after the practice, not in front of
 * it. Everything above is about your playing; this is the page turning.
 *
 * The term comes from the markings on your own score wherever OCR read one, so
 * it is usually a word printed on the music you just opened rather than a word
 * from a list. `lib/terms.ts` has the fallback order.
 */
export function NotesBlock({ score }: NotesBlockProps) {
  const term = termFor(score);
  const fact = factFor();

  return (
    <View>
      <Text variant="pieceTitle">{term.word}</Text>
      <Text variant="body" color="textSecondary" style={styles.meaning}>
        {term.meaning}
      </Text>

      <View style={styles.rule} />

      <Text variant="sectionLabel" color="textTertiary">
        Did you know
      </Text>
      <Text variant="body" color="textSecondary" style={styles.fact}>
        {fact.text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  meaning: {
    marginTop: spacing.xs,
  },
  rule: {
    height: BORDER_WIDTH,
    backgroundColor: colors.border,
    marginVertical: spacing.lg,
  },
  fact: {
    marginTop: spacing.xs,
  },
});

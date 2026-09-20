import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../../components/primitives/Text';
import type { UserVerdict } from '../../data/types';
import { spacing } from '../../design';
import {
  CORRECTION_CHOICES,
  correctionWord,
} from '../../lib/verdict/correction';

/** Where the exchange has got to, for one measure. */
export type CorrectionState =
  | { kind: 'idle' }
  | { kind: 'sending'; choice: UserVerdict }
  | { kind: 'sent'; message: string }
  | { kind: 'failed'; message: string };

export interface CorrectionPromptProps {
  /** What the app said, pre-selected so a musician changes an answer. */
  appVerdict: UserVerdict;
  state: CorrectionState;
  onChoose: (choice: UserVerdict) => void;
}

/**
 * "What actually happened?", under a revealed measure.
 *
 * **Inside the reveal, never on every row.** Thirteen copies of a question
 * nobody asked would make the list a form, and the list is the part of this
 * screen a musician actually works from (§3 law 10). A row is already tapped
 * to see its figure; this is what else is behind that tap.
 *
 * **Words, not chips.** Rounded pills are exceptions in this app rather than
 * the styling language (§3 law 6), and four of them under every opened row
 * would be four more containers doing work a type scale does: the chosen
 * answer is ink, the others recede to tertiary. Ochre marks the app's own
 * answer, which is the accent's job — active state, nothing else.
 *
 * The app's verdict starts selected because it is a correction, not a survey:
 * a musician who agrees taps the thing already highlighted and that agreement
 * is data — the control group for every threshold in `config.toml`. A form
 * that only collects disagreement measures how often people disagree.
 */
export function CorrectionPrompt({
  appVerdict,
  state,
  onChoose,
}: CorrectionPromptProps) {
  if (state.kind === 'sent') {
    return (
      <View style={styles.block}>
        <Text variant="metadataSmall" color="textTertiary">
          {state.message}
        </Text>
      </View>
    );
  }

  const busy = state.kind === 'sending';

  return (
    <View style={styles.block}>
      <Text variant="metadataSmall" color="textTertiary" style={styles.question}>
        What actually happened?
      </Text>

      <View style={styles.choices}>
        {[...CORRECTION_CHOICES, 'unsure' as const].map((choice) => {
          const isApps = choice === appVerdict;
          const chosen = busy && state.choice === choice;
          return (
            <Pressable
              key={choice}
              disabled={busy}
              onPress={() => onChoose(choice)}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy, selected: isApps }}
              // The app's own reading is the control's current value until the
              // musician picks another, so it is genuinely the pressed one.
              // `ariaState.test.ts` requires the web mirror of `selected`.
              aria-pressed={isApps}
              accessibilityLabel={
                isApps
                  ? `${correctionWord(choice)}, what this app read`
                  : correctionWord(choice)
              }
              style={({ pressed }) => [
                styles.choice,
                pressed && !busy && styles.choicePressed,
              ]}
            >
              <Text
                variant="metadataSmall"
                color={
                  chosen || isApps ? 'accentText' : busy ? 'textTertiary' : 'textSecondary'
                }
              >
                {correctionWord(choice)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {state.kind === 'failed' ? (
        // Named rather than swallowed: a correction that silently vanished is
        // worse than one that was never offered, because the musician believes
        // they have said something.
        <Text variant="metadataSmall" color="verdictBad" style={styles.failed}>
          {state.message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    paddingBottom: spacing.md,
  },
  question: {
    paddingBottom: spacing.xs,
  },
  choices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // Not `space-between`: three words on one line and one on the next would
    // be spread to the edges and read as a different control.
    columnGap: spacing.lg,
    rowGap: spacing.xs,
  },
  choice: {
    // 44pt of height across the whole word, which is the tap target — the text
    // itself is 13pt and would otherwise be a target nobody can hit.
    minHeight: 44,
    justifyContent: 'center',
  },
  choicePressed: {
    opacity: 0.55,
  },
  failed: {
    paddingTop: spacing.xs,
  },
});

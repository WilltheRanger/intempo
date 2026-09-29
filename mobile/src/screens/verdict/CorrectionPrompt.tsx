import { Pressable, StyleSheet, View } from 'react-native';

import { Check } from '../../components/icons';
import { FadeIn, PopIn } from '../../components/motion';
import { Text } from '../../components/primitives/Text';
import type { UserVerdict } from '../../data/types';
import { impact, ImpactFeedbackStyle } from '../../lib/haptics';
import {
  BORDER_WIDTH,
  ICON_SIZE,
  MIN_TOUCH_TARGET,
  colors,
  fontFamily,
  radii,
  spacing,
} from '../../design';
import {
  CORRECTION_CHOICES,
  correctionAcknowledgement,
  correctionWord,
} from '../../lib/verdict/correction';

/** Where the exchange has got to, for one measure. */
export type CorrectionState =
  | { kind: 'idle' }
  | { kind: 'sending'; choice: UserVerdict }
  | { kind: 'sent'; choice: UserVerdict }
  | { kind: 'failed'; message: string };

export interface CorrectionPromptProps {
  /** What the app said, pre-selected so a musician changes an answer. */
  appVerdict: UserVerdict;
  state: CorrectionState;
  onChoose: (choice: UserVerdict) => void;
  /** Back to the question, from the thanks. */
  onChange: () => void;
}

/** The check's column, so the answer line sits under the thanks, not the check. */
const CHECK_GAP = spacing.sm;

/**
 * "What did you hear?", under a revealed bar.
 *
 * **Inside the reveal, never on every row.** Thirteen copies of a question
 * nobody asked would make the list a form, and the list is the part of this
 * screen a musician actually works from (§3 law 10). A row is already tapped
 * to see its figure; this is what else is behind that tap.
 *
 * **One row, the app's segmented track** (the owner, 2026-09-29: "they should
 * all be on one line"). Four separate bordered buttons wrapped to two lines
 * inside the bar card, and before that four bare words read as a sentence
 * rather than a choice. This is the control the app already uses for one
 * answer out of four (`SegmentedControl`, Profile's Instrument and Metronome):
 * a sunken well, the four answers sharing its width equally, and the current
 * one a raised tile. Buttons rather than tabs underneath, because each press
 * sends an answer, the one already raised included.
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
  onChange,
}: CorrectionPromptProps) {
  if (state.kind === 'sent') {
    const thanks = correctionAcknowledgement(state.choice);
    /*
      **A thanks that lands** (the owner, 2026-09-25). The bare "Thanks." read
      as the control going dead. A check that pops in, the thanks in ink, and
      their own answer read back with the way to change it — so the tap is
      seen to have been received, and what was received is on screen.
    */
    return (
      <FadeIn style={styles.block}>
        <View
          style={styles.thanksRow}
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          accessibilityLabel={`${thanks.title} ${thanks.answer}.`}
        >
          <PopIn>
            <Check size={ICON_SIZE.md} strokeWidth={2.5} color={colors.accent} />
          </PopIn>
          <Text variant="metadata" style={styles.thanks}>
            {thanks.title}
          </Text>
        </View>
        <View style={styles.answerRow}>
          <Text variant="metadataSmall" color="textSecondary">
            {thanks.answer}
          </Text>
          <Pressable
            onPress={onChange}
            accessibilityRole="button"
            accessibilityLabel="Change your answer"
            style={({ pressed }) => [styles.change, pressed && styles.changePressed]}
          >
            <Text variant="metadataSmall" color="accentText" style={styles.appsChoice}>
              Change
            </Text>
          </Pressable>
        </View>
      </FadeIn>
    );
  }

  const busy = state.kind === 'sending';

  return (
    <View style={styles.block}>
      {/*
        **Says what the app read, in words** (2026-09-29). Its reading was
        marked only by a gold word among four, which a first-time walk could
        not tell apart from a selection — the screen reader was the one reader
        told what it meant.
      */}
      <Text variant="metadataSmall" color="textTertiary" style={styles.question}>
        What did you hear? We read it as {correctionWord(appVerdict).toLowerCase()}.
      </Text>

      <View style={styles.choices}>
        {[...CORRECTION_CHOICES, 'unsure' as const].map((choice) => {
          const isApps = choice === appVerdict;
          const chosen = busy && state.choice === choice;
          return (
            <Pressable
              key={choice}
              disabled={busy}
              onPress={() => {
                // Felt on the tap itself: iOS Safari only lets a page touch the
                // haptics inside the gesture, and the success pulse comes after
                // the network (`VerdictScreen.correct`).
                impact(ImpactFeedbackStyle.Light);
                onChoose(choice);
              }}
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
                (chosen || isApps) && styles.choiceApps,
                pressed && !busy && (chosen || isApps ? styles.raisedPressed : styles.choicePressed),
              ]}
            >
              <Text
                variant="metadata"
                numberOfLines={1}
                color={
                  chosen || isApps ? 'textPrimary' : busy ? 'textTertiary' : 'textSecondary'
                }
                // Raised and weighted, as `SegmentedControl` marks its current
                // option: the tile and the weight say which, not colour alone.
                style={[styles.choiceLabel, (chosen || isApps) && styles.appsChoice]}
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
    paddingBottom: spacing.sm,
  },
  /** `SegmentedControl`'s track: one well, the answers sharing its width. */
  choices: {
    flexDirection: 'row',
    backgroundColor: colors.surfacePressed,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: 3,
    gap: 2,
  },
  choice: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  choiceApps: {
    backgroundColor: colors.surface,
  },
  choicePressed: {
    backgroundColor: colors.border,
  },
  /** The raised tile answers the finger too: pressing it sends agreement. */
  raisedPressed: {
    opacity: 0.6,
  },
  changePressed: {
    opacity: 0.55,
  },
  choiceLabel: {
    fontSize: 13,
    lineHeight: 18,
  },
  appsChoice: {
    fontFamily: fontFamily.sansMedium,
  },
  failed: {
    paddingTop: spacing.xs,
  },
  thanksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: CHECK_GAP,
    paddingTop: spacing.xs,
  },
  thanks: {
    fontFamily: fontFamily.sansMedium,
    color: colors.textPrimary,
  },
  answerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 18,
    marginLeft: ICON_SIZE.md + CHECK_GAP,
  },
  change: {
    // The word is 13pt; the target is the platform minimum all the same.
    minHeight: 44,
    justifyContent: 'center',
  },
});

import { StyleSheet, View } from 'react-native';

import {
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  Text,
} from '../../components/primitives';
import { ROW_PADDING_VERTICAL, rowDivided } from '../../components/rowMetrics';
import { BORDER_WIDTH, colors, spacing } from '../../design';

/** The numeral's circle. Named because the row's rule no longer clears it. */
const NUMBER_SIZE = 32;

interface PracticeSetupProps {
  title: string;
  onBack: () => void;
  onContinue: () => void;
}

/**
 * A short, one-time orientation before a device records its first take.
 *
 * It stays about actions that change the result: microphone placement,
 * speaker bleed, and where the count-in ends. Permission is deliberately not
 * requested here — the system prompt belongs to Start, after the musician has
 * been told why the microphone is needed.
 */
export function PracticeSetup({
  title,
  onBack,
  onContinue,
}: PracticeSetupProps) {
  return (
    <ScreenContainer
      footer={
        <View>
          <PrimaryButton label="Set tempo & record" onPress={onContinue} />
          <Text
            variant="metadataSmall"
            color="textTertiary"
            style={styles.footerNote}
          >
            You can reopen these tips from the recording screen.
          </Text>
        </View>
      }
    >
      {/*
        **The tips are the subject; the piece is the context.**

        This had the piece as the screen title *and* "Before your first take"
        as a second heading of the same weight, one under the other — two
        competing focal points (§3 law 4). At 320pt with a real repertoire
        title it was four lines of serif followed by two more, and the actual
        subject of the screen was below the fold.

        The piece moves to the eyebrow, where a one-time interstitial about
        microphone technique should carry it. The composer goes: on a screen
        that is not about the music, it is one more thing to read.
      */}
      <PageHeader
        eyebrow={title}
        title="Before your first take"
        onBack={onBack}
        backLabel="Back to the piece"
      />

      <Text variant="body" color="textSecondary" style={styles.lede}>
        Three details make the timing feedback much more reliable.
      </Text>

      {/*
        **Three steps on the page, not in a box.** §3 law 3 — the background is
        a compositional surface and a card around a plain list is the case that
        law names. The numerals stay: unlike most numbering, these are a real
        sequence, and they are what tells you there are exactly three things to
        read before you start.

        Rules are now the app's own convention (`rowMetrics`), top-ruled and
        running the full width from the gutter, in place of three hand-built
        `<View>` dividers inset to clear the numeral.
      */}
      <View style={styles.steps}>
        {SETUP_STEPS.map((step, index) => (
          <SetupStep
            key={step.number}
            number={step.number}
            title={step.title}
            body={step.body}
            divided={rowDivided(index)}
          />
        ))}
      </View>

      <Text variant="metadataSmall" color="textTertiary" style={styles.permission}>
        Your device will ask for microphone access when you press Start. InTempo
        records only until you press Stop or leave this screen.
      </Text>
    </ScreenContainer>
  );
}

/**
 * The three things to get right before a first take, in order.
 *
 * Hoisted out of the JSX so the list can be mapped — which is what lets
 * `rowDivided(index)` decide the rules instead of hand-placed dividers between
 * hand-written siblings.
 */
const SETUP_STEPS = [
  {
    number: '1',
    title: 'Give the microphone a clear listen',
    body: 'Place your device nearby with its microphone uncovered. Keep it away from the music stand and anything that rattles.',
  },
  {
    number: '2',
    title: 'Keep speaker sound out of the take',
    body: 'The count-in always ticks out loud, and those seconds are thrown away before anything is sent. After it, use headphones if you want the metronome audible — the microphone would hear the room.',
  },
  {
    number: '3',
    title: 'Enter on the next downbeat',
    body: 'Start counts you in for one full bar, out loud and in your hand. During a long written rest, the screen counts down to the exact measure where you return.',
  },
] as const;

function SetupStep({
  number,
  title,
  body,
  divided,
}: {
  number: string;
  title: string;
  body: string;
  divided: boolean;
}) {
  return (
    <View style={[styles.step, divided && styles.ruled]}>
      <View style={styles.number} accessibilityElementsHidden>
        <Text variant="sectionLabel">{number}</Text>
      </View>
      <View style={styles.stepCopy}>
        <Text variant="button">{title}</Text>
        <Text variant="metadata" color="textSecondary" style={styles.stepBody}>
          {body}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  lede: {
    marginTop: spacing.sm,
  },
  steps: {
    marginTop: spacing['2xl'],
  },
  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: ROW_PADDING_VERTICAL,
  },
  ruled: {
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  number: {
    width: NUMBER_SIZE,
    height: NUMBER_SIZE,
    borderRadius: NUMBER_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    /*
      **`surface`, not `bg`, and the card leaving is why.** This was `bg` —
      cream — which read only because the card behind it was white. On the page
      ground, cream on cream is an invisible circle with a numeral floating in
      it, and the same inversion holds in the dark palette (#14110E on #221E19).
      The fill and the container moved together or neither worked.
    */
    backgroundColor: colors.surface,
  },
  stepCopy: {
    flex: 1,
  },
  stepBody: {
    marginTop: spacing.xs,
  },
  permission: {
    marginTop: spacing.lg,
  },
  footerNote: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
});

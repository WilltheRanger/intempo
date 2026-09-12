import { StyleSheet, View } from 'react-native';

import {
  Card,
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  Text,
} from '../../components/primitives';
import { colors, spacing } from '../../design';

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

      <Card emphasis style={styles.card}>
        <SetupStep
          number="1"
          title="Give the microphone a clear listen"
          body="Place your device nearby with its microphone uncovered. Keep it away from the music stand and anything that rattles."
        />
        <View style={styles.divider} />
        <SetupStep
          number="2"
          title="Keep speaker sound out of the take"
          body="The count-in always ticks out loud, and those seconds are thrown away before anything is sent. After it, use headphones if you want the metronome audible — the microphone would hear the room."
        />
        <View style={styles.divider} />
        <SetupStep
          number="3"
          title="Enter on the next downbeat"
          body="Start counts you in for one full bar, out loud and in your hand. During a long written rest, the screen counts down to the exact measure where you return."
        />
      </Card>

      <Text variant="metadataSmall" color="textTertiary" style={styles.permission}>
        Your device will ask for microphone access when you press Start. InTempo
        records only until you press Stop or leave this screen.
      </Text>
    </ScreenContainer>
  );
}

function SetupStep({
  number,
  title,
  body,
}: {
  number: string;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.step}>
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
  card: {
    marginTop: spacing['2xl'],
  },
  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  number: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  stepCopy: {
    flex: 1,
  },
  stepBody: {
    marginTop: spacing.xs,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.lg,
    marginLeft: 32 + spacing.md,
  },
  permission: {
    marginTop: spacing.lg,
  },
  footerNote: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
});

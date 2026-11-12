import { Platform, StyleSheet, View } from 'react-native';

import { FileMusic, Mic, Settings, type LucideIcon } from '../icons';
import { PageHeader, PrimaryButton, ScreenContainer, Text } from '../primitives';
import { BORDER_WIDTH, ICON_SIZE, ICON_STROKE_WIDTH, colors, spacing } from '../../design';
import { ListeningIllustration } from './ListeningIllustration';

/**
 * What the microphone is for, said once, just before the first take asks for
 * it (`redesign/OnboardMic.dc.html`, moved).
 *
 * **Here, not in onboarding** (the owner, 2026-11-12, reversing 2026-09-23's
 * step four). Onboarding asked for the microphone before there was anything
 * to record, beside "Not now", which Apple's privacy guidance draws as the
 * thing not to do before a system prompt. Now the explanation comes when a
 * musician has pressed Start recording, and it has one way on: Continue, which
 * starts that take, and the take's own request is the browser's or the
 * phone's question. A refusal there is an answer, and the take explains how
 * to change it.
 *
 * Shown once per device (`preferences.microphoneExplained`), and not at all
 * where the microphone is already allowed.
 */
export function MicrophoneIntro({
  onContinue,
  onBack,
}: {
  /** Starts the take, whose own request is the system's question. */
  onContinue: () => void;
  onBack: () => void;
}) {
  return (
    <ScreenContainer footer={<PrimaryButton label="Continue" onPress={onContinue} />}>
      <PageHeader title="InTempo listens while you play" onBack={onBack} backLabel="Back to the piece" />
      <ListeningIllustration />
      <View style={styles.facts}>
        <Fact icon={Mic} text="Only while you record" />
        <Fact icon={FileMusic} text="Saved with the piece" />
        <Fact
          icon={Settings}
          text={Platform.OS === 'web' ? 'Turn it off in your browser' : 'Turn it off in Settings'}
        />
      </View>
    </ScreenContainer>
  );
}

/** One line of what the microphone does and does not do. */
function Fact({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <View style={styles.fact}>
      <Icon size={ICON_SIZE.md} strokeWidth={ICON_STROKE_WIDTH} color={colors.textTertiary} />
      <Text variant="metadata" color="textSecondary" style={styles.factText}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  facts: {
    marginTop: spacing['3xl'],
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 50,
    borderBottomWidth: BORDER_WIDTH,
    borderBottomColor: colors.border,
  },
  factText: {
    flex: 1,
  },
});

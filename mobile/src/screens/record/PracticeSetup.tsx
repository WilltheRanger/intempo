import { Pressable, StyleSheet, View } from 'react-native';

import {
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  Text,
} from '../../components/primitives';
import { ROW_PADDING_VERTICAL, rowDivided } from '../../components/rowMetrics';
import { BORDER_WIDTH, colors, spacing } from '../../design';
import type { PreflightCheck } from '../../lib/record/preflight';

interface PracticeSetupProps {
  title: string;
  /** What the app can actually tell about this take, warnings first. */
  checks: PreflightCheck[];
  onBack: () => void;
  onContinue: () => void;
  /** Resolve a check from here — the entry bar, or the metronome mode. */
  onResolve: (to: 'startBar' | 'metronome') => void;
}

/**
 * What is true about this take, before it is recorded.
 *
 * **This was three static tips**, shown once, about microphone placement and
 * speaker bleed and where the count-in ends. They were good advice and they
 * were the same advice every time, on every piece, whether or not any of it
 * applied — so the screen taught a musician that it had nothing to say, which
 * is how a warning stops being read.
 *
 * The Pre-flight frame's argument is that the app already knows most of this.
 * It knows the metronome will play out loud, because it is the thing playing
 * it. It knows the first six bars of this part are rest and the take is set to
 * start at bar 1. It knows the last take on this device came back silent. None
 * of that needed a new signal; it needed asking.
 *
 * **What is still a tip, because it cannot be a check**: microphone placement,
 * which no browser will tell us about, and which is one line at the foot rather
 * than a third of the screen.
 *
 * The rules are in `lib/record/preflight.ts` with tests. `CLAUDE.md` §3: a rule
 * inside a `.tsx` is a rule nothing checks, and "does this warn when it should"
 * is the kind that stays wrong quietly.
 */
export function PracticeSetup({
  title,
  checks,
  onBack,
  onContinue,
  onResolve,
}: PracticeSetupProps) {
  return (
    <ScreenContainer
      footer={
        <View>
          <PrimaryButton label="Set tempo & record" onPress={onContinue} />
        </View>
      }
    >
      {/*
        **The checks are the subject; the piece is the context.**

        This had the piece as the screen title *and* a second heading of the
        same weight under it — two competing focal points (§3 law 4). At 320pt
        with a real repertoire title that was four lines of serif before the
        actual subject of the screen.
      */}
      <PageHeader
        eyebrow={title}
        title="Ready when you are"
        onBack={onBack}
        backLabel="Back to the piece"
      />

      <View style={styles.checks}>
        {checks.map((check, index) => (
          <CheckRow
            key={check.id}
            check={check}
            divided={rowDivided(index)}
            onResolve={onResolve}
          />
        ))}
      </View>

      {/*
        The one thing here that is advice rather than a reading, kept as
        advice. No browser reports where a phone is sitting.
      */}
      <Text variant="metadataSmall" color="textTertiary" style={styles.permission}>
        Put the phone nearby, mic uncovered, away from anything that rattles.
      </Text>
    </ScreenContainer>
  );
}

/**
 * One reading, with its remedy where it has one.
 *
 * **No verdict colour.** `colors.ts` quarantines that trio to the screen that
 * reports how a take went, and this screen reports how a take is *set up* —
 * a different thing, before a note has been played. So the state is carried by
 * the glyph and by weight: what is wrong is ink and what is fine recedes to
 * secondary, which is the hierarchy §3 law 8 asks for anyway.
 */
function CheckRow({
  check,
  divided,
  onResolve,
}: {
  check: PreflightCheck;
  divided: boolean;
  onResolve: (to: 'startBar' | 'metronome') => void;
}) {
  const warn = check.tone === 'warn';
  return (
    <View style={[styles.check, divided && styles.ruled]}>
      <Text
        variant="button"
        color={warn ? 'textPrimary' : 'textTertiary'}
        style={styles.mark}
        accessibilityElementsHidden
      >
        {warn ? '!' : '✓'}
      </Text>
      <View style={styles.checkCopy}>
        <Text variant="button" color={warn ? 'textPrimary' : 'textSecondary'}>
          {check.title}
        </Text>
        {check.detail ? (
          <Text variant="metadata" color="textSecondary" style={styles.checkBody}>
            {check.detail}
          </Text>
        ) : null}
        {check.action ? (
          <Pressable
            onPress={() => onResolve(check.action!.to)}
            accessibilityRole="button"
            accessibilityLabel={check.action.label}
            style={({ pressed }) => [styles.resolve, pressed && styles.resolvePressed]}
          >
            <Text variant="metadata" color="textPrimary">
              {check.action.label} ›
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  checks: {
    marginTop: spacing['2xl'],
  },
  check: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: ROW_PADDING_VERTICAL,
  },
  ruled: {
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  mark: {
    width: spacing.lg,
    textAlign: 'center',
  },
  checkCopy: {
    flex: 1,
  },
  checkBody: {
    marginTop: spacing.xs,
  },
  resolve: {
    // A 44pt row rather than a line of text, negative-margined back so the
    // extra height does not open a gap under the detail it belongs to.
    minHeight: 44,
    justifyContent: 'center',
    marginTop: spacing.xs,
    marginBottom: -spacing.sm,
  },
  resolvePressed: {
    opacity: 0.6,
  },
  permission: {
    marginTop: spacing.xl,
  },

});

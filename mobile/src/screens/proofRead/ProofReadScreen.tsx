import { useRoute, type RouteProp } from '@react-navigation/native';
import { useGoBack } from '../../navigation/useGoBack';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  EmptyState,
  LoadingState,
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  Text,
} from '../../components/primitives';
import { ROW_PADDING_VERTICAL, rowDivided } from '../../components/rowMetrics';
import { useCorrectScore, usePiece } from '../../data/hooks/usePieces';
import { usePreferences } from '../../data/preferences';
import { BORDER_WIDTH, colors, radii, spacing } from '../../design';
import { impact, ImpactFeedbackStyle } from '../../lib/haptics';
import {
  proposalsFor,
  proposalsSummary,
  type Proposal,
} from '../../lib/notation/proposals';
import type { RootStackParamList } from '../../navigation/types';

/**
 * Checking a reading against what the app thinks is wrong with it.
 *
 * **The reading can be internally consistent and still wrong**, which is the
 * gap this fills. Every other check on the score screen is arithmetic: do the
 * durations sum, did the engraver manage to draw it. A part that reads back at
 * exactly four beats in every bar passes all of them and can still carry C3 on
 * a violin — measured on the live project, and the screen said nothing.
 *
 * **Proposals, not corrections.** Each one names what the reading says, what
 * this would put there instead, and why; the musician takes it or keeps what is
 * there. Keeping is a real answer and is offered as plainly as fixing, because
 * the app is guessing about a page it cannot see — `proposals.ts` says what it
 * is and is not willing to guess about, and is where that judgement is tested.
 *
 * **Nothing is written until Save.** The decisions are held here and applied in
 * one edit, so a musician can work down the page and change their mind, and so
 * a half-answered list never reaches the server. That also makes the arithmetic
 * honest: two proposals about the same bar would each be reasoning about a bar
 * the other had already changed, which is why `proposals.ts` offers only one
 * per bar.
 */
export function ProofReadScreen() {
  const { params } = useRoute<RouteProp<RootStackParamList, 'ProofRead'>>();
  const { data: piece, isPending } = usePiece(params.pieceId);
  const { instrument } = usePreferences();
  const correct = useCorrectScore(params.pieceId);
  /** Proposal id to the answer given, for the ones answered so far. */
  const [taken, setTaken] = useState<Record<string, 'keep' | 'fix'>>({});
  const [failed, setFailed] = useState<string | null>(null);
  // Back is the reading this is about, however the screen was reached — a deep
  // link to `/pieces/x/check` has nothing underneath it.
  const goBack = useGoBack({ route: 'PieceScore', params: { pieceId: params.pieceId } });

  const proposals = useMemo(
    () => proposalsFor(piece?.score, instrument),
    [piece?.score, instrument],
  );

  function answer(id: string, choice: 'keep' | 'fix') {
    impact(ImpactFeedbackStyle.Light);
    setTaken((current) => ({ ...current, [id]: choice }));
  }

  function save() {
    if (!piece?.score) {
      return;
    }
    const fixes = proposals.filter((proposal) => taken[proposal.id] === 'fix');
    if (fixes.length === 0) {
      goBack();
      return;
    }
    setFailed(null);
    // Applied in the order they were listed, which is down the page. Each one
    // touches a different bar — `proposals.ts` offers one per bar — so folding
    // them cannot have two edits disagree about the same arithmetic.
    const corrected = fixes.reduce((score, proposal) => proposal.apply(score), piece.score);
    correct.mutate(corrected, {
      onSuccess: goBack,
      onError: (cause) => setFailed(cause.message),
    });
  }

  if (isPending) {
    return (
      <ScreenContainer>
        <LoadingState />
      </ScreenContainer>
    );
  }

  if (!piece) {
    return (
      <ScreenContainer>
        <EmptyState
          fill
          title="That piece isn't here"
          description="It may have been deleted on another device."
          actionLabel="Back to your library"
          onActionPress={goBack}
        />
      </ScreenContainer>
    );
  }

  if (proposals.length === 0) {
    return (
      <ScreenContainer>
        <PageHeader onBack={goBack} backLabel="Back to score" />
        {/*
          **This is the common case and it has to read as a result**, not as an
          empty list. A musician came here to be told whether the reading is
          worth trusting; "nothing found" is the answer, and it is the good one.
        */}
        <EmptyState
          fill
          title="Nothing looks off"
          actionLabel="Back to score"
          actionTone="primary"
          onActionPress={goBack}
        />
      </ScreenContainer>
    );
  }

  const answered = proposals.filter((proposal) => taken[proposal.id]).length;
  const fixing = proposals.filter((proposal) => taken[proposal.id] === 'fix').length;

  return (
    <ScreenContainer
      footer={
        <View>
          <PrimaryButton
            label={
              fixing === 0
                ? 'Keep as is'
                : fixing === 1
                  ? 'Save 1 fix'
                  : `Save ${fixing} fixes`
            }
            onPress={save}
            disabled={correct.isPending}
          />
          {failed ? (
            <Text variant="metadataSmall" color="textSecondary" style={styles.failed}>
              {failed}
            </Text>
          ) : null}
        </View>
      }
    >
      <PageHeader
        title="Check the reading"
        onBack={goBack}
        backLabel="Back to score"
      />

      <Text variant="body" color="textSecondary" style={styles.summary}>
        {proposalsSummary(proposals.length)}
      </Text>

      {proposals.map((proposal, index) => (
        <ProposalRow
          key={proposal.id}
          proposal={proposal}
          choice={taken[proposal.id]}
          divided={rowDivided(index)}
          onAnswer={answer}
        />
      ))}

      {/*
        What it looked for, at the foot, so the absence of a proposal about a
        bar is not read as a clean bill of health. The app cannot see the page.
      */}
      <Text variant="metadataSmall" color="textTertiary" style={styles.scope}>
        {answered === proposals.length ? 'All answered.' : `${proposals.length - answered} left.`}
      </Text>
    </ScreenContainer>
  );
}

/**
 * One proposal: what is there, what would replace it, and why.
 *
 * **The change is the subject and it is set in the reading face**, because what
 * a musician is judging is a pair of note names, not a sentence about them. The
 * reason recedes underneath, and the two answers sit below that, equal in
 * weight — an app that made "fix" the louder control would be advocating for a
 * guess (§3 laws 4 and 8).
 */
function ProposalRow({
  proposal,
  choice,
  divided,
  onAnswer,
}: {
  proposal: Proposal;
  choice: 'keep' | 'fix' | undefined;
  divided: boolean;
  onAnswer: (id: string, choice: 'keep' | 'fix') => void;
}) {
  return (
    <View style={[styles.row, divided && styles.ruled]}>
      <Text variant="metadataSmall" color="textTertiary">
        {proposal.where}
      </Text>

      <View style={styles.change}>
        {/*
          Struck through only once the musician has chosen to change it. Before
          that it is what their part says, and drawing a line through it would
          be the app deciding first.
        */}
        <Text
          variant="pieceTitle"
          color={choice === 'fix' ? 'textTertiary' : 'textPrimary'}
          style={choice === 'fix' ? styles.struck : undefined}
        >
          {proposal.from}
        </Text>
        <Text variant="metadata" color="textTertiary">
          →
        </Text>
        <Text
          variant="pieceTitle"
          color={choice === 'fix' ? 'textPrimary' : 'textTertiary'}
        >
          {proposal.to}
        </Text>
      </View>

      <Text variant="metadataSmall" color="textSecondary" style={styles.why}>
        {proposal.why}.
      </Text>

      <View style={styles.answers}>
        <Answer
          label={proposal.keepLabel}
          on={choice === 'keep'}
          onPress={() => onAnswer(proposal.id, 'keep')}
        />
        <Answer
          label={proposal.fixLabel}
          on={choice === 'fix'}
          onPress={() => onAnswer(proposal.id, 'fix')}
        />
      </View>
    </View>
  );
}

/** One of the two answers. A choice, so it announces itself as one. */
function Answer({
  label,
  on,
  onPress,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
      aria-checked={on}
      style={({ pressed }) => [styles.answer, on && styles.answerOn, pressed && styles.pressed]}
    >
      <Text variant="metadata" color={on ? 'actionText' : 'textPrimary'}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  summary: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  row: {
    paddingVertical: ROW_PADDING_VERTICAL,
  },
  ruled: {
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  change: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  struck: {
    textDecorationLine: 'line-through',
  },
  why: {
    marginTop: spacing.xs,
  },
  answers: {
    flexDirection: 'row',
    // Wraps, because the two labels are the proposal's own words and a long
    // one is ordinary: "Drop the repeat" beside "Leave it" already runs off
    // the right edge at doubled text. Found by the audit's 2x sweep, which is
    // what it is for.
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  answer: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.borderStrong,
  },
  answerOn: {
    backgroundColor: colors.actionBg,
    borderColor: colors.actionBg,
  },
  pressed: {
    opacity: 0.7,
  },
  scope: {
    marginTop: spacing.xl,
  },
  failed: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
});

import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  EmptyState,
  LoadingState,
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  Text,
} from '../../components/primitives';
import { useCorrectScore, usePiece } from '../../data/hooks/usePieces';
import type { ScoreJson, ScoreNote } from '../../data/types';
import { BORDER_WIDTH, colors, radii, spacing } from '../../design';
import { impact, ImpactFeedbackStyle } from '../../lib/haptics';
import {
  DURATION_LABELS,
  EDITABLE_DURATIONS,
  describeBeats,
} from '../../lib/notation/reading';
import type { RootStackParamList } from '../../navigation/types';

/**
 * Fixing a measure whose durations do not add up.
 *
 * **This is the step the spec always required and the build skipped.**
 * `intempo-combined.md:447` lists "Score preview & edit — user must be able to
 * correct without re-shooting" as an MVP feature, on the reasoning that OCR
 * will miss things. Without it every misread was terminal: one wrong duration
 * meant re-photographing the page or abandoning the piece.
 *
 * **Durations and rests only, deliberately.** They are the only things the
 * verdict reads — `alignment.py` accumulates durations to build its expected
 * timeline and asks of pitch only whether it is `"rest"`. A wrong duration
 * shifts every bar after it; a wrong pitch is visible on the stave and
 * harmless to the analysis. Fixing the harmful thing fast beats fixing
 * everything slowly.
 *
 * The beat total is the one dominant element (§3 law 4): it is what says
 * whether the work is done, and everything else on the screen is in service
 * of moving it.
 */
export function MeasureEditScreen() {
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<RootStackParamList, 'MeasureEdit'>>();
  const { data: piece, isPending } = usePiece(params.pieceId);
  const correct = useCorrectScore(params.pieceId);

  const original = useMemo(
    () =>
      piece?.score?.measures.find((m) => m.measure_number === params.measureNumber) ?? null,
    [piece?.score, params.measureNumber],
  );

  const [notes, setNotes] = useState<ScoreNote[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Seeded from the score the first time it arrives, then owned locally so a
  // background refetch cannot discard edits in progress.
  const working = notes ?? original?.notes ?? null;

  if (isPending) {
    return (
      <ScreenContainer>
        <LoadingState />
      </ScreenContainer>
    );
  }

  if (!piece?.score || !original || !working) {
    return (
      <ScreenContainer>
        <EmptyState
          title="That measure isn't there"
          description="It may have been corrected already, or the piece re-read."
          actionLabel="Back"
          onActionPress={() => navigation.goBack()}
        />
      </ScreenContainer>
    );
  }

  const beats = describeBeats(working, piece.score.time_signature);

  function change(patch: Partial<ScoreNote>) {
    if (!working) {
      return;
    }
    impact(ImpactFeedbackStyle.Light);
    setNotes(working.map((note, i) => (i === selected ? { ...note, ...patch } : note)));
  }

  async function save() {
    if (!piece?.score || !working) {
      return;
    }
    setError(null);
    const corrected: ScoreJson = {
      ...piece.score,
      measures: piece.score.measures.map((m) =>
        m.measure_number === params.measureNumber ? { ...m, notes: working } : m,
      ),
    };
    try {
      await correct.mutateAsync(corrected);
      navigation.goBack();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'That could not be saved. Try again.',
      );
    }
  }

  const current = working[selected];

  return (
    <ScreenContainer scrollable={false}>
      <PageHeader
        eyebrow={piece.title}
        title={`Bar ${params.measureNumber}`}
        onBack={() => navigation.goBack()}
        backLabel="Back to score"
      />

      {/*
        The focal point. It is the only thing on screen that answers "am I
        done", so it is the only thing set in the display face — and it turns
        from a warning colour to ordinary ink the moment the bar balances,
        which is feedback that needs no label.
      */}
      <Text
        variant="heroTitle"
        style={[styles.beats, !beats.balanced && styles.beatsOff]}
      >
        {beats.text}
      </Text>
      <Text variant="metadataSmall" color="textTertiary">
        {beats.expected === null
          ? 'No time signature was read for this piece, so there is nothing to check against.'
          : beats.balanced
            ? 'This bar adds up. Save it, or keep adjusting.'
            : 'Tap a note, then choose what it should be.'}
      </Text>

      <View style={styles.spacer} />

      {/*
        The bar, in reading order. Horizontal because that is how the music is
        written, and scrollable because a busy bar can hold a dozen notes —
        wrapping them into rows would break the one thing this layout is for.
      */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.bar}
        style={styles.barScroll}
      >
        {working.map((note, i) => (
          <Pressable
            key={i}
            onPress={() => {
              impact(ImpactFeedbackStyle.Light);
              setSelected(i);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: i === selected }}
            accessibilityLabel={`Note ${i + 1}, ${DURATION_LABELS[note.duration] ?? note.duration}${
              note.pitch === 'rest' ? ', rest' : `, ${note.pitch}`
            }`}
            style={[styles.note, i === selected && styles.noteSelected]}
          >
            <Text variant="metadata">{DURATION_LABELS[note.duration] ?? note.duration}</Text>
            <Text variant="metadataSmall" color="textTertiary">
              {note.pitch === 'rest' ? 'rest' : note.pitch}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/*
        The controls sit last, nearest the thumb (§3 law 7), because they are
        what the hand is doing repeatedly while the eye stays on the total
        above.
      */}
      <Text variant="sectionLabel" color="textSecondary">
        Note {selected + 1} of {working.length}
      </Text>

      <View style={styles.durations}>
        {EDITABLE_DURATIONS.map((duration) => (
          <Pressable
            key={duration}
            onPress={() => change({ duration })}
            accessibilityRole="button"
            accessibilityState={{ selected: current?.duration === duration }}
            style={[styles.chip, current?.duration === duration && styles.chipOn]}
          >
            <Text
              variant="metadataSmall"
              color={current?.duration === duration ? 'actionText' : 'textPrimary'}
            >
              {DURATION_LABELS[duration]}
            </Text>
          </Pressable>
        ))}
      </View>

      {/*
        A rest is not a pitch, and it is the one non-duration fact the verdict
        reads: `alignment.py` emits no onset for a rest, so getting it wrong
        adds or removes a phantom note and shifts everything after it.
      */}
      <Pressable
        onPress={() =>
          change({ pitch: current?.pitch === 'rest' ? (original?.notes[selected]?.pitch ?? 'C4') : 'rest' })
        }
        accessibilityRole="switch"
        accessibilityState={{ checked: current?.pitch === 'rest' }}
        style={[styles.chip, styles.restToggle, current?.pitch === 'rest' && styles.chipOn]}
      >
        <Text
          variant="metadataSmall"
          color={current?.pitch === 'rest' ? 'actionText' : 'textPrimary'}
        >
          Rest
        </Text>
      </Pressable>

      {error ? (
        <Text variant="metadataSmall" color="textSecondary" style={styles.error}>
          {error}
        </Text>
      ) : null}

      <PrimaryButton
        label="Save this bar"
        onPress={() => void save()}
        loading={correct.isPending}
        disabled={correct.isPending || notes === null}
        style={styles.save}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  beats: {
    marginTop: spacing.xl,
  },
  beatsOff: {
    color: colors.verdictBad,
  },
  barScroll: {
    // Grouped with the controls below rather than floated under the status
    // above: tapping a note and then a duration is one gesture pair, and
    // splitting them across the screen makes the hand travel for every note.
    marginBottom: spacing.xl,
    flexGrow: 0,
  },
  bar: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingRight: spacing.xl,
  },
  // A hairline cell, not a card (§3 laws 3 and 6). The selected one is marked
  // by a heavier rule, which is the least ink that reads as "this one".
  note: {
    minWidth: 76,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderBottomWidth: BORDER_WIDTH,
    borderBottomColor: colors.border,
  },
  noteSelected: {
    borderBottomWidth: 2,
    borderBottomColor: colors.accent,
  },
  spacer: {
    flex: 1,
  },
  durations: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
  },
  chipOn: {
    backgroundColor: colors.actionBg,
    borderColor: colors.actionBg,
  },
  restToggle: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
  },
  error: {
    marginTop: spacing.lg,
  },
  save: {
    marginTop: spacing.xl,
  },
});

import { useRoute, type RouteProp } from '@react-navigation/native';
import { useGoBack } from '../../navigation/useGoBack';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  EmptyState,
  Input,
  LoadingState,
  BackLink,
  PrimaryButton,
  ScreenContainer,
  Text,
} from '../../components/primitives';
import { BottomSheet } from '../../components/overlays/BottomSheet';
import { useCorrectScore, usePiece } from '../../data/hooks/usePieces';
import type { Clef, ScoreJson, ScoreNote, ScoreTempoChange } from '../../data/types';
import { Minus, Plus } from '../../components/icons';
import {
  BORDER_WIDTH,
  colors,
  fontFamily,
  pressedOpacity,
  radii,
  spacing,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
} from '../../design';
import { impact, ImpactFeedbackStyle } from '../../lib/haptics';
import {
  DURATION_LABELS,
  EDITABLE_DURATIONS,
  cycleAccidental,
  describeBeats,
  stepPitch,
} from '../../lib/notation/reading';
import {
  marksAfterDelete,
  marksAfterInsert,
  marksOf,
  type MeasureMarks,
} from '../../lib/notation/spans';
import type { RootStackParamList } from '../../navigation/types';
import {
  KEY_SIGNATURE_CHOICES,
  applyKeySignatureEdit,
  describeKeySignature,
  keyBeforeMeasure,
  sameEditableSignature,
} from './keySignatureEdit';
import {
  CLEF_CHOICES,
  applyClefEdit,
  clefBeforeMeasure,
  describeClef,
} from './clefEdit';
import { timeSignaturesByMeasure } from '../../lib/notation/meter';
import {
  TEMPO_MARK_CHOICES,
  applyTempoMarkEdit,
  choiceOf,
  describeTempoMark,
  markFor,
  nextMetronomeMark,
  printedAfterStep,
  startingBpm,
  statedTempoBefore,
  tempoMarksAt,
  usualPrinted,
  type TempoMarkChoice,
} from './tempoMarkEdit';

/**
 * Fixing a measure whose durations do not add up.
 *
 * **This is the step the spec always required and the build skipped.**
 * `intempo-combined.md:447` lists "Score preview & edit — user must be able to
 * correct without re-shooting" as an MVP feature, on the reasoning that OCR
 * will miss things. Without it every misread was terminal: one wrong duration
 * meant re-photographing the page or abandoning the piece.
 *
 * **Durations and rests lead, because they are what the verdict reads.**
 * `alignment.py` accumulates durations to build its expected timeline and asks
 * of pitch only whether it is `"rest"`, so a wrong duration shifts every bar
 * after it while a wrong pitch is merely visible on the stave. Pitch is
 * editable too — it is what makes the engraving and playback trustworthy to
 * look at — but it sits below the durations and behind one more tap.
 *
 * Adding and deleting a note matters for the errors durations cannot fix: OCR
 * inventing a notehead that is not there, or missing one entirely. Changing
 * every duration in a bar cannot correct either.
 *
 * The beat total is the one dominant element (§3 law 4): it is what says
 * whether the work is done, and everything else on the screen is in service
 * of moving it.
 */
export function MeasureEditScreen() {
  const { params } = useRoute<RouteProp<RootStackParamList, 'MeasureEdit'>>();
  const goBack = useGoBack({
    route: 'PieceScore',
    params: { pieceId: params.pieceId },
  });
  const { data: piece, isPending } = usePiece(params.pieceId);
  const correct = useCorrectScore(params.pieceId);

  const original = useMemo(
    () =>
      piece?.score?.measures.find((m) => m.measure_number === params.measureNumber) ?? null,
    [piece?.score, params.measureNumber],
  );

  const [notes, setNotes] = useState<ScoreNote[] | null>(null);
  // Slurs and brackets address notes by index, so they have to move whenever a
  // note is added or removed. Held here rather than read back from the score at
  // save time, which is what left them pointing at the wrong notes.
  const [marks, setMarks] = useState<MeasureMarks | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /**
   * Null means untouched; a wrapped null means the musician deliberately
   * removed the opening signature or the change printed at this bar.
   */
  const [keyEdit, setKeyEdit] = useState<{ value: string | null } | null>(null);
  const [clefEdit, setClefEdit] = useState<{ value: Clef | null } | null>(null);
  const [pickingClef, setPickingClef] = useState(false);
  const [pickingKey, setPickingKey] = useState(false);
  /** The tempo marking at this bar, as `keyEdit`: null untouched, a wrapped null removed. */
  const [tempoEdit, setTempoEdit] = useState<{ value: ScoreTempoChange | null } | null>(null);
  const [pickingTempo, setPickingTempo] = useState(false);
  // What the tempo sheet holds while it is open, committed by "Done".
  const [sheetChoice, setSheetChoice] = useState<TempoMarkChoice | null>(null);
  const [sheetPrinted, setSheetPrinted] = useState('');
  const [sheetBpm, setSheetBpm] = useState(100);

  // Seeded from the score the first time it arrives, then owned locally so a
  // background refetch cannot discard edits in progress.
  const working = notes ?? original?.notes ?? null;
  const workingMarks = marks ?? (original ? marksOf(original) : null);

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
          fill
          title="That measure isn't there"
          description="It may have been corrected already, or the piece re-read."
          actionLabel="Back"
          onActionPress={goBack}
        />
      </ScreenContainer>
    );
  }

  // **Which bar this is, not what it is numbered.** The score's first measure
  // may legitimately be short — an anacrusis — and `describeBeats` cannot know
  // that on its own. Compared by identity against the score's own first
  // measure rather than against `measure_number === 1`, because a score read
  // off page two of a part starts at bar 30.
  const isFirstBar = piece.score.measures[0]?.measure_number === original.measure_number;
  const savedKey = isFirstBar
    ? piece.score.key_signature ?? null
    : original.key_signature ?? null;
  const workingKey = keyEdit === null ? savedKey : keyEdit.value;
  const keyBefore = keyBeforeMeasure(piece.score, original.measure_number);
  const keyDescription = workingKey
    ? describeKeySignature(workingKey)
    : isFirstBar
      ? 'Unknown'
      : 'No change';
  /*
    **The metre in force at this bar, not the page's opening metre.** A part
    that turns 3/4 at bar 3 has correct three-beat bars after it, and judging
    them against the header's 4/4 told the musician a right bar was short and
    invited them to add a beat the page does not print. `timeSignaturesByMeasure`
    is the same walk the metronome and the practice cues already use, so the
    click and the bar check now agree about what a bar should hold — they did
    not before.
  */
  const meterHere =
    timeSignaturesByMeasure(piece.score).get(original.measure_number) ??
    piece.score.time_signature;
  const beats = describeBeats(working, meterHere, {
    first: isFirstBar,
  });

  // The clef, on exactly the same footing as the key beside it.
  const savedClef = isFirstBar
    ? piece.score.clef ?? null
    : original.clef ?? null;
  const workingClef = clefEdit === null ? savedClef : clefEdit.value;
  const clefBefore = clefBeforeMeasure(piece.score, original.measure_number);
  const clefDescription = workingClef
    ? describeClef(workingClef)
    : isFirstBar
      ? 'Unknown'
      : 'No change';

  // The tempo marking printed at this bar, and the tempo in force as it
  // begins — what a new tempo's stepper starts from and is compared with.
  const savedTempo = tempoMarksAt(piece.score, params.measureNumber)[0] ?? null;
  const workingTempo = tempoEdit === null ? savedTempo : tempoEdit.value;
  const tempoBefore =
    statedTempoBefore(piece.score, params.measureNumber) ?? piece.score.bpm_hint ?? sheetBpm;
  const tempoDescription = describeTempoMark(workingTempo);

  function openTempo() {
    if (!piece?.score) {
      return;
    }
    setSheetChoice(workingTempo ? choiceOf(workingTempo) : null);
    setSheetPrinted(workingTempo?.text ?? '');
    setSheetBpm(workingTempo?.bpm ?? startingBpm(piece.score, params.measureNumber));
    setPickingTempo(true);
  }

  function chooseTempo(choice: TempoMarkChoice | null) {
    impact(ImpactFeedbackStyle.Light);
    setSheetChoice(choice);
    setSheetPrinted(choice === null ? '' : usualPrinted(choice, sheetBpm, tempoBefore));
  }

  function stepTempo(direction: 1 | -1) {
    impact(ImpactFeedbackStyle.Light);
    const next = nextMetronomeMark(sheetBpm, direction);
    setSheetBpm(next);
    setSheetPrinted((printed) => printedAfterStep(printed, next, tempoBefore));
  }

  function commitTempo() {
    setTempoEdit({
      value:
        sheetChoice === null
          ? null
          : markFor(
              sheetChoice,
              params.measureNumber,
              sheetPrinted,
              sheetChoice === 'new_tempo' ? sheetBpm : null,
            ),
    });
    setPickingTempo(false);
  }

  function change(patch: Partial<ScoreNote>) {
    if (!working) {
      return;
    }
    impact(ImpactFeedbackStyle.Light);
    setNotes(working.map((note, i) => (i === selected ? { ...note, ...patch } : note)));
  }

  function addNote() {
    if (!working) {
      return;
    }
    impact(ImpactFeedbackStyle.Light);
    // Copied from the selected note rather than invented: a new note beside a
    // run of eighths is almost always another eighth, and a default of
    // "quarter" would be one more thing to fix.
    const copy = { ...working[selected] };
    const at = selected + 1;
    setNotes([...working.slice(0, at), copy, ...working.slice(at)]);
    setMarks(marksAfterInsert(workingMarks ?? { slurs: [], tuplets: [] }, at));
    setSelected(at);
  }

  function deleteNote() {
    if (!working || working.length <= 1) {
      return;
    }
    impact(ImpactFeedbackStyle.Light);
    setNotes(working.filter((_, i) => i !== selected));
    setMarks(marksAfterDelete(workingMarks ?? { slurs: [], tuplets: [] }, selected));
    setSelected(Math.max(0, selected - 1));
  }

  async function save() {
    if (!piece?.score || !working) {
      return;
    }
    setError(null);
    const withNotes: ScoreJson = {
      ...piece.score,
      measures: piece.score.measures.map((m) =>
        m.measure_number === params.measureNumber
          // The marks go back with the notes. Spreading the measure and
          // replacing only `notes` kept the *original* indices, so a bar that
          // gained or lost a note came back with every slur after that point
          // pointing one note out of place — and a slur decides which notes are
          // timed at all.
          ? {
              ...m,
              notes: working,
              ...(workingMarks ?? {}),
            }
          : m,
      ),
    };
    // Use the same pure update path exercised by keySignatureEdit.test.ts:
    // opening signatures belong to the score header, while later signatures
    // belong only to the bar where the printed change begins.
    const withKey =
      keyEdit === null
        ? withNotes
        : applyKeySignatureEdit(withNotes, params.measureNumber, workingKey);
    const withClef =
      clefEdit === null
        ? withKey
        : applyClefEdit(withKey, params.measureNumber, workingClef);
    const corrected =
      tempoEdit === null
        ? withClef
        : applyTempoMarkEdit(withClef, params.measureNumber, tempoEdit.value);
    try {
      await correct.mutateAsync(corrected);
      goBack();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'That could not be saved. Try again.',
      );
    }
  }

  const current = working[selected];

  return (
    /*
      **Scrolling, and Save pinned.** This screen was a fixed column with the
      Save button as its last child, which broke twice on a 320pt phone — an
      iPhone SE, still in use:

       - The duration chips wrap to more rows at that width, so the column
         overflowed, and flexbox took the deficit out of the one child that
         could shrink: the note strip, which collapsed to **zero height**.
         Measured 280x0 at 320pt against 350x19 at 390pt. No notes on screen
         means no note to select, which means the editor cannot edit anything.
       - **Save was clipped off the bottom** along with Add note and Delete
         note, so a correction could not be kept either.

      A scroll view cannot squeeze its children, which fixes the first, and the
      footer is always on screen, which fixes the second. The error line goes in
      the footer with the button it belongs to: a save that failed must not
      report it above the fold.
    */
    <ScreenContainer
      footer={
        <View>
          {error ? (
            <Text variant="metadataSmall" color="textSecondary" style={styles.footerError}>
              {error}
            </Text>
          ) : null}
          <PrimaryButton
            label="Save"
            onPress={() => void save()}
            loading={correct.isPending}
            disabled={
              correct.isPending ||
              (notes === null && keyEdit === null && clefEdit === null && tempoEdit === null)
            }
          />
        </View>
      }
    >
      {/*
        The redesign's head (`redesign/MeasureEdit.dc.html`): which piece, then
        one line — "Bar 12 · 3 of 4 beats" — where the count is the part that
        changes. It turns from the accent to ordinary ink the moment the bar
        balances, which is feedback that needs no label.

        **Not `verdictBad`**, which this screen may not use: `colors.ts`
        quarantines that trio to surfaces reporting how a *take* went, and a
        bar whose durations do not sum is arithmetic about a photograph.
      */}
      <View style={styles.head}>
        <BackLink label="Back to score" onPress={goBack} />
        <View style={styles.barLine} accessibilityRole="header">
          <Text style={styles.barName}>Bar {params.measureNumber}</Text>
          <Text color="textTertiary" style={styles.barName}>
            {' · '}
          </Text>
          <Text style={[styles.barName, !beats.balanced && styles.beatsOff]}>{beats.text}</Text>
        </View>
      </View>
      {/*
        Only when there is something to do. A bar that adds up, or a pickup,
        says so in the beat count above; a sentence repeating it was noise.
      */}
      {beats.expected !== null && !beats.pickup && !beats.balanced ? (
        <Text variant="metadataSmall" color="textTertiary">
          Tap a note to change it.
        </Text>
      ) : null}


      {/*
        A key signature is bar-level music, not a property of one note.

        The first bar edits the page header. On every later bar, null means the
        previous signature continues; choosing C major / A minor is different
        because it prints cancellation naturals when something else was in
        force. A text input would make those two cases easy to confuse and
        invite spellings the engraver cannot read, so this opens the complete
        set of fifteen printed signatures.
      */}
      <Text variant="caption" color="textTertiary" style={styles.keyLabel}>
        {isFirstBar ? 'Opening key' : 'Key'}
      </Text>
      <Pressable
        onPress={() => setPickingKey(true)}
        accessibilityRole="button"
        accessibilityLabel={`Change key signature. ${keyDescription}`}
        style={({ pressed }) => [styles.keySetting, pressed && styles.pressed]}
      >
        <View style={styles.keyCopy}>
          <Text variant="body" style={styles.settingValue}>{keyDescription}</Text>
        </View>
        <Text variant="metadata" color="accentText" style={styles.change}>
          Change
        </Text>
      </Pressable>

      {/*
        And the clef, which is bar-level music for the same reason.

        A cello or bass part climbing into tenor for a high passage is ordinary
        writing, and a reader that misses the change places every note after it
        a sixth off — so a misread one had to be correctable without
        re-scanning the page.
      */}
      <Text variant="caption" color="textTertiary" style={styles.keyLabel}>
        {isFirstBar ? 'Opening clef' : 'Clef'}
      </Text>
      <Pressable
        onPress={() => setPickingClef(true)}
        accessibilityRole="button"
        accessibilityLabel={`Change clef. ${clefDescription}`}
        style={({ pressed }) => [styles.keySetting, pressed && styles.pressed]}
      >
        <View style={styles.keyCopy}>
          <Text variant="body" style={styles.settingValue}>{clefDescription}</Text>
          {!isFirstBar && workingClef === null ? (
            <Text variant="metadataSmall" color="textTertiary">
              Choose a clef only if a new one is printed at this bar.
            </Text>
          ) : null}
        </View>
        <Text variant="metadata" color="accentText" style={styles.change}>
          Change
        </Text>
      </Pressable>

      {/*
        A tempo change printed at this bar — "poco rit.", "a tempo", "meno
        mosso". The page's reader sees notes, not words (the owner, 2026-09-25:
        "how am I supposed to account for tempo variations or where it says
        poco"), so a musician marks it here, where the key and clef are.
      */}
      <Text variant="caption" color="textTertiary" style={styles.keyLabel}>
        Tempo
      </Text>
      <Pressable
        onPress={openTempo}
        accessibilityRole="button"
        accessibilityLabel={`Change the tempo marking. ${tempoDescription}`}
        style={({ pressed }) => [styles.keySetting, pressed && styles.pressed]}
      >
        <View style={styles.keyCopy}>
          <Text variant="body" style={styles.settingValue}>{tempoDescription}</Text>
          {workingTempo === null ? (
            <Text variant="metadataSmall" color="textTertiary">
              Mark one where the page prints it.
            </Text>
          ) : null}
        </View>
        <Text variant="metadata" color="accentText" style={styles.change}>
          Change
        </Text>
      </Pressable>

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
            aria-pressed={i === selected}
            accessibilityLabel={`Note ${i + 1}, ${DURATION_LABELS[note.duration] ?? note.duration}${
              note.pitch === 'rest' ? ', rest' : `, ${note.pitch}`
            }`}
            style={({ pressed }) => [styles.note, i === selected && styles.noteSelected, pressed && styles.pressed]}
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
            aria-pressed={current?.duration === duration}
            style={({ pressed }) => [styles.chip, current?.duration === duration && styles.chipOn, pressed && styles.pressed]}
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
        A rest sits with the durations, not with the pitch controls, because
        it is read by the same thing they are: `alignment.py` emits no onset
        for a rest, so getting it wrong adds or removes a phantom note and
        shifts everything after it. Pitch, below, is read by nothing in the
        analysis at all.

        Rest and tie share one row (`redesign/MeasureEdit.dc.html`): the two
        marks that change the timeline rather than the note's length.
      */}
      <View style={styles.markRow}>
        <Pressable
          onPress={() =>
            change(
              current?.pitch === 'rest'
                ? { pitch: original?.notes[selected]?.pitch ?? 'C4' }
                : // **A rest cannot be tied.** `readTies` already ignores a tie
                  // on a rest, so nothing misreads it — but leaving the flag set
                  // stores a tie the page never had, and it would reappear the
                  // moment the rest was turned back into a note.
                  { pitch: 'rest', tied_to_next: false },
            )
          }
          accessibilityRole="switch"
          // **Both spellings.** react-native-web emits `aria-checked` and does
          // not derive it from `accessibilityState`, so on the web this switch
          // announced its label and never whether it was on. Two other screens
          // already knew this and said so in their own comments; this one did not.
          accessibilityState={{ checked: current?.pitch === 'rest' }}
          aria-checked={current?.pitch === 'rest'}
          style={({ pressed }) => [
            styles.chip,
            styles.restToggle,
            current?.pitch === 'rest' && styles.chipOn,
            pressed && styles.pressed,
          ]}
        >
          <Text
            variant="metadataSmall"
            color={current?.pitch === 'rest' ? 'actionText' : 'textPrimary'}
          >
            Rest
          </Text>
        </Pressable>

        {/*
          **A tie, because the app flags a broken one and could not fix it.**

          `validate.py` reports a tie between two different pitches — a slur
          written as a tie, or a misread notehead — and the score screen sends the
          musician here to correct it. The editor could change the *pitch*, which
          fixes one of those two readings, and had no way at all to say "that is
          not a tie". A screen that names a fault and offers no way to repair it
          is a dead end with directions on it.

          It is also the same argument that put pitch here: a tie removes an
          onset. `scheduleScore` folds a tied note into one sound and
          `alignment.py` expects one attack, so a tie the page never had costs the
          musician a note the analysis is waiting for.

          Beside the rest toggle rather than with the pitch controls, because
          those two are the marks that change the *timeline*; pitch below is read
          by nothing in the analysis.
        */}
        {current && current.pitch !== 'rest' ? (
          <Pressable
            onPress={() => change({ tied_to_next: !current.tied_to_next })}
            accessibilityRole="switch"
            accessibilityLabel="Tie to the next note"
            accessibilityState={{ checked: current.tied_to_next === true }}
            aria-checked={current.tied_to_next === true}
            style={({ pressed }) => [
              styles.chip,
              styles.restToggle,
              current.tied_to_next && styles.chipOn,
              pressed && styles.pressed,
            ]}
          >
            <Text
              variant="metadataSmall"
              color={current.tied_to_next ? 'actionText' : 'textPrimary'}
            >
              Tie to next
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/*
        Pitch, one row below the durations and deliberately quieter.

        Stepping by *letter* rather than semitone: a musician correcting a
        misread notehead is moving it a line or a space, so F♯ → G is one step
        and F → F♯ is the accidental button, not the same control.
      */}
      {current && current.pitch !== 'rest' ? (
        // The redesign's stepper (`redesign/MeasureEdit.dc.html`): lower and
        // raise either side of the note's name, and the name itself cycles
        // the accidental.
        <View style={styles.pitchStepper}>
          <Pressable
            onPress={() => change({ pitch: stepPitch(current.pitch, -1) })}
            accessibilityRole="button"
            accessibilityLabel="Lower this note"
            style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
          >
            <Minus size={ICON_SIZE.md} strokeWidth={ICON_STROKE_WIDTH} color={colors.textPrimary} />
          </Pressable>
          <Pressable
            onPress={() => change({ pitch: cycleAccidental(current.pitch) })}
            accessibilityRole="button"
            accessibilityLabel={`${current.pitch}. Change the accidental`}
            style={({ pressed }) => [styles.pitchName, pressed && styles.pressed]}
          >
            <Text style={styles.pitchText}>{prettyPitch(current.pitch)}</Text>
          </Pressable>
          <Pressable
            onPress={() => change({ pitch: stepPitch(current.pitch, 1) })}
            accessibilityRole="button"
            accessibilityLabel="Raise this note"
            style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
          >
            <Plus size={ICON_SIZE.md} strokeWidth={ICON_STROKE_WIDTH} color={colors.textPrimary} />
          </Pressable>
        </View>
      ) : null}

      {/*
        Adding and removing notes. The errors changing a duration cannot fix:
        OCR inventing a notehead that is not there, or missing one entirely.

        Delete is refused on the last note — a measure with no notes is not a
        correction, it is a hole, and `validate.py` reports an empty bar as a
        sign that something which was not a measure was counted as one.
      */}
      {/* Words, not chips: two actions on the bar, not two more choices. */}
      <View style={styles.noteActions}>
        <Pressable
          onPress={addNote}
          accessibilityRole="button"
          accessibilityLabel="Add a note after this one"
          style={({ pressed }) => [styles.noteAction, pressed && styles.pressed]}
        >
          <Text variant="body" style={styles.noteActionText}>
            Add note
          </Text>
        </Pressable>
        <Pressable
          onPress={deleteNote}
          disabled={working.length <= 1}
          accessibilityRole="button"
          accessibilityLabel="Delete this note"
          style={({ pressed }) => [styles.noteAction, pressed && styles.pressed]}
        >
          <Text
            variant="body"
            color={working.length <= 1 ? 'borderStrong' : 'textTertiary'}
            style={styles.noteActionText}
          >
            Delete note
          </Text>
        </Pressable>
      </View>

      <BottomSheet
        visible={pickingKey}
        onClose={() => setPickingKey(false)}
        title={isFirstBar ? 'Opening key signature' : `Key at bar ${params.measureNumber}`}
        expand
      >
        <Text variant="body" color="textSecondary" style={styles.keyHelp}>
          {isFirstBar
            ? 'Choose the sharps or flats printed at the beginning of the piece.'
            : 'Choose a new signature only when one is printed at this bar. Otherwise keep the previous key.'}
        </Text>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.keyChoices}
        >
          <Pressable
            onPress={() => {
              setKeyEdit({ value: null });
              setPickingKey(false);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: workingKey === null }}
            aria-pressed={workingKey === null}
            style={({ pressed }) => [styles.keyChoice, workingKey === null && styles.keyChoiceOn, pressed && styles.pressed]}
          >
            <Text variant="metadata">
              {isFirstBar ? 'Key signature unknown' : 'No new signature at this bar'}
            </Text>
            {!isFirstBar ? (
              <Text variant="metadataSmall" color="textTertiary">
                {describeKeySignature(keyBefore)} continues
              </Text>
            ) : null}
          </Pressable>

          {KEY_SIGNATURE_CHOICES.map((choice) => {
            const selectedChoice = sameEditableSignature(workingKey, choice.value);
            return (
              <Pressable
                key={choice.value}
                onPress={() => {
                  setKeyEdit({ value: choice.value });
                  setPickingKey(false);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedChoice }}
                aria-pressed={selectedChoice}
                style={({ pressed }) => [styles.keyChoice, selectedChoice && styles.keyChoiceOn, pressed && styles.pressed]}
              >
                <Text variant="metadata">{choice.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </BottomSheet>

      <BottomSheet
        visible={pickingClef}
        onClose={() => setPickingClef(false)}
        title={isFirstBar ? 'Opening clef' : `Clef at bar ${params.measureNumber}`}
        expand
      >
        <Text variant="body" color="textSecondary" style={styles.keyHelp}>
          {isFirstBar
            ? 'Choose the clef printed at the beginning of the piece.'
            : 'Choose a new clef only when one is printed at this bar. Otherwise keep the previous clef.'}
        </Text>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.keyChoices}
        >
          <Pressable
            onPress={() => {
              setClefEdit({ value: null });
              setPickingClef(false);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: workingClef === null }}
            aria-pressed={workingClef === null}
            style={({ pressed }) => [styles.keyChoice, workingClef === null && styles.keyChoiceOn, pressed && styles.pressed]}
          >
            <Text variant="metadata">
              {isFirstBar ? 'Clef not read' : 'No new clef at this bar'}
            </Text>
            {!isFirstBar ? (
              <Text variant="metadataSmall" color="textTertiary">
                {describeClef(clefBefore)} continues
              </Text>
            ) : null}
          </Pressable>

          {CLEF_CHOICES.map((choice) => {
            const selectedChoice = workingClef === choice.value;
            return (
              <Pressable
                key={choice.value}
                onPress={() => {
                  setClefEdit({ value: choice.value });
                  setPickingClef(false);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedChoice }}
                aria-pressed={selectedChoice}
                style={({ pressed }) => [styles.keyChoice, selectedChoice && styles.keyChoiceOn, pressed && styles.pressed]}
              >
                <Text variant="metadata">{choice.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </BottomSheet>

      <BottomSheet
        visible={pickingTempo}
        onClose={() => setPickingTempo(false)}
        title={`Tempo at bar ${params.measureNumber}`}
        expand
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.keyChoices}
          keyboardShouldPersistTaps="handled"
        >
          {[{ value: null, label: 'No change at this bar' }, ...TEMPO_MARK_CHOICES].map((choice) => {
            const chosen = sheetChoice === choice.value;
            return (
              <Pressable
                key={choice.value ?? 'none'}
                onPress={() => chooseTempo(choice.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: chosen }}
                aria-pressed={chosen}
                style={({ pressed }) => [styles.keyChoice, chosen && styles.keyChoiceOn, pressed && styles.pressed]}
              >
                <Text variant="metadata">{choice.label}</Text>
              </Pressable>
            );
          })}

          {sheetChoice === 'new_tempo' ? (
            // Through the marks on a metronome, which is how a page states one.
            <View style={styles.pitchStepper}>
              <Pressable
                onPress={() => stepTempo(-1)}
                accessibilityRole="button"
                accessibilityLabel="Slower"
                style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
              >
                <Minus size={ICON_SIZE.md} strokeWidth={ICON_STROKE_WIDTH} color={colors.textPrimary} />
              </Pressable>
              <View style={styles.pitchName} accessibilityLiveRegion="polite">
                <Text style={styles.pitchText}>{sheetBpm}</Text>
                <Text variant="metadataSmall" color="textTertiary">BPM</Text>
              </View>
              <Pressable
                onPress={() => stepTempo(1)}
                accessibilityRole="button"
                accessibilityLabel="Faster"
                style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
              >
                <Plus size={ICON_SIZE.md} strokeWidth={ICON_STROKE_WIDTH} color={colors.textPrimary} />
              </Pressable>
            </View>
          ) : null}

          {sheetChoice !== null ? (
            <View style={styles.tempoPrinted}>
              <Input
                label="As printed"
                value={sheetPrinted}
                onChangeText={setSheetPrinted}
                placeholder={usualPrinted(sheetChoice, sheetBpm, tempoBefore) || 'meno mosso'}
                autoCapitalize="none"
              />
            </View>
          ) : null}

          <PrimaryButton label="Done" onPress={commitTempo} style={styles.tempoDone} />
        </ScrollView>
      </BottomSheet>

    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  tempoPrinted: {
    marginTop: spacing.xl,
  },
  tempoDone: {
    marginTop: spacing.xl,
  },
  /*
    Every tappable thing on this screen acknowledges the touch. These were bare
    `Pressable`s with a static style, so a tap produced no response at all until
    whatever it triggered appeared — which on a slow action reads as the control
    being dead. `PressableScale` is for the large targets; the app's answer for
    small ones is a colour or opacity change, and these had neither.
  */
  pressed: {
    opacity: pressedOpacity,
  },
  head: {
    paddingTop: spacing.md,
  },
  barLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
  },
  barName: {
    fontSize: 17,
    lineHeight: 22,
  },
  settingValue: {
    fontSize: 17,
    lineHeight: 22,
  },
  change: {
    fontSize: 15,
  },
  beatsOff: {
    // `accentText`, not `accent`: this is type on the ivory ground, where the
    // plain accent measures 3.26:1 and fails. See `colors.accentText`.
    color: colors.accentText,
  },
  keyLabel: {
    marginTop: spacing['2xl'],
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  keySetting: {
    minHeight: 56,
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderTopWidth: BORDER_WIDTH,
    borderBottomWidth: BORDER_WIDTH,
    borderColor: colors.border,
  },
  keyCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  keyHelp: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  keyChoices: {
    paddingBottom: spacing['3xl'],
  },
  keyChoice: {
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: BORDER_WIDTH,
    borderBottomColor: colors.border,
  },
  keyChoiceOn: {
    backgroundColor: colors.surfacePressed,
    borderBottomColor: colors.accent,
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
  footerError: {
    marginBottom: spacing.md,
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
  },
  markRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  pitchStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing['2xl'],
  },
  stepButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pitchName: {
    minWidth: 96,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pitchText: {
    fontFamily: fontFamily.serifRegular,
    fontSize: 22,
    lineHeight: 28,
    color: colors.textPrimary,
  },
  noteActions: {
    flexDirection: 'row',
    gap: spacing['2xl'],
    marginTop: spacing.lg,
  },
  noteAction: {
    minHeight: 44,
    justifyContent: 'center',
  },
  noteActionText: {
    fontSize: 15,
  },
});

/** "F#3" as it is printed: the sharp and flat signs rather than "#" and "b". */
function prettyPitch(pitch: string): string {
  return pitch.replace('#', '\u266F').replace(/^([A-G])b/, '$1\u266D');
}

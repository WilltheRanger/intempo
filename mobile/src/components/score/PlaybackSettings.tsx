import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { MAX_BPM, MIN_BPM } from '../../data/practiceTempo';
import type { TempoBeatUnit } from '../../data/types';
import { BORDER_WIDTH, MIN_TOUCH_TARGET, spacing } from '../../design';
import { ROW_PADDING_VERTICAL } from '../rowMetrics';
import {
  displayTempoBpm,
  formatTempo,
  quarterBpmFromDisplay,
  tempoDisplayRange,
  tempoUnitLabel,
} from '../../lib/tempo';
import {
  entryAccessibilityLabel,
  entryRowLabel,
  entrySheetTitle,
  type EntryScope,
} from '../../lib/score/entryCopy';
import { TrailingChevron } from '../primitives/TrailingChevron';
import type { ScoreJson } from '../../data/types';
import { colors } from '../../design';
import { BottomSheet } from '../overlays/BottomSheet';
import { StartBarPicker } from './StartBarPicker';
import { TempoStepper } from '../practice/TempoStepper';
import { Text } from '../primitives/Text';

export interface PlaybackSettingsProps {
  /** Bars that can be entered on, in playing order. `startableMeasures`. */
  bars: number[];
  /**
   * The music, for the picker to draw.
   *
   * Without it the sheet falls back to nothing at all rather than to the old
   * list of numbers: a picker that sometimes shows the music and sometimes a
   * spreadsheet is two controls wearing one name.
   */
  score?: ScoreJson | null;
  fromMeasure: number;
  onFromMeasureChange: (measure: number) => void;
  bpm: number;
  /**
   * Omitted on a screen that already has a tempo control of its own — the
   * Record screen's stepper is the tempo the take is judged against, and a
   * second way to set the same number one line below it is two controls for
   * one value.
   */
  onBpmChange?: (bpm: number) => void;
  /**
   * The note value the page's tempo is counted in.
   *
   * **The same tempo had two numbers.** `bpm` is quarter-note BPM everywhere in
   * this app — it is the clock the score and the analysis are on — and the
   * Record screen has always shown it in the unit actually printed on the page
   * (`displayTempoBpm`). This control did not, so a piece in 6/8 marked
   * dotted-quarter = 60 read **"90 BPM"** here and **"60 dotted-quarter-note
   * BPM"** one tap away, while the sheet below tells you they are the same
   * value. Stepping it moved in different-sized steps on each screen.
   *
   * Absent or null means quarter, which is both the default and what most
   * pages print.
   */
  beatUnit?: TempoBeatUnit | null;
  /**
   * What the chosen bar governs, which decides what this calls itself.
   *
   * `'take'` on the Record screen, where the request carries the bar and the
   * worker trims the score to match. `'listen'` everywhere nothing is being
   * recorded. Passed rather than inferred: a control that guesses what it
   * controls is one whose label cannot be trusted.
   */
  entry?: EntryScope;
  disabled?: boolean;
}

/**
 * Where to start listening, and how fast.
 *
 * **One quiet line, not a panel.** These are settings for the button above
 * them; a card around them would give them the weight of the music (§3 laws 3
 * and 10). They read as a sentence — "From bar 9 · 96 BPM" — and each half is
 * a tap.
 *
 * The bars come from the *schedule*, not the score, so the list can only offer
 * bars that actually sound: a bar of rests has nothing to enter on, and
 * offering it produces a Listen that appears to do nothing. `startAtMeasure`
 * explains why the entry point is a time rather than a measure number, which
 * is what makes a repeat behave the way a musician means.
 */
export function PlaybackSettings({
  bars,
  fromMeasure,
  onFromMeasureChange,
  bpm,
  onBpmChange,
  beatUnit,
  entry = 'listen',
  score = null,
  disabled = false,
}: PlaybackSettingsProps) {
  const [pickingBar, setPickingBar] = useState(false);
  const [pickingTempo, setPickingTempo] = useState(false);

  // Nothing to choose between. A control offering one option teaches a
  // musician to stop reading the controls.
  const canPickBar = bars.length > 1;
  if (!canPickBar && !onBpmChange) {
    return null;
  }

  // The sheet is the same whichever trigger opened it. Choosing a bar keeps
  // the sheet open: the stepper is there for the tap that landed one bar off,
  // and closing on every tap would make it a list of numbers with extra steps.
  const barSheet = (
    <BottomSheet
      visible={pickingBar}
      onClose={() => setPickingBar(false)}
      title={entrySheetTitle(entry)}
      // The picker is a page of music to read, so it gets the screen. Without
      // the score there is nothing to read and the sheet stays a sheet.
      expand={Boolean(score)}
    >
      {score ? (
        <StartBarPicker
          score={score}
          bars={bars}
          value={fromMeasure}
          onChange={onFromMeasureChange}
        />
      ) : null}
    </BottomSheet>
  );

  /*
    **Both of these are rows, and both used to be a line.**

    The comment this replaces read: *"A setting gets a row; a playback tweak
    gets a line. Where the bar decides what the take is — and so what the
    analysis judges — it is a real setting and looks like one... Accent-coloured
    text saying 'Start at bar 1' did not read as a control at all, and the owner
    said so."* The Record screen was given the row; the score screen kept the
    line on the strength of that distinction.

    The owner has now reported the same thing about the score screen. The
    distinction was a reasonable call when everything around it was accent
    text; the composition underneath it has changed, and the rest of that
    screen is ruled rows with chevrons — so the line is the one orphan on it,
    and the same words that did not read as a control there do not read as one
    here either.

    It also fixes a duplicate. The line rendered "Listen from bar 1 · 92 BPM"
    four lines under a metadata row already saying "92 BPM", with nothing to
    say the second one was a control and the first was a fact. Labelled rows
    say which is which.
  */
  return (
    /*
      **`stretch`, because the rows below say `stretch` and that is not
      enough.** `alignSelf` resolves against the *parent*, and this wrapper is
      the parent now — so a row that stretches to a wrapper which has itself
      shrunk to its content is a row the width of its own text, with the label
      and the value touching. Measured: "Listen fromBar 1" on a 290pt row
      inside a 390pt screen.
    */
    <View style={styles.settings}>
      {canPickBar ? (
        <Pressable
          onPress={() => setPickingBar(true)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={entryAccessibilityLabel(entry, fromMeasure)}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          {/* The words depend on what the bar governs — see `entryCopy`. */}
          <Text
            variant="rowLabel"
            color={disabled ? 'textTertiary' : 'textPrimary'}
            style={styles.label}
          >
            {entryRowLabel(entry)}
          </Text>
          <Text variant="rowLabel" color={disabled ? 'textTertiary' : 'textSecondary'}>
            Bar {fromMeasure}
          </Text>
          <TrailingChevron />
        </Pressable>
      ) : null}

      {onBpmChange ? (
        <Pressable
          onPress={() => setPickingTempo(true)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`Playback tempo ${formatTempo(bpm, beatUnit)}. Change.`}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          {/*
            "Listen at", not "Tempo". The number beside it is the *playback*
            tempo and the page's own marked tempo sits under the music a few
            lines up; two rows both called tempo, with different numbers, is
            the confusion `tempoBeatUnit` already exists to prevent.
          */}
          <Text
            variant="rowLabel"
            color={disabled ? 'textTertiary' : 'textPrimary'}
            style={styles.label}
          >
            Listen at
          </Text>
          <Text variant="rowLabel" color={disabled ? 'textTertiary' : 'textSecondary'}>
            {formatTempo(bpm, beatUnit)}
          </Text>
          <TrailingChevron />
        </Pressable>
      ) : null}

      {barSheet}

      <BottomSheet
        visible={pickingTempo}
        onClose={() => setPickingTempo(false)}
        title="Playback tempo"
      >
        <View style={styles.tempoSheet}>
          {/*
            Stepped in the page's own unit, and stored in quarters. The bounds
            are converted too: `MIN_BPM`/`MAX_BPM` are quarter-note limits, so
            offering them unconverted would let a dotted-quarter tempo be
            stepped to 300, which is 450 on the clock everything else uses.
          */}
          <TempoStepper
            label="Listen at"
            bpm={displayTempoBpm(bpm, beatUnit)}
            minBpm={tempoDisplayRange(beatUnit, MIN_BPM, MAX_BPM).min}
            maxBpm={tempoDisplayRange(beatUnit, MIN_BPM, MAX_BPM).max}
            unitLabel={tempoUnitLabel(beatUnit)}
            onChange={(next) => onBpmChange?.(quarterBpmFromDisplay(next, beatUnit))}
          />
          {/* The tempo is remembered for this piece, so it is also the one the
              Record screen opens at. Said here because a listener who slows a
              passage down would be surprised to find the take slowed too. */}
          <Text variant="metadataSmall" color="textTertiary" style={styles.tempoNote}>
            This is the working tempo for the piece — the Record screen opens
            at it too.
          </Text>
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * The app's list row (`rowMetrics`, `typography.rowLabel`, `TrailingChevron`),
   * the same as the score's own action rows under it.
   *
   * **These were their own row until 2026-09-23**: 44pt with a 16pt chevron,
   * in a group closed by a bottom rule and set off by a margin — so on the
   * score screen "Listen from" and "Listen at" sat in a shorter list of their
   * own above "See every bar" and "Change the clef", with a gap between the
   * two. The owner: "Why not evenly spaced". One list now, one rhythm.
   */
  settings: {
    alignSelf: 'stretch',
    marginTop: spacing.lg,
  },
  row: {
    // **Full width, whatever the parent centres.** A `space-between` row that
    // is only as wide as its content puts the name and the value touching.
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: ROW_PADDING_VERTICAL,
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  label: {
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },
  tempoSheet: {
    paddingBottom: spacing.lg,
  },
  tempoNote: {
    marginTop: spacing.lg,
    textAlign: 'center',
  },
});

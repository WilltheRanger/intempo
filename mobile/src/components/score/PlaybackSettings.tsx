import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { MAX_BPM, MIN_BPM } from '../../data/practiceTempo';
import type { TempoBeatUnit } from '../../data/types';
import { MIN_TOUCH_TARGET, spacing } from '../../design';
import {
  displayTempoBpm,
  formatTempo,
  quarterBpmFromDisplay,
  tempoDisplayRange,
  tempoUnitLabel,
} from '../../lib/tempo';
import { BottomSheet } from '../overlays/BottomSheet';
import { TempoStepper } from '../practice/TempoStepper';
import { Text } from '../primitives/Text';

export interface PlaybackSettingsProps {
  /** Bars that can be entered on, in playing order. `startableMeasures`. */
  bars: number[];
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

  return (
    <View style={styles.row}>
      {canPickBar ? (
        <Pressable
          onPress={() => setPickingBar(true)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`Listen from bar ${fromMeasure}. Change.`}
          style={({ pressed }) => [styles.target, pressed && styles.pressed]}
        >
          {/* **"Listen from", not "From".** On the Record screen this line sits
              between the Listen button and "Recording tips", and a bare "From
              bar 1" there reads as where the *take* starts — which it is not,
              and which would be a promise about the analysis that nothing
              keeps. */}
          <Text variant="metadataSmall" color={disabled ? 'textTertiary' : 'accent'}>
            Listen from bar {fromMeasure}
          </Text>
        </Pressable>
      ) : null}

      {canPickBar && onBpmChange ? (
        <Text variant="metadataSmall" color="textTertiary">
          ·
        </Text>
      ) : null}

      {onBpmChange ? (
        <Pressable
          onPress={() => setPickingTempo(true)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`Playback tempo ${formatTempo(bpm, beatUnit)}. Change.`}
          style={({ pressed }) => [styles.target, pressed && styles.pressed]}
        >
          <Text variant="metadataSmall" color={disabled ? 'textTertiary' : 'accent'}>
            {formatTempo(bpm, beatUnit)}
          </Text>
        </Pressable>
      ) : null}

      <BottomSheet
        visible={pickingBar}
        onClose={() => setPickingBar(false)}
        title="Start from"
      >
        <ScrollView style={styles.barList}>
          {bars.map((bar) => (
            <Pressable
              key={bar}
              onPress={() => {
                setPickingBar(false);
                onFromMeasureChange(bar);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: bar === fromMeasure }}
              style={styles.barRow}
            >
              <Text variant="body">Bar {bar}</Text>
              {bar === fromMeasure ? (
                <Text variant="metadataSmall" color="accent">
                  Current
                </Text>
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      </BottomSheet>

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
   * Padded to a real touch target.
   *
   * These are one line of `metadataSmall`, which measured **18pt tall** — a
   * control at less than half the platform minimum, on the two settings this
   * panel exists for. Padding rather than `hitSlop` because padding is in the
   * layout and can be measured; a hit area nothing can see is a hit area
   * nothing checks.
   */
  target: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    // Close to the button it belongs to. On the Record screen the next control
    // is "Recording tips", and even spacing would make three unrelated things
    // read as one list.
    marginTop: spacing.sm,
  },
  pressed: {
    opacity: 0.6,
  },
  barList: {
    maxHeight: 320,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  tempoSheet: {
    paddingBottom: spacing.lg,
  },
  tempoNote: {
    marginTop: spacing.lg,
    textAlign: 'center',
  },
});

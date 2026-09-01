import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { MAX_BPM, MIN_BPM } from '../../data/practiceTempo';
import { spacing } from '../../design';
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
          style={({ pressed }) => (pressed ? styles.pressed : undefined)}
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
          accessibilityLabel={`Playback tempo ${bpm} BPM. Change.`}
          style={({ pressed }) => (pressed ? styles.pressed : undefined)}
        >
          <Text variant="metadataSmall" color={disabled ? 'textTertiary' : 'accent'}>
            {bpm} BPM
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
          <TempoStepper
            label="Listen at"
            bpm={bpm}
            minBpm={MIN_BPM}
            maxBpm={MAX_BPM}
            onChange={(next) => onBpmChange?.(next)}
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

import { StyleSheet, View } from 'react-native';

import { Stave } from '../../components/notation/Stave';
import { PrimaryButton } from '../../components/primitives/PrimaryButton';
import { Text } from '../../components/primitives/Text';
import { practiceTempo, usePracticeTempos } from '../../data/practiceTempo';
import type { Instrument } from '../../data/types';
import { spacing } from '../../design';
import { INSTRUMENT_LABELS, warmupFor } from '../../lib/warmup';

export interface WarmupPanelProps {
  instrument: Instrument;
  onStart: () => void;
}

/**
 * Bars visible on Today. Enough to recognise the shape, not enough to work
 * from — the point of the block is to get you to open the page.
 */
const PREVIEW_NOTES = 9;

/**
 * The daily warmup, on Today.
 *
 * **On the page background, with no panel behind it.** It was a full-bleed ink
 * band, and the band was doing too much: it read as a second focal point
 * competing with the practice card rather than as the last thing on the
 * screen. The notation is also now ink-on-light in both places, so tapping
 * Start no longer inverts the music on the way through — the page lifts it
 * onto its plate, which is a change of paper rather than a change of ink.
 *
 * The notation is the block's only ornament, and it is real: the actual first
 * bars of the actual warmup. Nothing decorative is added to make it
 * interesting.
 */
export function WarmupPanel({ instrument, onStart }: WarmupPanelProps) {
  const warmup = warmupFor(instrument);
  // The tempo you will actually play at, not the one it was written at — the
  // warmup page can slow it down and remembers, exactly as a piece does, so
  // the block has to report the same number the page would.
  usePracticeTempos();
  const bpm = practiceTempo.for(warmup.id, warmup.bpm);

  return (
    <View>
      <Text variant="pieceTitle">{warmup.name}</Text>
      <Text variant="metadataSmall" color="textSecondary" style={styles.focus}>
        {warmup.focus}
      </Text>

      {/*
        Clipped rather than scrollable: this is a preview, and a block that
        scrolls sideways competes with the page it is advertising.
      */}
      <View style={styles.stave} pointerEvents="none">
        <Stave
          notes={warmup.notes}
          clef={warmup.clef}
          // A clef here too — see the warmup page for why. This preview is the
          // more-seen of the two staves in the app.
          head={{ clef: warmup.clef, key: [], time: null }}
          maxNotes={PREVIEW_NOTES}
        />
      </View>

      <View style={styles.footer}>
        <Text variant="metadataSmall" color="textTertiary" style={styles.meta}>
          {INSTRUMENT_LABELS[instrument]}  ·  {bpm} BPM
        </Text>
        <PrimaryButton label="Start" onPress={onStart} size="compact" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  focus: {
    marginTop: 2,
  },
  stave: {
    marginTop: spacing.lg,
    overflow: 'hidden',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  meta: {
    flexShrink: 1,
  },
});

import { StyleSheet, View } from 'react-native';

import { Stave } from '../../components/notation/Stave';
import { PrimaryButton } from '../../components/primitives/PrimaryButton';
import { SCREEN_GUTTER } from '../../components/primitives/ScreenContainer';
import { Text } from '../../components/primitives/Text';
import { practiceTempo, usePracticeTempos } from '../../data/practiceTempo';
import type { Instrument } from '../../data/types';
import { colors, spacing } from '../../design';
import { INSTRUMENT_LABELS, warmupFor } from '../../lib/warmup';

export interface WarmupPanelProps {
  instrument: Instrument;
  onStart: () => void;
}

/**
 * Bars visible on Today. Enough to recognise the shape, not enough to work
 * from — the point of the panel is to get you to open the page.
 */
const PREVIEW_NOTES = 9;

/**
 * The daily warmup, on Today.
 *
 * **A full-bleed ink band**, and the only dark surface on the screen. Today
 * otherwise runs card, then type, then more type; one inverted panel gives it
 * a second visual event and marks the warmup as a different kind of thing from
 * the piece above it — that is a warm-up, this is your repertoire.
 *
 * No new colours. `actionBg` / `actionText` / `onDarkMuted` already exist as
 * the palette for full-bleed dark surfaces — the camera scanner uses the same
 * three — so this is the established dark treatment applied somewhere new
 * rather than a style invented for it.
 *
 * The notation is the panel's only ornament, and it is real: the actual first
 * bars of the actual warmup, engraved, in cream. Nothing decorative is added
 * to make it interesting.
 */
export function WarmupPanel({ instrument, onStart }: WarmupPanelProps) {
  const warmup = warmupFor(instrument);
  // The tempo you will actually play at, not the one it was written at — the
  // warmup page can slow it down and remembers, exactly as a piece does, so
  // the panel has to report the same number the page would.
  usePracticeTempos();
  const bpm = practiceTempo.for(warmup.id, warmup.bpm);

  return (
    <View style={styles.panel}>
      <Text variant="sectionLabel" color="onDarkMuted">
        Warmup
      </Text>
      <Text variant="heroTitle" color="actionText" style={styles.name}>
        {warmup.name}
      </Text>
      <Text variant="metadataSmall" color="onDarkMuted" style={styles.focus}>
        {warmup.focus}
      </Text>

      {/*
        Clipped rather than scrollable: this is a preview, and a panel that
        scrolls sideways competes with the page it is advertising.
      */}
      <View style={styles.stave} pointerEvents="none">
        <Stave
          notes={warmup.notes}
          clef={warmup.clef}
          tone="dark"
          maxNotes={PREVIEW_NOTES}
        />
      </View>

      <View style={styles.footer}>
        <Text variant="metadataSmall" color="onDarkMuted" style={styles.meta}>
          {INSTRUMENT_LABELS[instrument]}  ·  {bpm} BPM
        </Text>
        <PrimaryButton
          label="Start"
          onPress={onStart}
          tone="light"
          size="compact"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.actionBg,
    // Edge to edge: inset by the gutter it would read as a very dark card,
    // which is the one thing the palette notes say this colour must not be.
    marginHorizontal: -SCREEN_GUTTER,
    paddingHorizontal: SCREEN_GUTTER,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  name: {
    marginTop: spacing.sm,
  },
  focus: {
    marginTop: spacing.xs,
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

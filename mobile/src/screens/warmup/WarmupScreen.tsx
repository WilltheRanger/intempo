import { useNavigation } from '@react-navigation/native';
import { ChevronLeft } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { Stave } from '../../components/notation/Stave';
import { TempoStepper } from '../../components/practice/TempoStepper';
import {
  IconButton,
  ScreenContainer,
  Text,
} from '../../components/primitives';
import { SCREEN_GUTTER } from '../../components/primitives/ScreenContainer';
import {
  clampBpm,
  practiceTempo,
  usePracticeTempos,
} from '../../data/practiceTempo';
import { usePreferences } from '../../data/preferences';
import { BORDER_WIDTH, colors, spacing } from '../../design';
import { INSTRUMENT_LABELS, warmupFor, warmupScore } from '../../lib/warmup';
import type { RootNavigation } from '../../navigation/types';
import { ListenButton } from '../record/ListenButton';

/**
 * The warmup, in full.
 *
 * A page rather than a block on Today because working from notation needs it
 * at a size you can read from a stand, and because the tempo is something you
 * set once and then play against.
 *
 * **The music wraps rather than scrolling sideways.** An exercise you have to
 * swipe through is one you cannot read while holding a bow — the whole warmup
 * is on the plate at once, and the controls sit below it.
 *
 * **Nothing here is recorded.** A take is analysed against a score row in the
 * backend and a warmup this app authored has no such row, so the page offers
 * the reference and the tempo and stops there. The honest shape of the
 * feature, not a placeholder for a Record button.
 */
export function WarmupScreen() {
  const navigation = useNavigation<RootNavigation>();
  const { instrument } = usePreferences();

  // The remembered tempo is keyed by piece id everywhere else; a warmup's id
  // slots into the same store, so slowing one down is remembered exactly the
  // way slowing a piece down is.
  usePracticeTempos();

  const warmup = warmupFor(instrument);
  const bpm = practiceTempo.for(warmup.id, warmup.bpm);
  const score = warmupScore(warmup);

  // The engraver needs a width to wrap at, and the only honest source of that
  // is the plate once it has been laid out. Null until then, so nothing is
  // drawn against a guess and then reflowed.
  const [plateWidth, setPlateWidth] = useState<number | null>(null);
  function measure(event: LayoutChangeEvent) {
    const next = Math.round(event.nativeEvent.layout.width);
    setPlateWidth((current) => (current === next ? current : next));
  }

  return (
    <ScreenContainer
      // The plate takes whatever height is left, so a short warmup fills the
      // screen with paper instead of leaving a band of ivory above the
      // controls. A long one scrolls, which is what `flexGrow` buys over a
      // fixed height.
      contentStyle={styles.content}
      footerTone="surface"
      footer={
        <View style={styles.controls}>
          <TempoStepper
            label="Play at"
            bpm={bpm}
            onChange={(next) => practiceTempo.set(warmup.id, clampBpm(next))}
          />
          <ListenButton score={score} bpm={bpm} />
        </View>
      }
    >
      {/*
        A nav row, not a page header: back and the section it belongs to, on
        one line at the top of the screen. The exercise's own name is content
        below it rather than the screen's title — the screen is "Warmup", and
        which warmup it is changes daily.
      */}
      <View style={styles.nav}>
        <IconButton
          icon={ChevronLeft}
          label="Back to today"
          onPress={() => navigation.goBack()}
          style={styles.back}
        />
        <Text variant="button">Warmup</Text>
      </View>

      <Text variant="heroTitle" style={styles.name}>
        {warmup.name}
      </Text>
      <Text variant="metadataSmall" color="textSecondary" style={styles.focus}>
        {warmup.focus}
      </Text>

      {/*
        The plate. Full-bleed and ruled top and bottom, the way an exercise is
        set on a page in a study book — the music owns the width rather than
        sitting inside the body column.
      */}
      <View style={styles.plate} onLayout={measure}>
        <View style={styles.plateHeader}>
          <Text variant="sectionLabel" color="textTertiary">
            {INSTRUMENT_LABELS[instrument]}
          </Text>
          <Text variant="sectionLabel" color="textTertiary">
            First position
          </Text>
        </View>

        {plateWidth === null ? null : (
          <Stave
            notes={warmup.notes}
            clef={warmup.clef}
            maxWidth={plateWidth - SCREEN_GUTTER * 2}
            scale={STAVE_SCALE}
            justify
          />
        )}

        <Text variant="metadataSmall" color="textTertiary" style={styles.note}>
          Change your instrument in your profile and tomorrow’s warmup follows
          it.
        </Text>
      </View>
    </ScreenContainer>
  );
}

/**
 * Bigger than the Today preview, because this one is read from a music stand
 * rather than glanced at on the way past.
 */
const STAVE_SCALE = 1.25;

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    // The plate runs down to the control bar. `ScreenContainer`'s usual bottom
    // padding would leave a band of ivory between the paper and the controls,
    // which is exactly the gap this layout exists to close.
    paddingBottom: 0,
  },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    // Pulled out to the gutter so the glyph lines up with the text below it
    // rather than sitting indented by its own padding.
    marginLeft: -spacing.md,
    paddingTop: spacing.sm,
  },
  back: {
    marginRight: -spacing.xs,
  },
  name: {
    marginTop: spacing.lg,
  },
  focus: {
    marginTop: spacing.xs,
  },
  plate: {
    flex: 1,
    marginTop: spacing.xl,
    marginHorizontal: -SCREEN_GUTTER,
    paddingHorizontal: SCREEN_GUTTER,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: BORDER_WIDTH,
    borderBottomWidth: BORDER_WIDTH,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  plateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  note: {
    // Pushed to the foot of the plate: it is a footnote about the page, and on
    // a short warmup there is paper between it and the music.
    marginTop: 'auto',
    paddingTop: spacing.xl,
  },
  controls: {
    gap: spacing.lg,
  },
});

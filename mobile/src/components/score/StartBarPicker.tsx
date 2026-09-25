import { Minus, Plus } from '../icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import type { Clef, ScoreJson } from '../../data/types';
import { ICON_SIZE, ICON_STROKE_WIDTH, MIN_TOUCH_TARGET, colors, spacing } from '../../design';
import { barsOnPages, pageReadout, systemOfMeasure } from '../../lib/notation/barPages';
import { staveScoreFor } from '../../lib/notation/fromScore';
import { keySignatureFor, timeSignatureDigits } from '../../lib/notation/keySignature';
import { pageAtOffset, pageOffsets, pageOfSystem, paginateSystems } from '../../lib/notation/pages';
import { layOutStave } from '../../lib/notation/staveLayout';
import { canStepBar, stepBar } from '../../lib/score/stepBar';
import { Stave } from '../notation/Stave';
import { Text } from '../primitives/Text';

export interface StartBarPickerProps {
  score: ScoreJson;
  /** Bars that actually sound, in playing order — `startableMeasures`. */
  bars: number[];
  value: number;
  onChange: (measureNumber: number) => void;
}

/**
 * Where the noteheads go while nothing has read a clef. The one named
 * assumption, the same one `PieceScoreScreen` makes and for the same reason:
 * the stave must place notes somewhere, and this is the placement — not a
 * claim about what the page says.
 */
const UNREAD_CLEF_PLACEMENT: Clef = 'treble';

/** Same size as the score screen's stave, so a bar looks like the same bar. */
const STAVE_SCALE = 1.25;

/** Breathing room above the first system on every page, out of the page's own height. */
const PAGE_GUTTER = spacing.sm;

/** The music bleeds to the sheet's edge and keeps this much margin of its own. */
const MUSIC_PAD = spacing.md;

/**
 * Pick the bar a take starts on, by looking at the music.
 *
 * **This replaced a list of bar numbers.** "Bar 1, Bar 2 … Bar 74" in a
 * scrolling sheet asked a musician to find a place in a piece the way a
 * spreadsheet would, and the owner said so. A musician knows where they want
 * to start because they can see it: the run after the double bar, the entry
 * after the long rest. So the picker is the stave — every bar that sounds is
 * a tap target, and the chosen one carries the same wash the playhead does,
 * because "you are here" is what both of them mean.
 *
 * **And then it was still a scroll.** A third of a phone showed three systems
 * of a seventy-four bar part, so finding bar 40 meant dragging, and wherever
 * the drag stopped the top and bottom lines of music were cut through. The
 * sheet is full height now and the music is laid out in *pages*: systems are
 * packed into groups that fit the screen, a swipe moves one page, and a page
 * break never falls through a stave. The line under the music says which bars
 * are on it, because the question being asked is whether the bar you want is
 * ahead of you or behind you.
 *
 * The stepper underneath is for precision, not discovery. A bar of sixteenths
 * on a phone is narrow, and a thumb that lands on the neighbour should be one
 * tap from the right one rather than another aim. It walks the list of bars
 * that sound rather than adding one, so it can never land on a bar of rest —
 * and when it walks onto another page, the page follows it.
 */
export function StartBarPicker({ score, bars, value, onChange }: StartBarPickerProps) {
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const [showing, setShowing] = useState(0);
  const scroll = useRef<ScrollView>(null);
  /** Whether the scroll has been placed once, so the first placement can be silent. */
  const placed = useRef(false);

  const stave = useMemo(() => staveScoreFor(score), [score]);
  const clef = score.clef ?? UNREAD_CLEF_PLACEMENT;

  const width = box ? box.width - MUSIC_PAD * 2 : 0;
  const height = box ? box.height : 0;

  const head = useMemo(
    () => ({
      clef: score.clef ?? null,
      key: keySignatureFor(score.key_signature, clef),
      time: timeSignatureDigits(score.time_signature),
    }),
    [clef, score.clef, score.key_signature, score.time_signature],
  );

  /**
   * Engraved once, here, and handed to every page.
   *
   * `Stave` would otherwise engrave the whole piece once per page — ~12ms for
   * a 74-bar part on a laptop, so most of a second on a phone to open a
   * picker — and the pagination needs the same geometry anyway. One engraving
   * is also what keeps the page breaks and the drawing in agreement.
   */
  const engraved = useMemo(
    () =>
      stave && width > 0
        ? layOutStave({
            notes: stave.items,
            clef,
            maxWidth: width,
            fitWidth: width,
            scale: STAVE_SCALE,
            justify: true,
            beatQuarters: stave.beatQuarters,
            closesWithRepeat: stave.closesWithRepeat,
            endings: stave.endings,
            tempoMarks: stave.tempoMarks,
            head,
            nameRow: false,
          })
        : null,
    [clef, head, stave, width],
  );

  // Memoised so that the pagination below it does not re-run on every render
  // just because `[]` is a new array each time nothing has been engraved yet.
  const systems = useMemo(() => engraved?.layout.systems ?? [], [engraved]);
  const pages = useMemo(
    () => paginateSystems(systems, height, PAGE_GUTTER),
    // The extents are what pagination reads, and they only change with the
    // engraving — which is what `systems` is.
    [systems, height],
  );
  const offsets = useMemo(() => pageOffsets(pages, height), [pages, height]);
  const ranges = useMemo(() => barsOnPages(systems, pages), [systems, pages]);

  /**
   * Follow the chosen bar onto its page.
   *
   * Both ways in need this: opening the picker on a piece already set to bar
   * 40 should show bar 40, and stepping off the bottom of a page should turn
   * it. It does not fight a musician browsing — reading a page without
   * choosing anything leaves `value` alone, so nothing here runs.
   */
  useEffect(() => {
    const target = pageOfSystem(pages, systemOfMeasure(systems, value));
    if (target < 0) {
      return;
    }
    setShowing(target);
    scroll.current?.scrollTo({ y: offsets[target], animated: placed.current });
    placed.current = true;
  }, [offsets, pages, systems, value]);

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    setShowing(pageAtOffset(offsets, event.nativeEvent.contentOffset.y));
  }

  function handleLayout(event: LayoutChangeEvent) {
    const { width: measured, height: available } = event.nativeEvent.layout;
    setBox((current) =>
      current && current.width === measured && current.height === available
        ? current
        : { width: measured, height: available },
    );
  }

  /**
   * The pages, held still while the readout changes.
   *
   * Scrolling sets `showing` on every frame, and re-running this would redraw
   * every page of the music to move one line of text. Same elements, so React
   * leaves the drawing alone.
   */
  const drawn = useMemo(
    () =>
      engraved
        ? pages.map((page, index) => (
            <View
              key={`page-${index}`}
              style={{ height: Math.max(height, page.height) }}
            >
              <Stave
                notes={stave?.items ?? []}
                clef={clef}
                maxWidth={width}
                fitWidth={width}
                scale={STAVE_SCALE}
                justify
                beatQuarters={stave?.beatQuarters}
                closesWithRepeat={stave?.closesWithRepeat}
                endings={stave?.endings}
                tempoMarks={stave?.tempoMarks}
                head={head}
                showNoteNames={false}
                highlightMeasure={value}
                onMeasurePress={onChange}
                pressableMeasures={bars}
                layout={engraved}
                page={page}
              />
            </View>
          ))
        : null,
    [bars, clef, engraved, head, height, onChange, pages, stave, value, width],
  );

  const back = canStepBar(bars, value, -1);
  const forward = canStepBar(bars, value, 1);
  const readout = pageReadout(ranges[showing] ?? null, showing, pages.length);

  return (
    <View style={styles.root}>
      <View style={styles.music} onLayout={handleLayout}>
        <ScrollView
          ref={scroll}
          onScroll={handleScroll}
          scrollEventThrottle={64}
          showsVerticalScrollIndicator={false}
          // A page at a time, and the two platforms snap by different means.
          // Native takes the offsets, which are exact for pages of unequal
          // height; react-native-web turns `pagingEnabled` into CSS scroll
          // snapping on each child, which is what the page views are.
          {...(Platform.OS === 'web'
            ? { pagingEnabled: true }
            : {
                snapToOffsets: offsets,
                snapToAlignment: 'start' as const,
                decelerationRate: 'fast' as const,
                disableIntervalMomentum: true,
              })}
          // The sheet does not scroll behind this; the music is the page.
          nestedScrollEnabled
        >
          {drawn}
        </ScrollView>
      </View>

      {readout ? (
        <Text variant="metadataSmall" color="textTertiary" style={styles.readout}>
          {readout}
        </Text>
      ) : null}

      <View style={styles.stepper}>
        <Pressable
          onPress={() => onChange(stepBar(bars, value, -1))}
          disabled={!back}
          accessibilityRole="button"
          accessibilityLabel="Previous bar"
          accessibilityState={{ disabled: !back }}
          style={({ pressed }) => [styles.step, pressed && styles.pressed]}
        >
          <Minus
            size={ICON_SIZE.sm}
            strokeWidth={ICON_STROKE_WIDTH}
            color={back ? colors.textPrimary : colors.textTertiary}
          />
        </Pressable>

        <View style={styles.stepperReadout} accessibilityLiveRegion="polite">
          <Text variant="metadataSmall" color="textTertiary">
            Start at
          </Text>
          <Text variant="pieceTitle">Bar {value}</Text>
        </View>

        <Pressable
          onPress={() => onChange(stepBar(bars, value, 1))}
          disabled={!forward}
          accessibilityRole="button"
          accessibilityLabel="Next bar"
          accessibilityState={{ disabled: !forward }}
          style={({ pressed }) => [styles.step, pressed && styles.pressed]}
        >
          <Plus
            size={ICON_SIZE.sm}
            strokeWidth={ICON_STROKE_WIDTH}
            color={forward ? colors.textPrimary : colors.textTertiary}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    // Takes whatever the expanded sheet gives it: the music is the screen, and
    // the stepper sits at the bottom of it where a thumb is (§3 law 7).
    flex: 1,
  },
  music: {
    flex: 1,
    // Out to the sheet's own edge — every point of width is another bar on the
    // system, which is fewer pages to turn.
    marginHorizontal: -spacing.xl,
    paddingHorizontal: MUSIC_PAD,
  },
  readout: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  step: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperReadout: {
    alignItems: 'center',
    gap: 2,
  },
  pressed: {
    opacity: 0.6,
  },
});

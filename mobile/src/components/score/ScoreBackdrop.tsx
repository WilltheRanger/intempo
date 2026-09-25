import { useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import type { Clef, ScoreJson } from '../../data/types';
import { colors, spacing } from '../../design';
import { barsOnPages, pageReadout } from '../../lib/notation/barPages';
import { staveScoreFor } from '../../lib/notation/fromScore';
import { keySignatureFor, timeSignatureDigits } from '../../lib/notation/keySignature';
import { pageAtOffset, pageOffsets, paginateSystems } from '../../lib/notation/pages';
import { layOutStave } from '../../lib/notation/staveLayout';
import { Stave } from '../notation/Stave';
import { Text } from '../primitives/Text';

/** The same size as the score screen and the bar picker, so a bar looks the same everywhere. */
const STAVE_SCALE = 1.25;
const PAGE_GUTTER = spacing.sm;
const MUSIC_PAD = spacing.md;

/** The line above the music that says which bars are on this page. */
const READOUT = 22;

/** See `StartBarPicker`: the stave has to place notes before anything has read a clef. */
const UNREAD_CLEF_PLACEMENT: Clef = 'treble';

export interface ScoreBackdropProps {
  score: ScoreJson;
  /** Bars that actually sound, in playing order — `startableMeasures`. */
  bars: number[];
  /** The bar a take will start from, washed the way a playhead is. */
  startFrom: number;
  /**
   * Where a running take has got to, or null when none is.
   *
   * Passed straight through to `Stave`, which draws it. Separate from
   * `startFrom` because they answer different questions and are true at
   * different times: the wash says where this take *began*, and stays there
   * all take; the mark says where the beat is *now*.
   */
  playhead?: { measureNumber: number; through: number } | null;
  onStartFromChange: (measureNumber: number) => void;
  /** Room at the foot for whatever floats over the music. */
  insetBottom: number;
  /**
   * Room at the head for the screen's own header.
   *
   * The music is laid out *below* this rather than padded down to it, so a
   * page can never scroll up behind the title. The first attempt padded, and
   * the title and the staves were drawn through each other — both unreadable,
   * which is worse than either one missing.
   */
  insetTop?: number;
  /** Bars stop being choosable once a take is running. */
  disabled?: boolean;
}

/**
 * The music, as the ground of the record screen.
 *
 * The Sheet Up frame's argument: on the one screen where the content and the
 * chrome genuinely compete, give the content the screen and let the chrome move
 * out of the way. So the page a musician is about to play fills the display,
 * and the controls sit on a sheet they can drag down.
 *
 * Every bar that sounds is a tap target, which is the Start Here frame folded
 * into the same surface rather than kept behind a separate picker: a musician
 * knows where they want to start because they can *see* it, and pointing at the
 * music is the gesture they would use on paper.
 *
 * The geometry is `StartBarPicker`'s, deliberately — the same scale, the same
 * pagination, the same wash on the chosen bar — so that the bar you tapped here
 * and the bar you stepped to there are visibly the same bar.
 */
export function ScoreBackdrop({
  score,
  bars,
  startFrom,
  playhead = null,
  onStartFromChange,
  insetBottom,
  insetTop = 0,
  disabled = false,
}: ScoreBackdropProps) {
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const [showing, setShowing] = useState(0);

  const stave = useMemo(() => staveScoreFor(score), [score]);
  const clef = score.clef ?? UNREAD_CLEF_PLACEMENT;

  const width = box ? box.width - MUSIC_PAD * 2 : 0;
  // The page is what is *visible*: the header above and the sheet's peek below
  // both come off it. Without the bottom the last system of every page sits
  // under the controls; without the top the first one is cut by the title.
  const height = box ? Math.max(0, box.height - insetBottom - insetTop - READOUT) : 0;

  const head = useMemo(
    () => ({
      clef: score.clef ?? null,
      key: keySignatureFor(score.key_signature, clef),
      time: timeSignatureDigits(score.time_signature),
    }),
    [clef, score.clef, score.key_signature, score.time_signature],
  );

  /** Engraved once and handed to every page — see `StartBarPicker` for why. */
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

  const systems = useMemo(() => engraved?.layout.systems ?? [], [engraved]);
  const pages = useMemo(
    () => paginateSystems(systems, height, PAGE_GUTTER),
    [systems, height],
  );
  const offsets = useMemo(() => pageOffsets(pages, height), [pages, height]);
  const ranges = useMemo(() => barsOnPages(systems, pages), [systems, pages]);

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

  /** Held still while the readout changes, so scrolling does not redraw the music. */
  const drawn = useMemo(
    () =>
      engraved
        ? pages.map((page, index) => (
            <View key={`page-${index}`} style={{ height: Math.max(height, page.height) }}>
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
                highlightMeasure={startFrom}
                playhead={playhead}
                onMeasurePress={disabled ? undefined : onStartFromChange}
                pressableMeasures={disabled ? undefined : bars}
                layout={engraved}
                page={page}
              />
            </View>
          ))
        : null,
    [
      bars, clef, disabled, engraved, head, height, onStartFromChange, pages,
      playhead, startFrom, stave, width,
    ],
  );

  /**
   * What this line says, and why it is never empty while a bar can be chosen.
   *
   * `pageReadout` returns null for a piece that fits on one page, which is
   * right for a page indicator — there is no page to name. But this line is
   * also the only place the screen says that the music is tappable, and a
   * two-system piece is exactly where a musician has no other way to find
   * out. So the hint stands on its own when there is no page to report.
   */
  const place = pageReadout(ranges[showing] ?? null, showing, pages.length);
  const hint = disabled ? null : 'tap a bar to start there';
  const readout = [place, hint].filter(Boolean).join(' · ');

  return (
    <View style={styles.root} onLayout={handleLayout}>
      {/*
        Which bars these are, and what a tap does — above the music, under the
        header, on the page's own ground. Below the music is where the sheet
        lives, and a caption the controls cover is a caption nobody reads.
      */}
      <View style={[styles.readout, { marginTop: insetTop }]} pointerEvents="none">
        <Text variant="metadataSmall" color="textTertiary" numberOfLines={1}>
          {readout || ' '}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.music, { paddingBottom: insetBottom }]}
        showsVerticalScrollIndicator={false}
        // Paged, so a break never lands halfway through a stave — the same
        // decision the bar picker made, for the same reason.
        snapToOffsets={offsets}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={handleScroll}
      >
        {drawn}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  music: {
    paddingHorizontal: MUSIC_PAD,
  },
  readout: {
    height: READOUT,
    justifyContent: 'center',
    paddingHorizontal: MUSIC_PAD + spacing.xs,
  },
});

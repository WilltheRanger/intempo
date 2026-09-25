import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import type { Clef, ScoreJson } from '../../data/types';
import { BORDER_WIDTH, colors, spacing } from '../../design';
import { staveScoreFor } from '../../lib/notation/fromScore';
import { keySignatureFor, timeSignatureDigits } from '../../lib/notation/keySignature';
import { layOutStave } from '../../lib/notation/staveLayout';
import { Stave } from '../notation/Stave';

/**
 * The whole part as one column of music, the way the redesign's Record screen
 * shows it (`redesign/RecordReady.dc.html`): a white band between two
 * hairlines, scrolling freely, with the start bar washed in gold and a fade at
 * the foot so the music runs under the panel rather than stopping at a line.
 *
 * **Scroll, not pages.** `ScoreBackdrop` paged the music behind a drag sheet
 * and needed a readout to say which bars were showing. With the setup in a
 * fixed panel below, nothing covers the music any more, so the band just
 * scrolls and the bars say who they are.
 */

/** Smaller than the backdrop's 1.25: the band is a third shorter. */
const STAVE_SCALE = 1;
const PAD_X = spacing['2xl'];
const PAD_TOP = 18;
/** Room under the last system for the fade to run into. */
const PAD_BOTTOM = 64;
const FADE_HEIGHT = 72;

const UNREAD_CLEF_PLACEMENT: Clef = 'treble';

export interface ScoreScrollProps {
  score: ScoreJson;
  /** Bars that sound, in playing order — the only ones a tap may choose. */
  bars: number[];
  /** The bar a take starts from: washed, and announced as checked. */
  startFrom: number;
  onStartFromChange: (measureNumber: number) => void;
  /** Where a running take has got to, drawn by `Stave`. */
  playhead?: { measureNumber: number; through: number } | null;
  /**
   * Bump to bring `startFrom` into view. A counter rather than a boolean so
   * that choosing the same bar twice from the sheet still scrolls to it.
   *
   * Not bumped for a tap on the music: the bar tapped is already on screen,
   * and moving the page under a finger that just chose something loses it.
   */
  revealSignal?: number;
  /** Bars stop being choosable once a take is running. */
  disabled?: boolean;
}

export function ScoreScroll({
  score,
  bars,
  startFrom,
  onStartFromChange,
  playhead = null,
  revealSignal = 0,
  disabled = false,
}: ScoreScrollProps) {
  const [width, setWidth] = useState(0);
  const scroller = useRef<ScrollView>(null);

  const stave = useMemo(() => staveScoreFor(score), [score]);
  const clef = score.clef ?? UNREAD_CLEF_PLACEMENT;
  const musicWidth = Math.max(0, width - PAD_X * 2);

  const head = useMemo(
    () => ({
      clef: score.clef ?? null,
      key: keySignatureFor(score.key_signature, clef),
      time: timeSignatureDigits(score.time_signature),
    }),
    [clef, score.clef, score.key_signature, score.time_signature],
  );

  const engraved = useMemo(
    () =>
      stave && musicWidth > 0
        ? layOutStave({
            notes: stave.items,
            clef,
            maxWidth: musicWidth,
            fitWidth: musicWidth,
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
    [clef, head, musicWidth, stave],
  );

  // Scroll the start bar's system to just under the top edge, the way the
  // prototype's `goTo` does, when the sheet asks for it.
  useEffect(() => {
    if (revealSignal === 0 || !engraved) {
      return;
    }
    const system = engraved.layout.systems.find((candidate) =>
      candidate.measureSpans.some((span) => span.measureNumber === startFrom),
    );
    if (!system) {
      return;
    }
    const top = (system.staffLines[0] ?? 0) - engraved.lineGap * 3;
    scroller.current?.scrollTo({ y: Math.max(0, top), animated: true });
    // Only the signal decides when to scroll; `startFrom` changing on its own
    // is a tap on bar that is already on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealSignal]);

  function handleLayout(event: LayoutChangeEvent) {
    const measured = event.nativeEvent.layout.width;
    setWidth((current) => (current === measured ? current : measured));
  }

  return (
    <View style={styles.band} onLayout={handleLayout}>
      <ScrollView
        ref={scroller}
        contentContainerStyle={styles.music}
        showsVerticalScrollIndicator={false}
      >
        {engraved && stave ? (
          <Stave
            notes={stave.items}
            clef={clef}
            maxWidth={musicWidth}
            fitWidth={musicWidth}
            scale={STAVE_SCALE}
            justify
            beatQuarters={stave.beatQuarters}
            closesWithRepeat={stave.closesWithRepeat}
            endings={stave.endings}
            tempoMarks={stave.tempoMarks}
            head={head}
            showNoteNames={false}
            highlightMeasure={startFrom}
            playhead={playhead}
            onMeasurePress={disabled ? undefined : onStartFromChange}
            pressableMeasures={disabled ? undefined : bars}
            measurePressLabel={(bar) => `Start at bar ${bar}`}
            layout={engraved}
          />
        ) : null}
      </ScrollView>

      {/* The music runs under the panel rather than stopping at a line. */}
      <View style={styles.fade} pointerEvents="none">
        <Svg width="100%" height={FADE_HEIGHT}>
          <Defs>
            <LinearGradient id="score-fade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.surface} stopOpacity={0} />
              <Stop offset="0.58" stopColor={colors.surface} stopOpacity={0.88} />
              <Stop offset="1" stopColor={colors.surface} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height={FADE_HEIGHT} fill="url(#score-fade)" />
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    flex: 1,
    minHeight: 0,
    backgroundColor: colors.surface,
    borderTopWidth: BORDER_WIDTH,
    borderBottomWidth: BORDER_WIDTH,
    borderColor: colors.border,
  },
  music: {
    paddingHorizontal: PAD_X,
    paddingTop: PAD_TOP,
    paddingBottom: PAD_BOTTOM,
  },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: FADE_HEIGHT,
  },
});

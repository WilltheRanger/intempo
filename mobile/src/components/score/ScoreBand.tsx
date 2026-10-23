import { memo, useEffect, useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';

import { Stave } from '../notation/Stave';
import { BORDER_WIDTH, colors, spacing } from '../../design';
import type { ScoreJson } from '../../data/types';
import { bandOf, engraveBand, keptEngraving } from '../../lib/notation/bandEngraving';
import { paginateSystems } from '../../lib/notation/pages';
import { fullBleedMusicWidth } from '../../lib/score/musicWidth';
import { CONTENT_MAX_WIDTH } from '../primitives/ScreenContainer';
import { useEngravingTurn } from './useEngravingTurn';

/**
 * Small enough that a band is a glance rather than a page, large enough that
 * the noteheads are notes rather than dots. Below the score screen's 1.25,
 * which is sized to be read from a stand.
 */
const SCALE = 0.95;

/** The paper's margin either side of the music. */
const MARGIN = spacing.lg;

export interface ScoreBandProps {
  score: ScoreJson;
  /**
   * How large to engrave, as a multiple of the staff's own unit.
   *
   * The default is a band under a title. A library tile is a fifth of the
   * width and wants the same first line at a size that fits it — at which
   * point `maxWidth` breaks the music after a bar or two, and the first
   * system is the clef, the key, the metre and an opening figure, which is
   * exactly what a spine on a shelf should carry.
   */
  scale?: number;
  /**
   * Omit the paper ground and the rule under it.
   *
   * For a caller that draws its own — a tile is already a page-shaped card,
   * and a second ground inside it is a border inside a border.
   */
  plain?: boolean;
  /**
   * How much height the music may use, in points.
   *
   * The default of one point means "the first system and no more", because
   * `paginateSystems` will not cut a system in half and every system is taller
   * than a point. A caller with a real box to fill — a library tile is a page
   * shape, four units tall for every three across — passes its own height and
   * gets as many whole systems as fit in it.
   */
  viewport?: number;
  /**
   * The band runs edge to edge within the screen's reading measure, so its
   * width is known from the window and the music draws on the first frame.
   * Without it the band measures first, and what sits under it moves down
   * when the music arrives (`musicWidth.ts`).
   */
  fullBleed?: boolean;
  /**
   * Wait for a turn to engrave (`engravingTurns.ts`), for a screen that draws
   * many bands at once — the Library's shelf — so they arrive one at a time,
   * top first, instead of all together after one long block of work. A band
   * already engraved at its size is drawn at once either way.
   */
  queued?: boolean;
}

/**
 * The opening of a piece, engraved, as the picture at the top of its screen.
 *
 * **The digitised page rather than the photograph of it.** This band used to be
 * a crop of what the musician's camera saw — a full-resolution phone photograph
 * of paper, signed out of a private bucket. Sheet music is this app's visual
 * identity and that was the argument; what it showed was a desk, a shadow and
 * whatever the lighting did, which is a picture of the *photography* rather
 * than of the music.
 *
 * What the app actually knows about a piece is the reading, and the reading
 * draws: `engrave.ts` puts the clef, the key, the metre and the first line of
 * notes on a staff. That is the same music, printed rather than photographed,
 * and it is the version everything downstream is measured against — so a
 * musician who glances at it is looking at what the app will judge them by.
 *
 * **One system, never a fragment of one.** `paginateSystems` will not cut a
 * system in half, so asking it for a page the height of a single staff returns
 * exactly the first line. Clipping to a fixed height instead would slice
 * whatever fell at the boundary, which on a dense page is a row of beamed
 * sixteenths with their heads removed.
 *
 * Nothing is drawn until the width is known. A stave engraved at zero width
 * is a stave with one bar per system. On full-bleed paper it is known from the
 * window before the first frame (`fullBleed`); anywhere else it is measured,
 * and whatever is under the band moves down when the music arrives.
 *
 * **Memoised, because a shelf re-renders far more often than its music
 * changes.** Every query that lands on the Library — the listing, the latest
 * takes, the readings — and every tile measuring itself re-rendered every
 * band, and a band's stave is hundreds of SVG elements compared again for a
 * drawing that had not moved. The props are a notation object React Query
 * keeps stable and a few numbers, so comparing them is the cheap half.
 */
export const ScoreBand = memo(function ScoreBand({
  score,
  scale = SCALE,
  plain = false,
  viewport = 1,
  fullBleed = false,
  queued = false,
}: ScoreBandProps) {
  const { width: windowWidth } = useWindowDimensions();
  const [width, setWidth] = useState(() =>
    fullBleed ? fullBleedMusicWidth(windowWidth, CONTENT_MAX_WIDTH, MARGIN) : 0,
  );

  function measure(event: LayoutChangeEvent) {
    const measured = event.nativeEvent.layout.width;
    setWidth((current) => (current === measured ? current : measured));
  }

  // Kept per score rather than per component (`bandEngraving.ts`), so a band
  // that mounts again — a tile after a search is cleared — draws at once.
  const known = width > 0 ? keptEngraving(score, width, scale) : null;
  const [mayEngrave, drawn] = useEngravingTurn(queued && width > 0 && known === null);
  const engraved = known ?? (width > 0 && mayEngrave ? engraveBand(score, width, scale) : null);
  const band = engraved ? bandOf(score) : null;

  // The turn is handed on once this engraving is on screen, not when it was
  // computed: the next band waits for the paint (`useEngravingTurn`).
  useEffect(() => {
    if (engraved) {
      drawn();
    }
  }, [drawn, engraved]);

  // The first page of the engraving at the height it was given. At the default
  // of one point every system is taller than the viewport, and a system is
  // never split, so each page holds exactly one and the first is the opening
  // line. Given a real box, the page holds as many whole systems as fit.
  const first = useMemo(() => {
    const pages = engraved
      ? paginateSystems(engraved.layout.systems, Math.max(1, viewport))
      : [];
    return pages.length > 0 ? pages[0] : null;
  }, [engraved, viewport]);

  return (
    <View style={plain ? undefined : styles.band}>
      {/*
        **Measured inside the margins, not outside them.** `onLayout` reports a
        view's border box, so measuring the padded view hands the stave the
        band's full width and the last bar of every system runs off the right
        edge. `PieceScoreScreen` has the same inner view for the same reason
        and says so; this repeated the mistake and the screenshot showed it.
      */}
      <View style={plain ? undefined : styles.inner}>
        <View onLayout={measure}>
        {engraved && first && band ? (
          <View style={{ height: first.height }}>
            <Stave
              notes={band.stave.items}
              clef={band.clef}
              maxWidth={width}
              fitWidth={width}
              scale={scale}
              justify
              beatQuarters={band.stave.beatQuarters}
              closesWithRepeat={band.stave.closesWithRepeat}
              endings={band.stave.endings}
              tempoMarks={band.stave.tempoMarks}
              head={band.head}
              // A letter under every note is a study-book aid, and this is a
              // glance at a piece rather than a page to practise from.
              showNoteNames={false}
              page={first}
              // Engraved once above and handed straight in, rather than
              // engraved a second time inside the component.
              layout={engraved}
            />
          </View>
        ) : null}
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  band: {
    // Paper, edge to edge, with a hairline under it and nothing else: the
    // staff is nearly white and so is the page it sits on, so without an edge
    // the band dissolves into the background (§3 law 6 — structure from
    // hairlines, not elevation).
    backgroundColor: colors.surface,
    borderBottomWidth: BORDER_WIDTH,
    borderBottomColor: colors.border,
    paddingVertical: spacing.md,
  },
  inner: {
    paddingHorizontal: MARGIN,
  },
});

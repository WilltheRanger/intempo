import type { Clef } from '../../data/types';
import { engrave, type Engraving, type StaveItem } from './engrave';

/**
 * The geometry `Stave` draws at, and the one thing that decides it.
 *
 * **It used to live inside the component**, which was fine while the component
 * was the only thing that needed to know where the music ends up. The bar
 * picker needs the same answer *before* it draws anything — where each system
 * sits, so it can group them into pages — and a second copy of the fitting
 * arithmetic would be a second copy that drifts. Two engravings of the same
 * request return the same numbers because this is a pure function of them.
 */
export interface StaveLayoutRequest {
  notes: StaveItem[];
  clef: Clef;
  /** Wrap onto further systems past this width. */
  maxWidth?: number;
  /** Shrink the engraving, if it needs it, to fit this width. Only ever down. */
  fitWidth?: number;
  maxNotes?: number;
  scale?: number;
  justify?: boolean;
  beatQuarters?: number;
  closesWithRepeat?: boolean;
  endings?: { label: string; from: number; to: number; closed: boolean }[];
  tempoMarks?: { label: string; measure: number }[];
  head?: {
    clef: Clef | null;
    key: { pitch: string; kind: 'sharp' | 'flat' }[];
    time: { beats: number; unit: number } | null;
  };
  /** Reserve, and draw, the row of note letters under each system. */
  nameRow?: boolean;
}

export interface StaveLayout {
  layout: Engraving;
  /** The scale actually used, after fitting. */
  fitted: number;
  /** Distance between adjacent staff lines at that scale. */
  lineGap: number;
}

export const LINE_GAP = 9;
export const NOTE_GAP = 30;
export const LEFT_PAD = 22;
export const RIGHT_PAD = 12;

/**
 * Engrave a request, shrinking it once if it overflows `fitWidth`.
 *
 * **One corrective pass, and it lands exactly.** Every geometry constant here
 * is multiplied by the scale and nothing else, so the engraved width is linear
 * in it: measuring once and dividing gives the scale that fits, rather than
 * converging on it.
 */
export function layOutStave(request: StaveLayoutRequest): StaveLayout {
  const {
    notes,
    clef,
    maxWidth,
    fitWidth,
    maxNotes,
    scale = 1,
    justify = false,
    beatQuarters,
    closesWithRepeat,
    endings,
    tempoMarks,
    head,
    nameRow = true,
  } = request;

  const engraveAt = (at: number) =>
    engrave(notes, clef, {
      lineGap: LINE_GAP * at,
      noteGap: NOTE_GAP * at,
      leftPad: LEFT_PAD * at,
      rightPad: RIGHT_PAD * at,
      maxWidth,
      maxNotes,
      justify,
      beatQuarters,
      closesWithRepeat,
      endings,
      tempoMarks,
      head,
      // Also stops the layout reserving the row's height, so hiding the names
      // doesn't leave a band of empty space under every system.
      nameRow,
    });

  const measured = engraveAt(scale);
  const fitted =
    fitWidth && measured.width > fitWidth
      ? scale * (fitWidth / measured.width)
      : scale;

  return {
    layout: fitted === scale ? measured : engraveAt(fitted),
    fitted,
    lineGap: LINE_GAP * fitted,
  };
}

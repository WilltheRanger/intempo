/**
 * Where a pull-down menu opens: under the control that opened it, lined up
 * with it, and never off the screen.
 *
 * **What it replaces** (the owner, 2026-11-13: "••• opens a small iOS menu
 * next to the button instead of a sheet"). The piece's options and Record's
 * "More" each rose from the bottom of the screen as a sheet titled with the
 * piece, for two or three choices — a whole surface across the screen for
 * what iOS answers with a menu where the finger already is. A long press on a
 * piece in the Library opens the same menu from the piece.
 *
 * UIKit's metrics, as Flutter's `CupertinoMenuAnchor` measures them on iOS
 * 18: 250 points wide, rows a touch target tall, a hairline between them,
 * opened from the corner nearest the control. A rule with tests rather than
 * arithmetic inside the component (`DECISIONS.md`, 2026-08-24).
 */

/** A rectangle in window points. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** UIKit's menu width. */
export const MENU_WIDTH = 250;

/** How close the menu may come to an edge of the screen. */
export const MENU_EDGE = 16;

/** The gap between the control and the menu it opens. */
export const MENU_GAP = 8;

/** Which corner the menu grows from: the one nearest the control. */
export type MenuOrigin = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface MenuPlacement {
  left: number;
  top: number;
  width: number;
  origin: MenuOrigin;
}

export interface MenuPlacementInput {
  anchor: Rect;
  window: { width: number; height: number };
  insets: { top: number; bottom: number };
  /** The menu's height, from its rows. */
  height: number;
}

/**
 * Under the control when it fits, over it when it does not; lined up with
 * the control's trailing edge when the control is in the trailing half of the
 * screen — the bar's ••• — and its leading edge otherwise.
 */
export function placeMenu({ anchor, window, insets, height }: MenuPlacementInput): MenuPlacement {
  const width = Math.min(MENU_WIDTH, window.width - MENU_EDGE * 2);
  const trailing = anchor.x + anchor.width / 2 > window.width / 2;

  const preferredLeft = trailing ? anchor.x + anchor.width - width : anchor.x;
  const left = clamp(preferredLeft, MENU_EDGE, window.width - MENU_EDGE - width);

  const lowest = window.height - insets.bottom - MENU_EDGE;
  const highest = insets.top + MENU_EDGE;
  const below = anchor.y + anchor.height + MENU_GAP;
  const above = anchor.y - MENU_GAP - height;
  const opensDown = below + height <= lowest || above < highest;
  const top = opensDown
    ? clamp(below, highest, lowest - height)
    : clamp(above, highest, lowest - height);

  const vertical = opensDown ? 'top' : 'bottom';
  const horizontal = trailing ? 'right' : 'left';
  return { left, top, width, origin: `${vertical}-${horizontal}` };
}

/**
 * The point a menu grows from, relative to its own centre, for a corner.
 *
 * A scale about a corner is a scale about the centre plus a translation of
 * `(1 − scale) × corner`; this is the corner half of that.
 */
export function originOffset(
  origin: MenuOrigin,
  size: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: origin.endsWith('right') ? size.width / 2 : -size.width / 2,
    y: origin.startsWith('top') ? -size.height / 2 : size.height / 2,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

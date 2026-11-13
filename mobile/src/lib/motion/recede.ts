/**
 * The screen behind a tall sheet, pushed back into a card.
 *
 * **What UIKit does with a page sheet** (the owner, 2026-11-13: "tall sheets
 * push the screen behind them back into a card, like iOS sheets do"): the
 * screen the sheet was opened from shrinks a little, drops under the status
 * bar, rounds its top corners and darkens, so the sheet reads as a layer on a
 * stack of cards rather than a panel slid over a page.
 *
 * The numbers are Vaul's, which measures UIKit: the screen narrows by 26
 * points (13 each side), drops 14 points below the inset, and rounds to a
 * 10-point corner (Ionic uses the same radius). Only a tall sheet does this —
 * UIKit leaves the screen alone under a medium sheet, and so does this app
 * under one of its short lists.
 */

/** How far each side of the screen comes in. */
export const RECEDE_INSET = 13;

/** How far the screen's top edge drops below the status bar. */
export const RECEDE_DROP = 14;

/** The screen's corner while it is back. */
export const RECEDE_RADIUS = 10;

/** A content-sized sheet at least this share of the window recedes the screen. */
export const RECEDE_MIN_SHARE = 0.6;

export interface RecedeGeometry {
  /** The screen's scale when fully back. */
  scale: number;
  /**
   * Its downward shift when fully back, for a transform that scales about the
   * centre: what puts the top edge `RECEDE_DROP` under the inset.
   */
  translateY: number;
}

/** Where the screen goes, for a window and its top inset. */
export function recedeGeometry(window: { width: number; height: number }, insetTop: number): RecedeGeometry {
  const scale = window.width > RECEDE_INSET * 2 ? (window.width - RECEDE_INSET * 2) / window.width : 1;
  // Scaling about the centre brings the top edge down by (1 − s)·H/2 already.
  const translateY = insetTop + RECEDE_DROP - ((1 - scale) * window.height) / 2;
  return { scale, translateY };
}

/** Whether a sheet of this height pushes the screen back. */
export function recedesBehind(sheetHeight: number, windowHeight: number): boolean {
  return windowHeight > 0 && sheetHeight >= windowHeight * RECEDE_MIN_SHARE;
}

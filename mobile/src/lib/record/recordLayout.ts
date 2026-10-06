/**
 * Whether Record stacks its three parts or sets them side by side.
 *
 * **Upright, the screen is a column**: the header, the music's band, and the
 * panel the thumb reaches, with the record button at its foot. Measured on a
 * 390×844 phone the column needs about 125pt of header, 100pt for one system
 * of music and 410pt of panel — some 635pt — and every phone held upright has
 * that.
 *
 * **Turned sideways it is 390pt tall, and a column cannot be made to fit.**
 * iOS ignores a web app's portrait lock, so this is reachable on the owner's
 * phone, and it is how a phone sits on a music stand. The record button sat
 * 34pt into view. Letting the panel's settings scroll brought the button back
 * and took the music to nothing; giving the music a floor took the settings to
 * nothing instead. Neither is a screen.
 *
 * So a window too short for the column, and wide enough, puts the music on the
 * left at the full height and the panel on the right, the record button still
 * at its foot — under the right thumb, which is where a sideways phone is
 * held. A window too short *and* too narrow keeps the column, and the panel's
 * settings scroll so the button is never pushed off the screen.
 */

/** Below this the column cannot hold a header, a system of music and the panel. */
export const COLUMN_MIN_HEIGHT = 640;

/** The music needs about this much beside the panel to be worth reading. */
export const SIDE_BY_SIDE_MIN_WIDTH = 640;

/** The panel's width when it stands beside the music. */
export const SIDE_PANEL_WIDTH = 340;

/**
 * The widest the two columns grow together. Wider than the app's 560pt
 * reading measure, which is a measure for one column of text; this is two
 * columns, and the music is the one that wants the room.
 */
export const SIDE_BY_SIDE_MAX_WIDTH = 1040;

export type RecordLayout = 'column' | 'sideBySide';

export function recordLayout(width: number, height: number): RecordLayout {
  return height < COLUMN_MIN_HEIGHT && width >= SIDE_BY_SIDE_MIN_WIDTH ? 'sideBySide' : 'column';
}

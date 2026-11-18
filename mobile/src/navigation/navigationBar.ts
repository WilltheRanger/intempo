/**
 * The navigation bar's rules: what its back button says, and how it looks at
 * a given scroll position.
 *
 * **Why the app has one now** (the owner, 2026-11-13: "make it more like a
 * mobile app"). Every screen drew its own way back — "‹ Back to library" as a
 * line of text above the title — and it scrolled away with the page, so a
 * long screen had no way back and no name once it was scrolled. An iPhone app
 * keeps both in a bar that stays put: back on the leading side, actions on the
 * trailing side, and the screen's title moving into the bar once its own large
 * title has scrolled under it.
 *
 * The numbers are Apple's, read from the reference implementations that copy
 * UIKit most closely: Konsta UI's large-title navbar, Ionic's collapsible
 * header and Flutter's `CupertinoNavigationBar`. The rules are here rather
 * than in `NavigationBar.tsx` because there is no React Native testing library
 * (`DECISIONS.md`, 2026-08-24), and a threshold inside a component is a
 * threshold nothing checks.
 */

/** UIKit's bar, and every reference implementation's: 44pt under the status bar. */
export const NAV_BAR_HEIGHT = 44;

/**
 * The longest previous title the back button repeats.
 *
 * iOS shows the previous screen's title when it fits and "Back" when it does
 * not, so the title centred in the bar is never crowded out. Width is the real
 * test; a count of characters is the testable one, and 12 is about a third of
 * a 390pt bar in 16pt type with the chevron — "Library", "Your takes",
 * "Profile" fit; a piece's title almost never does.
 */
export const BACK_TITLE_MAX = 12;

/** What the back button says when the screen behind is not a short name. */
export const BACK = 'Back';

/**
 * The back button's word.
 *
 * `previous` is the title of the screen underneath, as the navigator knows it.
 * There is none on a screen opened directly — a link, a reload on the web —
 * and then `fallback` is the title of where back will go instead
 * (`useGoBack`'s target), so the word is still the truth.
 */
export function backLabel(previous?: string | null, fallback?: string | null): string {
  const title = clean(previous) || clean(fallback);
  if (title === '' || title.length > BACK_TITLE_MAX) {
    return BACK;
  }
  return title;
}

/**
 * What a screen reader hears: where back goes, not only the word.
 *
 * The visible word is inside the name ("Back to Library" contains "Library"),
 * which is what speech control needs to find the button by what it shows.
 */
export function backAccessibilityLabel(label: string): string {
  return label === BACK ? BACK : `Back to ${label}`;
}

function clean(title?: string | null): string {
  return (title ?? '').replace(/\s+/g, ' ').trim();
}

/** Where the bar is, measured against the scroll view it sits over. */
export interface BarGeometry {
  /** The scroll view's offset; negative while pulled down past the top. */
  scrollY: number;
  /**
   * How far the bar reaches down the scroll view, in points: the bar alone on
   * a screen that starts below the status bar, the inset and the bar on one
   * whose photograph runs up under it.
   */
  overlap: number;
  /** The bottom of the screen's large title, in content points. Null without one. */
  titleBottom: number | null;
  /**
   * The bottom of a dark band at the top of the content — a photograph — in
   * content points. Null on a screen whose ground is the page.
   */
  darkBottom: number | null;
}

export interface BarAppearance {
  /** The bar's own paper and hairline are showing. */
  solid: boolean;
  /** The compact title is showing in the middle of the bar. */
  showTitle: boolean;
  /** `onDark` while the bar is clear over a photograph: its words in ivory. */
  tone: 'auto' | 'onDark';
}

/**
 * How far content has to pass under the bar before the bar draws its ground.
 *
 * A point rather than zero, so the bar does not flicker its hairline on and
 * off while a list settles at the top after a fling.
 */
export const SCROLL_EDGE = 1;

/**
 * The bar's appearance for a scroll position.
 *
 * **Clear at rest, solid once something is under it.** That is UIKit's
 * scroll-edge appearance: a bar over nothing has nothing to separate, and
 * drawing its ground there is a box around empty space (§3 law 8). Over a
 * photograph it stays clear, words in ivory, until the photograph has gone
 * under it — the Library's band and the piece screen's.
 *
 * **The compact title arrives with the ground, and only once the large title
 * has gone.** Two copies of the title on screen at once is the defect the
 * large title collapsing exists to avoid; over a photograph, a title in the
 * bar while the band is still there would be a second headline on the band.
 */
export function barAppearance(geometry: BarGeometry): BarAppearance {
  const { scrollY, overlap, titleBottom, darkBottom } = geometry;
  const solid =
    darkBottom === null ? scrollY >= SCROLL_EDGE : scrollY >= darkBottom - overlap;
  const titleGone = titleBottom === null || scrollY >= titleBottom - overlap;
  return {
    solid,
    showTitle: solid && titleGone,
    tone: !solid && darkBottom !== null ? 'onDark' : 'auto',
  };
}

/** Whether two appearances draw the same bar, so a scroll event can skip a render. */
export function sameAppearance(a: BarAppearance, b: BarAppearance): boolean {
  return a.solid === b.solid && a.showTitle === b.showTitle && a.tone === b.tone;
}

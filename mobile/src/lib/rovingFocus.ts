/**
 * How a keyboard moves through a group of radios or a row of tabs, on the web.
 *
 * **Every radio and every tab was its own Tab stop.** react-native-web gives
 * each pressable a tab index and knows nothing of groups, so the bars of the
 * score on Record — one radio per bar, to choose where the take starts — were
 * a Tab stop each: three on the fixture, and a stop for every bar of a real
 * piece between the score and "Start recording". The arrow keys, which the
 * ARIA radio and tab patterns give to moving within a group, did nothing.
 * Measured 2026-10-05 for radios; the tab bar, the result's Tempo and Pitch
 * and the score's two views were the same on 2026-10-06, and the tab bar was
 * not in a tab list at all.
 *
 * The rule:
 *  - **one Tab stop per group**: the chosen radio or the selected tab, or the
 *    first if none is;
 *  - **the arrows move focus.** In a radio group all four do — down and right
 *    to the next, up and left to the previous. In a tab list, which is a row
 *    everywhere here, only left and right do, so up and down still scroll the
 *    page. Both go round from the last to the first;
 *  - **and they only move it.** Space or Enter chooses, as a tap does. Both
 *    patterns also allow choosing as focus moves, and that is wrong here:
 *    choosing closes the Start from and Instrument sheets, so an arrow press
 *    would shut the sheet on the option next to the one you were on, and on
 *    the tab bar it would leave the screen you were on.
 *
 * Disabled items are skipped, by the arrows and as the Tab stop.
 *
 * **And focus that Tab brings into a group lands on its stop.** Tab alone
 * already does; Tab through the sheet's focus trap did not. Shift+Tab off the
 * start of a sheet wraps to the last element that takes focus, which in the
 * Instrument sheet was "Tenor saxophone", an unchosen radio, rather than the
 * chosen one (2026-10-06). Only Tab: focus put on an item any other way —
 * a tap, a screen reader's browse cursor, code returning focus to where it
 * was — is left where it is. The first version moved all of those too, and
 * focus on the Insights tab jumped to the selected Library tab.
 */

/** The two kinds of group, by their ARIA role. */
export type RovingGroup = 'radiogroup' | 'tablist';

/** One radio or tab, as far as this reads it. */
export interface RovingItem {
  /** Checked, for a radio; selected, for a tab. */
  chosen: boolean;
  enabled: boolean;
}

/** Which way a key moves within a group, or `null` for a key that does not. */
export function rovingStep(key: string, group: RovingGroup): 1 | -1 | null {
  switch (key) {
    case 'ArrowRight':
      return 1;
    case 'ArrowLeft':
      return -1;
    case 'ArrowDown':
      return group === 'radiogroup' ? 1 : null;
    case 'ArrowUp':
      return group === 'radiogroup' ? -1 : null;
    default:
      return null;
  }
}

/**
 * Where a step from `at` lands: the next enabled item that way, round the
 * ends. `at` itself when nothing else is enabled, and -1 for an empty group.
 */
export function rovingAfter(items: readonly RovingItem[], at: number, step: 1 | -1): number {
  const count = items.length;
  if (count === 0) return -1;
  for (let moved = 1; moved <= count; moved += 1) {
    const index = (((at + step * moved) % count) + count) % count;
    if (items[index].enabled) return index;
  }
  return at;
}

/** The group's one Tab stop: the chosen item, else the first enabled one. */
export function rovingTabStop(items: readonly RovingItem[]): number {
  const chosen = items.findIndex((item) => item.chosen && item.enabled);
  if (chosen >= 0) return chosen;
  return items.findIndex((item) => item.enabled);
}

/**
 * Where focus that has just landed on item `landed` should go instead: the
 * group's stop, or `null` to leave it. Moved only when the Tab key brought it
 * from outside the group.
 */
export function rovingEntry(
  items: readonly RovingItem[],
  landed: number,
  { fromInside, byTab }: { fromInside: boolean; byTab: boolean },
): number | null {
  if (fromInside || !byTab) return null;
  const stop = rovingTabStop(items);
  return stop >= 0 && stop !== landed ? stop : null;
}

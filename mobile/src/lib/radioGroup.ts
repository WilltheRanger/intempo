/**
 * How a keyboard moves through a group of radios, on the web.
 *
 * **Every radio was its own Tab stop.** react-native-web gives each pressable
 * a tab index and knows nothing of groups, so the bars of the score on Record
 * — one radio per bar, to choose where the take starts — were a Tab stop each:
 * three on the fixture, and a stop for every bar of a real piece between the
 * score and "Start recording". The arrow keys, which the ARIA radio pattern
 * gives to moving within a group, did nothing. Measured 2026-10-05. Four of
 * the app's seven sets of radios were not in a group at all, so a screen
 * reader could not say "3 of 13" either.
 *
 * The rule:
 *  - **one Tab stop per group**: the chosen radio, or the first if none is;
 *  - **the arrows move focus** — down and right to the next, up and left to
 *    the previous, round from the last to the first;
 *  - **and they only move it.** Space or Enter chooses, as a tap does. The
 *    pattern also allows choosing as focus moves, and that is wrong here:
 *    choosing closes the Start from and Instrument sheets, so an arrow press
 *    would shut the sheet on the option next to the one you were on.
 *
 * Disabled radios are skipped, by the arrows and as the Tab stop.
 */

/** One radio, as far as this reads it. */
export interface RadioState {
  checked: boolean;
  enabled: boolean;
}

/** Which way a key moves within a group, or `null` for a key that does not. */
export function radioStep(key: string): 1 | -1 | null {
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return 1;
    case 'ArrowUp':
    case 'ArrowLeft':
      return -1;
    default:
      return null;
  }
}

/**
 * Where a step from `at` lands: the next enabled radio that way, round the
 * ends. `at` itself when nothing else is enabled, and -1 for an empty group.
 */
export function radioAfter(radios: readonly RadioState[], at: number, step: 1 | -1): number {
  const count = radios.length;
  if (count === 0) return -1;
  for (let moved = 1; moved <= count; moved += 1) {
    const index = (((at + step * moved) % count) + count) % count;
    if (radios[index].enabled) return index;
  }
  return at;
}

/** The group's one Tab stop: the chosen radio, else the first enabled one. */
export function radioTabStop(radios: readonly RadioState[]): number {
  const chosen = radios.findIndex((radio) => radio.checked && radio.enabled);
  if (chosen >= 0) return chosen;
  return radios.findIndex((radio) => radio.enabled);
}

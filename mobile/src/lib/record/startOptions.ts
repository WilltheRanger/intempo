import type { Verdict } from '../../data/types';

/**
 * The places a take can start from, as the "Start from" sheet offers them.
 *
 * From the redesign (`redesign/RecordReady.dc.html`): **From the top**, **Where
 * you stopped** and **Where you rushed last time**, each naming its bar, then
 * "Choose on the score". The prototype hard-coded bars 1, 9 and 13; here they
 * come from the piece's last take, and an option the last take cannot answer is
 * left out rather than offered with a guess.
 *
 * A rule, so it lives here with its tests and the sheet only draws it — there
 * is no React Native testing library in this project (`DECISIONS.md`,
 * 2026-08-24).
 */

export type StartOptionKey = 'top' | 'stopped' | 'rushed';

export interface StartOption {
  key: StartOptionKey;
  label: string;
  bar: number;
}

/** The part of a finished take this reads: which bars it covered, and how. */
export interface LastTakeBars {
  measures: readonly { measure: number; verdict: Verdict }[];
}

const LABELS: Record<StartOptionKey, string> = {
  top: 'From the top',
  stopped: 'Where you stopped',
  rushed: 'Where you rushed last time',
};

/**
 * @param startable the bars that sound, in playing order — `startableMeasures`.
 *   A bar outside it cannot be started from, so no option may name one.
 * @param lastTake the piece's most recent finished take, or null.
 */
export function startOptions(
  startable: readonly number[],
  lastTake: LastTakeBars | null,
): StartOption[] {
  const first = startable[0];
  if (first === undefined) {
    return [];
  }
  const options: StartOption[] = [{ key: 'top', label: LABELS.top, bar: first }];
  if (!lastTake || lastTake.measures.length === 0) {
    return options;
  }

  const covered = lastTake.measures.map((m) => m.measure);
  const last = Math.max(...covered);
  // **Stopped means stopped short.** A take that reached the final sounding
  // bar did not stop anywhere a musician would want to pick up from, so the
  // option is absent rather than pointing past the end.
  const next = startable.find((bar) => bar > last);
  if (next !== undefined) {
    options.push({ key: 'stopped', label: LABELS.stopped, bar: next });
  }

  // The first bar the last take was told it rushed — `rushing`, not
  // `slight_rush`: "where you rushed" is a claim, and a bar inside the
  // tolerance band is not one anybody would practise from.
  const rushed = lastTake.measures.find(
    (m) => m.verdict === 'rushing' && startable.includes(m.measure),
  );
  if (rushed) {
    options.push({ key: 'rushed', label: LABELS.rushed, bar: rushed.measure });
  }

  return options;
}

/**
 * The bar a take starts from: the one chosen, or — where no note sounds in it,
 * so there is nothing to count in to or listen from — the first bar after it
 * that has one.
 *
 * **Never the top in its place.** The screen used to fall back to the first
 * sounding bar of the piece, so a musician who chose a bar of rest — from the
 * score, a link, or a file queued for a bar — was quietly moved back to bar 1:
 * the count-in, Listen and the take all started somewhere they had not
 * chosen, and the analysis was sent that bar too. The owner's words for it:
 * "make sure when I choose the measure to start from it starts there". The
 * nearest place that can start, going forward, is where they meant.
 *
 * @param chosen the bar the musician chose, or null for the top.
 * @param startable the bars that sound, in playing order — `startableMeasures`.
 */
export function startBarFor(chosen: number | null, startable: readonly number[]): number {
  if (startable.length === 0) {
    return chosen ?? 1;
  }
  if (chosen === null) {
    return startable[0];
  }
  if (startable.includes(chosen)) {
    return chosen;
  }
  return startable.find((bar) => bar > chosen) ?? startable[startable.length - 1];
}

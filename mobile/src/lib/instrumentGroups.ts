import type { Instrument } from '../data/types';

/**
 * The instruments as the app offers them: grouped, in the order a musician
 * looks for their own.
 *
 * **One list for every control that offers an instrument.** There were two —
 * onboarding's grid and Profile's four-way switch — each typing out the four
 * strings by hand, and `instrumentLabels.test.ts` existed to stop them
 * drifting. A fifth and sixth instrument (the saxophones, 2026-10-01) did not
 * fit a four-way switch at all, so both controls now read this.
 *
 * **Strings, then winds.** The app began as a string player's, and most of the
 * people choosing are; a full score puts woodwinds above strings, but nobody
 * looks for a violin under a saxophone. Within a group, highest to lowest.
 */
export interface InstrumentGroup {
  label: string;
  instruments: readonly Instrument[];
}

export const INSTRUMENT_GROUPS: readonly InstrumentGroup[] = [
  { label: 'Strings', instruments: ['violin', 'viola', 'cello', 'double_bass'] },
  { label: 'Winds', instruments: ['alto_sax', 'tenor_sax'] },
];

import type { TakeIntonation } from '../../data/types';
import type { ColorToken } from '../../design';

/**
 * How in tune a take was — the owner's request of 2026-09-25, "pitch
 * variation as a graph", measured the way they chose: in cents, per bar,
 * against their own tuning (`backend/app/services/intonation.py`).
 *
 * The bands travel with the take (`TakeIntonation`), as `Tolerance` does, so
 * a stored take is drawn with the thresholds it was measured by.
 */

/** Where a bar's pitch sits against the player's tuning. */
export type PitchBand = 'in_tune' | 'slight' | 'off';

export function pitchBand(
  cents: number,
  take: Pick<TakeIntonation, 'inTuneCents' | 'slightCents'>,
): PitchBand {
  const distance = Math.abs(cents);
  if (distance <= take.inTuneCents) return 'in_tune';
  return distance <= take.slightCents ? 'slight' : 'off';
}

/** The same three colours the tempo charts use, for the same three meanings. */
export function pitchTone(band: PitchBand): ColorToken {
  return band === 'in_tune' ? 'verdictOn' : band === 'slight' ? 'verdictMid' : 'verdictBad';
}

/**
 * A bar's pitch in words: "In tune", "Played a little flat", "Played sharp".
 *
 * **Words, not cents** (2026-09-29). "34 cents flat" asked a student to know
 * what a cent is, under a tempo already given as a number; the bar's band is
 * what the colour on the chart says, and this is the same thing in words.
 */
export function pitchWord(cents: number, take: TakeIntonation): string {
  const band = pitchBand(cents, take);
  if (band === 'in_tune') return 'In tune';
  const way = cents > 0 ? 'sharp' : 'flat';
  // "Played", because a bare "Flat" beside a tempo could be read as the
  // tempo's.
  return band === 'slight' ? `Played a little ${way}` : `Played ${way}`;
}

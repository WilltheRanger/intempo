import { keyBands } from '../../design/colors';
import { accidentalCount } from '../notation/keySignature';

/**
 * The colour of the Library's Continue band for a piece in this key.
 *
 * A key the reading did not find, or wrote in a way `accidentalCount` cannot
 * parse, takes C major's colour: no accidentals is the honest default for "no
 * signature known", and the band is never missing because a page was hard to
 * read.
 */
export function keyBandFor(keySignature: string | null | undefined): string {
  const count = accidentalCount(keySignature) ?? 0;
  const clamped = Math.max(-7, Math.min(7, count)) as keyof typeof keyBands;
  return keyBands[clamped];
}

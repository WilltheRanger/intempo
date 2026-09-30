import { describe, expect, it } from 'vitest';

import userModel from '../../../backend/app/models/user.py?raw';
import scoresRouter from '../../../backend/app/routers/scores.py?raw';
import scoreSchema from '../../../backend/app/services/score_schema.py?raw';
import { FIELD_LIMITS } from './fieldLimits';

/**
 * Every `max_length` the backend declares for a field, read out of its source.
 * All of them, not the first: `scores.py` declares a title on create, on the
 * MusicXML import and on rename, and a limit changed on one of the three is
 * exactly the drift this exists to catch.
 */
function limitsOf(source: string, field: string): number[] {
  const declaration = new RegExp(`^\\s*${field}: [^\\n]*max_length=(\\d+)`, 'gm');
  return [...source.matchAll(declaration)].map((match) => Number(match[1]));
}

describe('FIELD_LIMITS', () => {
  it.each([
    ['displayName', userModel, 'display_name'],
    ['pieceTitle', scoresRouter, 'title'],
    ['composer', scoresRouter, 'composer'],
    ['movement', scoresRouter, 'movement'],
    ['timeSignature', scoresRouter, 'time_signature'],
    ['printedTempo', scoreSchema, 'text'],
  ] as const)('%s is the limit the backend declares', (key, source, field) => {
    const declared = limitsOf(source, field);
    expect(declared.length).toBeGreaterThan(0);
    expect(new Set(declared)).toEqual(new Set([FIELD_LIMITS[key]]));
  });
});

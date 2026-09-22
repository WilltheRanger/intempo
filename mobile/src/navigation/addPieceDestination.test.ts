import { describe, expect, it } from 'vitest';

import { addPieceDestination } from './addPieceDestination';
import type { AddPieceOption } from './types';

/**
 * Every option this function actually receives, as a value the compiler
 * checks against the union.
 *
 * A `Record` keyed by the union is the exhaustiveness guard: adding a new way
 * to add a piece fails `tsc` here until it is listed, and then fails the test
 * below until it has a destination. `scan` is deliberately not a key — this
 * function's own parameter type excludes it, the same way `AddPieceSheet`'s
 * `onSelect` does, because the camera is inline now and never reaches here.
 */
const EVERY_OPTION: Record<Exclude<AddPieceOption, 'scan'>, true> = {
  import: true,
  notation: true,
  manual: true,
};

describe('addPieceDestination', () => {
  it('sends every option to the add form, carrying itself', () => {
    expect(addPieceDestination('import')).toEqual({
      route: 'AddPiece',
      params: { option: 'import' },
    });
    expect(addPieceDestination('notation')).toEqual({
      route: 'AddPiece',
      params: { option: 'notation' },
    });
    expect(addPieceDestination('manual')).toEqual({
      route: 'AddPiece',
      params: { option: 'manual' },
    });
  });

  it('has a destination for every option there is', () => {
    for (const option of Object.keys(EVERY_OPTION) as Exclude<
      AddPieceOption,
      'scan'
    >[]) {
      const destination = addPieceDestination(option);
      expect(destination).toEqual({ route: 'AddPiece', params: { option } });
    }
  });
});

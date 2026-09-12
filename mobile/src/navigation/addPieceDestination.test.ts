import { describe, expect, it } from 'vitest';

import { addPieceDestination } from './addPieceDestination';
import type { AddPieceOption } from './types';

/**
 * Every option, as a value the compiler checks against the union.
 *
 * A `Record` keyed by the union is the exhaustiveness guard: adding a fifth way
 * to add a piece fails `tsc` here until it is listed, and then fails the test
 * below until it has a destination. That is the property worth having — the
 * three hand-copied versions of this rule could each have missed a new option
 * silently, and the only symptom would have been a menu entry that did nothing.
 */
const EVERY_OPTION: Record<AddPieceOption, true> = {
  scan: true,
  import: true,
  notation: true,
  manual: true,
};

describe('addPieceDestination', () => {
  it('sends a scan to the camera, which takes no params', () => {
    expect(addPieceDestination('scan')).toEqual({ route: 'Scanner' });
  });

  it('sends every other option to the add form, carrying itself', () => {
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
    for (const option of Object.keys(EVERY_OPTION) as AddPieceOption[]) {
      const destination = addPieceDestination(option);
      expect(destination.route).toBeTruthy();
      // Only the scanner may arrive without params; anything else reaching the
      // form without its option opens a picker that has forgotten the choice.
      if (destination.route !== 'Scanner') {
        expect(destination.params).toEqual({ option });
      }
    }
  });

  it('never routes a scan into the form the route types exclude it from', () => {
    expect(addPieceDestination('scan')).not.toHaveProperty('params');
  });
});

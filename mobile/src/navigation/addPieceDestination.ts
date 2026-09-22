import type { AddPieceOption, RootStackParamList } from './types';

/** Where an add-piece choice goes, as data rather than as a `navigate` call. */
export type AddPieceDestination = {
  route: 'AddPiece';
  params: RootStackParamList['AddPiece'];
};

/**
 * Which screen each way of adding a piece opens.
 *
 * **A rule, in a module, with tests** — `CLAUDE.md` §3. It was written three
 * times instead: `LibraryScreen`, `TodayScreen` and `InsightsScreen` each
 * carried a byte-identical `handleSelectOption`, and Insights' copy even
 * documented the fact ("the same wait Today and Library use") rather than
 * removing it. Three copies of a routing decision that nothing checked, so a
 * fifth way of adding a piece would have needed finding all three.
 *
 * **Only three options reach this, not four.** The camera used to be a
 * fourth branch here — "the camera is presented over everything rather than
 * pushed into the form" — back when it was a route of its own. It is inline
 * now, wherever it appears, and `AddPieceSheet` never calls this for it; the
 * parameter type says so, the same way the route types do.
 */
export function addPieceDestination(
  option: Exclude<AddPieceOption, 'scan'>,
): AddPieceDestination {
  return { route: 'AddPiece', params: { option } };
}

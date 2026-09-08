import type { AddPieceOption, RootStackParamList } from './types';

/** Where an add-piece choice goes, as data rather than as a `navigate` call. */
export type AddPieceDestination =
  | { route: 'Scanner' }
  | { route: 'AddPiece'; params: RootStackParamList['AddPiece'] };

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
 * The shape mirrors what the route types already say: `AddPiece` accepts
 * `Exclude<AddPieceOption, 'scan'>`, because a scan is a camera session rather
 * than a form. That exclusion is the whole rule, and now the compiler and a
 * test both hold it.
 */
export function addPieceDestination(option: AddPieceOption): AddPieceDestination {
  // The camera is presented over everything rather than pushed into the form.
  return option === 'scan'
    ? { route: 'Scanner' }
    : { route: 'AddPiece', params: { option } };
}

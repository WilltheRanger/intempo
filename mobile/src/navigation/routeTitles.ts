import type { RootStackParamList } from './types';

/** The tabs, by the name the tab bar shows them under. */
export const TAB_TITLES = ['Library', 'Insights', 'Profile'] as const;
export type TabTitle = (typeof TAB_TITLES)[number];

/**
 * Every route's title, for the back button of the screen pushed above it.
 *
 * **A back button names the screen it returns to** (`navigationBar.ts`), and
 * a route's name is code — "PieceDetail", "CapturedPages" — which is what
 * React Navigation reports for a screen that never said otherwise. So every
 * route has a title here, from the first frame. A screen whose large title is
 * data, such as a piece's name, replaces its own entry once that title is
 * drawn (`ScreenContainer`); these are what is true before then and on every
 * screen whose title never changes.
 *
 * The words are each screen's own heading, so the back button repeats what was
 * on screen, not a synonym for it.
 */
export const ROUTE_TITLES: { readonly [K in keyof RootStackParamList]: string } = {
  Tabs: 'Library',
  AddPiece: 'Add a piece',
  Scanner: 'Scan',
  CapturedPages: 'Pages',
  Transcribe: 'Reading',
  TranscriptionReview: 'Name this piece',
  PieceDetail: 'Piece',
  PieceTakes: 'Your takes',
  PieceScore: 'Score',
  MeasureEdit: 'Bar',
  ProofRead: 'Check the reading',
  ChangeEmail: 'Change email',
  ChangePassword: 'Change password',
  DeleteAccount: 'Delete account',
  ExportData: 'Download your data',
  Legal: 'Legal',
  Help: 'Help & connection',
  Acknowledgements: 'Open source',
  Record: 'Practice',
  Tempo: 'Tempo',
  SetTempo: 'Set your tempo',
  UploadRecording: 'Upload a recording',
  Warmup: 'Warmup',
  Verdict: 'Result',
};

/**
 * The title of the tab the Tabs route is showing.
 *
 * The root stack sees the tabs as one route, so a screen pushed above them
 * would otherwise say "‹ Library" over Insights. `focused` is the tab
 * navigator's focused route name, which is undefined until the tabs have been
 * navigated at all — and then the first tab is the one showing.
 */
export function tabsTitle(focused: string | undefined): TabTitle {
  return TAB_TITLES.find((tab) => tab === focused) ?? TAB_TITLES[0];
}

/** Where `useGoBack` sends a screen with nothing behind it. Mirrors its `BackTarget`. */
export type BackDestination = { tab: TabTitle } | { route: keyof RootStackParamList };

/** The title of a back destination, for a screen opened directly. */
export function destinationTitle(destination: BackDestination): string {
  return 'tab' in destination ? destination.tab : ROUTE_TITLES[destination.route];
}

import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

/**
 * How a piece gets into the library.
 *
 * `import` is photographs already in the camera roll; `notation` is a
 * MusicXML file. They read alike as words and are not alike at all — one ends
 * in a model reading a picture, the other in durations stated outright — so
 * the sheet labels them by what the musician has in their hand rather than by
 * the verb.
 */
export type AddPieceOption = 'scan' | 'import' | 'notation' | 'manual';

export type RootStackParamList = {
  Tabs: undefined;
  /** Scan has its own screen; this covers the other two options. */
  AddPiece: { option: Exclude<AddPieceOption, 'scan'> };
  /**
   * `adding` is set only when the scan is already in progress — "Add page"
   * from the review list.
   *
   * The viewfinder resets the capture session when it opens, because opening
   * it is normally how a scan *starts*. It is not the only way back into one:
   * pages that arrived through Import have no scanner beneath the review list
   * at all, so "Add page" there pushed a fresh viewfinder whose mount wiped
   * the whole import. This says which of the two it is, rather than leaving
   * the screen to guess from a session that looks the same either way — a
   * lingering scan someone abandoned looks exactly like one they are adding to.
   */
  Scanner: { adding?: boolean } | undefined;
  /** Pages live in the shared capture session, not in params. */
  CapturedPages: undefined;
  Transcribe: undefined;
  TranscriptionReview: undefined;
  PieceDetail: { pieceId: string };
  /**
   * A saved piece's own score — the engraving, the photograph, or both.
   *
   * Takes a `pieceId` precisely because the screens this replaced didn't: they
   * read the shared capture session, so every piece showed the same thing.
   */
  PieceScore: { pieceId: string; view?: 'notation' | 'original' };
  /**
   * Correcting one measure of a transcription.
   *
   * Keyed by measure *number*, not index: the number is what
   * `validate.py` reports as broken, what the caveat line names, and what
   * survives a re-read that changes how many measures there are.
   */
  MeasureEdit: { pieceId: string; measureNumber: number };
  ChangeEmail: undefined;
  ChangePassword: undefined;
  Acknowledgements: undefined;
  Record: { pieceId: string };
  /** The daily warmup. Reads the instrument from preferences, so no params. */
  Warmup: undefined;
  /** The analysis to show. Everything else comes from the API. */
  Verdict: { analysisId: string };
};

export type TabParamList = {
  Today: undefined;
  Library: undefined;
  Insights: undefined;
  Profile: undefined;
};

export type RootNavigation = NativeStackNavigationProp<RootStackParamList>;

/**
 * Navigation as seen from inside a tab screen: it can switch tabs *and* push
 * onto the root stack, so both `navigate('Library')` and
 * `navigate('Record', …)` typecheck.
 */
export type TabScreenNavigation<T extends keyof TabParamList> =
  CompositeNavigationProp<
    BottomTabNavigationProp<TabParamList, T>,
    NativeStackNavigationProp<RootStackParamList>
  >;

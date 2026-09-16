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
  AddPiece: {
    option: Exclude<AddPieceOption, 'scan'>;
    /** Existing manual piece that imported pages should be read into. */
    attachToPieceId?: string;
    /**
     * Add the chosen images to the scan in progress instead of replacing it.
     *
     * Set only by "Add page" on the review list. The caller decides, for the
     * same reason `Scanner` takes `adding`: from inside `captureSession` an
     * abandoned scan and one being added to are the same array, so asking the
     * session would append a new piece's first page to a scan nobody came
     * back to.
     */
    adding?: boolean;
  };
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
  Scanner:
    | { adding?: boolean; attachToPieceId?: string }
    | undefined;
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
  /**
   * Checking a reading against what the app thinks is wrong with it.
   *
   * A piece rather than a bar: the whole point is to walk the proposals in one
   * pass, and a route per proposal would put the musician back on the page
   * they came to stop re-reading.
   */
  ProofRead: { pieceId: string };
  ChangeEmail: undefined;
  ChangePassword: undefined;
  DeleteAccount: undefined;
  ExportData: undefined;
  /**
   * The privacy policy or the terms.
   *
   * One screen and a parameter rather than two routes: the two documents are
   * the same shape, and both stores expect both to be reachable in the app.
   */
  Legal: { document: 'privacy' | 'terms' };
  Help: undefined;
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

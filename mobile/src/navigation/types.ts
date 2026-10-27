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
   * The scan screen: where `/scan` lands, and where a camera that gave no
   * photograph says why. Every button that photographs a page opens the
   * phone's camera directly (`usePageCamera`), so a scan only comes here when
   * something went wrong or someone followed a link.
   *
   * The parameters say what the camera was for, so "Try again" asks for the
   * same thing: `adding` a page to the scan on the review list, a `retake` of
   * one page by id, or a new scan — for an existing piece when
   * `attachToPieceId` is set. A lingering scan someone abandoned looks exactly
   * like one they are adding to, so the caller says which it is. `problem` is
   * what went wrong. See `lib/scan/pagePhoto.ts`.
   */
  Scanner:
    | {
        adding?: boolean;
        attachToPieceId?: string;
        retake?: string;
        problem?: 'refused' | 'failed';
      }
    | undefined;
  /** Pages live in the shared capture session, not in params. */
  CapturedPages: undefined;
  Transcribe: undefined;
  TranscriptionReview: undefined;
  PieceDetail: { pieceId: string };
  /** Every take of one piece, behind the piece screen's "Your takes" row. */
  PieceTakes: { pieceId: string };
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
  /**
   * `startAt` opens the take at a bar rather than at the top — Insights'
   * "Practice bars 21–24" is the caller. The musician can still move it.
   */
  Record: { pieceId: string; startAt?: number };
  /** The practice tempo for a piece, chosen on its own screen from Record. */
  Tempo: { pieceId: string };
  /**
   * The same screen as step 3 of adding a piece (`redesign/SetTempo.dc.html`):
   * the working tempo, set once, before the score opens for the first time.
   */
  SetTempo: { pieceId: string };
  /** A recording the musician already has, looked at before it is sent. */
  UploadRecording: { pieceId: string };
  /** The daily warmup. Reads the instrument from preferences, so no params. */
  Warmup: undefined;
  /**
   * The analysis to show. Everything else comes from the API. `from: 'takes'`
   * when it was opened from a piece's list of takes, so its back link says so
   * and returns there rather than past it.
   */
  Verdict: { analysisId: string; from?: 'takes' };
};

export type TabParamList = {
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

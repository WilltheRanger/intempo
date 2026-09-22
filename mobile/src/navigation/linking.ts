import type { LinkingOptions } from '@react-navigation/native';

import type { RootStackParamList } from './types';

/**
 * Where every screen lives, as a URL.
 *
 * **Without this the web build has one address.** `NavigationContainer` was
 * mounted with no `linking`, so React Navigation kept the whole stack in memory
 * and never touched history. Measured on the shipping build: tapping Profile
 * and then opening "Download my data" left the address bar on `/` throughout,
 * and pressing the browser's Back button **left the app** — it landed on
 * `about:blank` rather than the screen before.
 *
 * That is three consumer failures from one omission, and the web build is what
 * ships to Cloudflare Pages:
 *
 *   * Back quits instead of going back, which is the one gesture every web user
 *     has;
 *   * a refresh returns to Today, losing whatever they were reading;
 *   * nothing is linkable — a musician cannot send a piece to their teacher, or
 *     keep a tab open on the score they are working through.
 *
 * It also gives the native builds their deep links for free: `app.json` already
 * declares the `intempo` scheme and nothing was using it.
 *
 * **Paths are chosen to age well, not to mirror the navigator.** `/pieces/:id`
 * rather than `/PieceDetail`, because the URL is the part a musician might
 * paste to somebody and the screen names are ours. Nesting matches meaning —
 * a score belongs to a piece — so a reader can guess `/pieces/x/score` and be
 * right.
 */
/**
 * The route-to-path map, and nothing that touches a runtime.
 *
 * **No `expo-linking` import here, deliberately.** That package reaches
 * `react-native`, whose Flow syntax vitest cannot parse, so importing it at
 * module scope makes this file untestable — and the test is the whole point:
 * it is what stops a screen added next month from shipping without a URL. The
 * prefixes are composed in `App.tsx`, which no test imports. Same split, and
 * the same reason, as the lazy import in `lib/scan/shrink.ts`.
 */
export const screenConfig: LinkingOptions<RootStackParamList>['config'] = {
  screens: {
      // The tabs are the app's four destinations, so they take the short paths.
      // Today is `/` because it is where a cold start lands and a bare domain
      // should not redirect.
      Tabs: {
        screens: {
          Today: '',
          Library: 'library',
          Insights: 'insights',
          Profile: 'profile',
        },
      },

      // A piece and the things that belong to it.
      PieceDetail: 'pieces/:pieceId',
      PieceScore: 'pieces/:pieceId/score',
      // **The one route whose parameter is not a string.**
      //
      // `MeasureEdit` takes `measureNumber: number`, and a URL parameter always
      // arrives as text — React Navigation does not coerce it. Without `parse`,
      // `/pieces/x/bars/5` hands the screen `"5"`, and the screen does
      // `m.measure_number === params.measureNumber`, which is `5 === "5"` and
      // therefore false. The editor opens, finds no measure, and still titles
      // itself "Bar 5" — a screen that looks like it worked and did not, from a
      // link and only from a link.
      MeasureEdit: {
        path: 'pieces/:pieceId/bars/:measureNumber',
        parse: { measureNumber: (value: string) => Number(value) },
        stringify: { measureNumber: (value: number) => String(value) },
      },
      Record: 'pieces/:pieceId/record',
      Verdict: 'analyses/:analysisId',
      Warmup: 'warmup',

      // The scan, in the order it happens. Deliberately linkable even though
      // the pages themselves live in memory: someone who refreshes mid-scan
      // should land on the step they were on and find it empty, which is
      // recoverable, rather than on Today wondering where the scan went.
      //
      // No entry for the camera itself: it is inline wherever it appears now,
      // never its own screen, so there is nothing here for a URL to point at.
      AddPiece: 'add/:option',
      CapturedPages: 'scan/pages',
      Transcribe: 'scan/sending',
      TranscriptionReview: 'scan/name',

      // Account and support.
      ChangeEmail: 'account/email',
      ChangePassword: 'account/password',
      DeleteAccount: 'account/delete',
      ExportData: 'account/export',
      // **Namespaced, not a bare `:document`.** A single-segment parameter
      // matches *any* one-segment path, so `/help` and `/library` would resolve
      // to the legal screen with document="help" depending on match order.
      Legal: 'legal/:document',
      Help: 'help',
      Acknowledgements: 'acknowledgements',
  },
};

/**
 * Every screen's path, flattened — `PieceScore` → `pieces/:pieceId/score`.
 *
 * @test-seam exported for `linking.test.ts`, which holds this file to the
 * route list — a screen with no path is one the browser's Back button walks
 * out of the app from, and nothing else would notice. The app itself needs no
 * flattened view of the config; React Navigation reads the nested one.
 */
export function pathsByScreen(): Record<string, string> {
  const found: Record<string, string> = {};
  const walk = (screens: Record<string, unknown>) => {
    for (const [name, value] of Object.entries(screens)) {
      if (typeof value === 'string') {
        found[name] = value;
      } else if (value && typeof value === 'object' && 'path' in value) {
        // The `{ path, parse }` form, used where a parameter is not a string.
        found[name] = (value as { path: string }).path;
      } else if (value && typeof value === 'object' && 'screens' in value) {
        walk((value as { screens: Record<string, unknown> }).screens);
      }
    }
  };
  walk(screenConfig?.screens as Record<string, unknown>);
  return found;
}

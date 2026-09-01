import { useNavigation } from '@react-navigation/native';

import type { RootNavigation, RootStackParamList } from './types';

/**
 * Where a screen goes when there is nothing behind it.
 *
 * The tab names are reachable from the root stack through `Tabs`, so a
 * fallback is either a tab or a pushed route with its params.
 */
export type BackTarget =
  | { tab: 'Today' | 'Library' | 'Insights' | 'Profile' }
  | { [K in keyof RootStackParamList]: { route: K; params: RootStackParamList[K] } }[keyof RootStackParamList];

/**
 * A back control that keeps the promise its label makes.
 *
 * **Every back control in the app was `navigation.goBack()`, and on a screen
 * opened directly that does nothing at all.** React Navigation's `goBack` is a
 * no-op on the first screen of a stack, so a deep link — which is the ordinary
 * way to arrive in the web build on Cloudflare Pages — left the musician on a
 * screen whose only exit was inert. Measured in Chromium: `/legal/privacy`,
 * `/add/manual`, `/help`, `/warmup` and `/pieces/:id/bars/3` all stayed exactly
 * where they were when their back control was pressed.
 *
 * Worse than a dead button, because those labels are specific. "Back to score",
 * "Back to profile" and "Back to today" each name a destination and went
 * nowhere — the label was already the right answer and nothing acted on it.
 *
 * So the fallback is not a guess: it is what the screen's own `backLabel`
 * already says. `PageHeader` renders the label; this makes it true.
 *
 * ```tsx
 * const goBack = useGoBack({ route: 'PieceScore', params: { pieceId } });
 * <PageHeader onBack={goBack} backLabel="Back to score" />
 * ```
 */
export function useGoBack(fallback: BackTarget): () => void {
  const navigation = useNavigation<RootNavigation>();

  return () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    if ('tab' in fallback) {
      // Through `Tabs`, because a tab is not a route on the root stack. Passing
      // the tab as a nested screen also *replaces* rather than stacking, which
      // is what "back" should do — arriving at Today with a back arrow to a
      // screen you were never on is its own kind of wrong.
      navigation.navigate('Tabs', { screen: fallback.tab } as never);
      return;
    }
    // The union of every route and its own params is exactly what
    // `navigate` accepts, and exactly what TypeScript cannot narrow across a
    // mapped type. Cast once, here, rather than at twenty call sites.
    (navigation.navigate as (route: string, params?: object) => void)(
      fallback.route,
      fallback.params as object | undefined,
    );
  };
}

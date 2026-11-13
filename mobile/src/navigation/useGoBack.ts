import { HeaderBackContext } from '@react-navigation/elements';
import { useNavigation } from '@react-navigation/native';
import { useContext } from 'react';

import { BACK, backAccessibilityLabel, backLabel } from './navigationBar';
import { destinationTitle } from './routeTitles';
import { useSceneExit } from './sceneExit';
import type { RootNavigation, RootStackParamList } from './types';

/**
 * Where a screen goes when there is nothing behind it.
 *
 * The tab names are reachable from the root stack through `Tabs`, so a
 * fallback is either a tab or a pushed route with its params.
 */
export type BackTarget =
  | { tab: 'Library' | 'Insights' | 'Profile' }
  | { [K in keyof RootStackParamList]: { route: K; params: RootStackParamList[K] } }[keyof RootStackParamList];

/**
 * A back control that keeps the promise its label makes. Screens take it
 * through `useBackButton`, which names it too.
 *
 * **Every back control in the app was `navigation.goBack()`, and on a screen
 * opened directly that does nothing at all.** React Navigation's `goBack` is a
 * no-op on the first screen of a stack, so a deep link — which is the ordinary
 * way to arrive in the web build on Cloudflare Pages — left the musician on a
 * screen whose only exit was inert. Measured in Chromium: `/legal/privacy`,
 * `/add/manual`, `/help`, `/warmup` and `/pieces/:id/bars/3` all stayed exactly
 * where they were when their back control was pressed.
 *
 * Worse than a dead button, because those labels are specific. "Back to the score",
 * "Back to profile" and "Back to today" each name a destination and went
 * nowhere — the label was already the right answer and nothing acted on it.
 *
 * So the fallback is not a guess: it is where the label says back goes
 * (`useBackButton` names the button after it), and this makes it true.
 *
 * ```tsx
 * const back = useBackButton({ route: 'PieceScore', params: { pieceId } });
 * <ScreenContainer navigationBar={{ back }}>
 * ```
 */
export function useGoBack(fallback: BackTarget): () => void {
  const navigation = useNavigation<RootNavigation>();
  const exit = useSceneExit();

  return () => {
    if (navigation.canGoBack()) {
      // The screen slides out and the one under it comes back before the pop,
      // as iOS's back does (`sceneExit.ts`) — only here, where the screen
      // underneath is the one back goes to.
      exit(() => navigation.goBack());
      return;
    }
    /*
      **`popTo`, never `navigate`.** In React Navigation 7, `navigate` to a
      screen that is not the current one *pushes* a new copy of it — so on a
      screen with nothing behind it (a reload on the web rebuilds the stack
      from the URL, and a deep link starts one) "back" put the destination on
      top of the screen being left. The destination's own back then returned
      here, which pushed it again: the owner found exactly that loop between a
      piece and its score (2026-09-23). `popTo` goes back to the destination
      if it is in the stack and otherwise *replaces* this screen with it,
      which is what back means.
    */
    if ('tab' in fallback) {
      // Through `Tabs`, because a tab is not a route on the root stack.
      navigation.popTo('Tabs', { screen: fallback.tab } as never);
      return;
    }
    // The union of every route and its own params is exactly what `popTo`
    // accepts, and exactly what TypeScript cannot narrow across a mapped type.
    // Cast once, here, rather than at twenty call sites.
    (navigation.popTo as (route: string, params?: object) => void)(
      fallback.route,
      fallback.params as object | undefined,
    );
  };
}

/** What the navigation bar's back button needs: its word, its spoken name and its press. */
export interface BackButton {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}

/**
 * A back button for a step inside one screen — the microphone explained, the
 * checks before a first take — which returns to that screen's own controls
 * rather than to the screen underneath. "Back", because where it goes has no
 * title of its own to repeat.
 */
export function plainBack(onPress: () => void): BackButton {
  return { label: BACK, accessibilityLabel: BACK, onPress };
}

/**
 * A back button that always goes to one named place — the piece screen's,
 * which returns to the Library whatever was opened above it.
 */
export function backTo(title: string, onPress: () => void): BackButton {
  const label = backLabel(title);
  return { label, accessibilityLabel: backAccessibilityLabel(label), onPress };
}

/**
 * The navigation bar's back button, named after the screen it returns to.
 *
 * **The word is the previous screen's title** (the owner, 2026-11-13: "‹
 * Library"), which is what every iPhone app's back button says, and "Back"
 * when that title is too long to sit beside the one in the middle of the bar
 * (`navigationBar.ts`). The navigator passes each screen the title of the one
 * under it (`HeaderBackContext`), from `ROUTE_TITLES` or from the large title
 * that screen drew. On a screen opened directly there is nothing under it,
 * and the word is the title of `fallback` instead — where `useGoBack` will
 * really go — so the label never names a screen the press does not reach.
 *
 * ```tsx
 * const back = useBackButton({ route: 'PieceScore', params: { pieceId } });
 * <ScreenContainer navigationBar={{ back }}>
 * ```
 */
export function useBackButton(fallback: BackTarget): BackButton {
  const onPress = useGoBack(fallback);
  const previous = useContext(HeaderBackContext);
  const label = backLabel(previous?.title, destinationTitle(fallback));
  return { label, accessibilityLabel: backAccessibilityLabel(label), onPress };
}

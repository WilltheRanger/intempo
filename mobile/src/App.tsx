import {
  DefaultTheme,
  NavigationContainer,
  type Theme,
} from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import * as Linking from 'expo-linking';

import { ErrorBoundary } from './components/ErrorBoundary';
import { screenConfig } from './navigation/linking';
import { ApiError, warmApi } from './data/api/client';
import { describeFixtureReason, IS_LIVE_BACKEND } from './data/environment';
import { prepareForPlayback } from './lib/audio/session';
import { formatDocumentTitle } from './lib/documentTitle';
import { hydratePracticeTempos } from './data/practiceTempo';
import { hydratePreferences } from './data/preferences';
import { hydratePendingAnalysis } from './data/practice/pendingAnalysis';
import { colors, fontsToLoad } from './design';
import { RootNavigator } from './navigation/RootNavigator';

/**
 * How long a fetched answer is treated as current.
 *
 * **Without this every screen refetched from scratch every time it was
 * opened.** React Query's default is zero, so a query is stale the instant it
 * resolves: tapping Library, then Today, then Library again is three full
 * round trips and three skeletons, for a repertoire that has not changed in
 * between. Against a host that costs two serial round trips per authenticated
 * request, that is the app feeling slow everywhere at once, and it is entirely
 * self-inflicted.
 *
 * Thirty seconds. Long enough that moving around the app is instant, short
 * enough that nothing here goes visibly out of date — and every write already
 * invalidates what it changed, which is what actually keeps these screens
 * honest. Staleness is the fallback, not the mechanism.
 *
 * It does not touch polling: `usePiece` drives a page being read with
 * `refetchInterval`, which ignores this.
 */
const STALE_TIME_MS = 30_000;

/**
 * Whether to ask again after a failure.
 *
 * **Never for an `ApiError`, and the reason is that the retrying already
 * happened.** `send` gives a repeatable request two attempts of
 * `REQUEST_TIMEOUT_MS` before it reports anything, so a GET against a dead
 * connection has already spent ninety seconds by the time it throws — and
 * React Query's default of one retry ran the whole `queryFn` again, wake and
 * all, for **three minutes** of a screen showing a skeleton before it showed an
 * error. A musician waiting three minutes is not waiting, they have closed the
 * app.
 *
 * Anything with a status was answered, and answered the same way twice is the
 * same answer: a 404 is not going to become a 200, and a 403 over the tier
 * limit is a thing to render rather than to ask about again.
 *
 * A non-`ApiError` gets one retry. That is the unfamiliar failure — something
 * threw that this layer does not recognise — and one more attempt is a fair
 * price for a class of error we cannot reason about.
 */
function retryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) {
    return false;
  }
  return failureCount < 1;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: retryQuery,
      staleTime: STALE_TIME_MS,
      refetchOnWindowFocus: false,
    },
    mutations: {
      // A write is never repeated automatically. `send` will not retry one
      // either, and for the same reason: a POST that timed out may have been
      // received and run, with only its answer lost — asking again submits a
      // second take, or creates a second piece, and the musician finds a
      // duplicate they never made.
      retry: false,
    },
  },
});

/**
 * React Navigation paints its own background between screens; without this it
 * would flash white against the warm ivory page.
 */
const navigationTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bg,
    card: colors.bg,
    text: colors.textPrimary,
    border: colors.border,
    primary: colors.accent,
    notification: colors.accent,
  },
};

/**
 * How long to wait for the typefaces before showing the app anyway.
 *
 * They are bundled, so on any working deployment this never fires. It exists
 * for the deployment that isn't working: a font that 404s or hangs used to
 * hold `fontsLoaded` false forever, and the placeholder below is a plain
 * ivory rectangle — so the whole app became a blank screen because of a
 * decorative resource. Wrong typeface beats no interface.
 */
const FONT_TIMEOUT_MS = 5000;

/**
 * Where the app answers from.
 *
 * Composed here rather than in `navigation/linking.ts` because `expo-linking`
 * reaches `react-native`, and a module that imports it cannot be unit-tested —
 * see the note there. The route map is the part worth testing; the prefixes are
 * one line of configuration.
 */
const linking = {
  prefixes: [Linking.createURL('/'), 'https://intempo.app', 'https://www.intempo.app'],
  config: screenConfig,
};

export default function App() {
  const [fontsLoaded, fontError] = useFonts(fontsToLoad);
  const [fontsTimedOut, setFontsTimedOut] = useState(false);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      return;
    }
    const timer = setTimeout(() => setFontsTimedOut(true), FONT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [fontsLoaded, fontError]);

  // Loaded, failed, or took too long — all three mean "stop waiting". Only the
  // first renders in Newsreader and Inter; the others fall back to the
  // platform's own faces, which is a visual regression and not an outage.
  const typographyReady = fontsLoaded || fontError != null || fontsTimedOut;

  // Settings are read synchronously from press handlers, so the saved values
  // have to be in memory before anything can consult them. Fonts gate the
  // first frame anyway, which is more than enough time for one storage read.
  useEffect(() => {
    void hydratePreferences();
    void hydratePracticeTempos();
    // Restore a take the server accepted before the browser or app was closed.
    // Today turns this tiny hand-off into a visible, resumable result.
    void hydratePendingAnalysis();
    // Ask iOS to let this app be heard on a phone that is on silent, once, at
    // launch. Every player asserts it again before it makes a sound — the
    // recorder takes the session away and does not give it back in a state
    // that plays — but doing it here means the *first* tap is not the one that
    // races a category change.
    void prepareForPlayback();
    // Start waking the host now rather than when the first screen asks.
    //
    // The API sleeps when idle and takes about 75 seconds to come back, and
    // every authenticated request has to wait for a CORS preflight before it
    // is even sent — so the wake is the long pole in front of every screen.
    // `warmApi` is the one request that needs no preflight, it is awaited by
    // the first authenticated call anyway, and it never rejects. Beginning it
    // here rather than a second and a half later, after the fonts and the
    // first render, is a second and a half off everything behind it.
    if (IS_LIVE_BACKEND) {
      void warmApi();
    }
  }, []);

  // Say once, at boot, whether this build is talking to a backend.
  //
  // `describeFixtureReason` was written for exactly this and then never
  // called, which made it useless at the only moment it mattered: someone
  // opens a fresh deployment, sees a library of Bach and Wohlfahrt, and has no
  // way to tell whether that is their data or the seed. Both look identical,
  // and "it silently fell back" is the failure this whole module exists to
  // prevent.
  //
  // A console line rather than anything on screen. Convention 8 keeps
  // developer chrome out of the product, and a banner would be exactly that —
  // but a build that cannot say what it is connected to costs an afternoon,
  // and the person who needs the answer already has the console open.
  useEffect(() => {
    const reason = describeFixtureReason();
    // eslint-disable-next-line no-console
    console.info(reason ?? 'InTempo: connected to the API — showing your data.');
  }, []);

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {/*
          Visible, with dark content for the ivory page beneath it. `app.json`
          pins `userInterfaceStyle: light`, so this stays correct even when the
          device is in dark mode.
        */}
        <StatusBar style="dark" />
        {typographyReady ? (
          <NavigationContainer
            theme={navigationTheme}
            documentTitle={{ formatter: formatDocumentTitle }}
            // Without this the whole app is one URL: back leaves the site,
            // a refresh returns to Today, and nothing can be linked to.
            // See `navigation/linking.ts`.
            linking={linking}
          >
            <RootNavigator />
          </NavigationContainer>
        ) : (
          // Holds the page colour so the first frame doesn't flash white.
          // Only ever on screen for the moment the fonts take to load — never
          // as a terminal state, which is what `typographyReady` guarantees.
          <View style={{ flex: 1, backgroundColor: colors.bg }} />
        )}
      </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

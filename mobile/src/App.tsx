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

import { ErrorBoundary } from './components/ErrorBoundary';
import { describeFixtureReason } from './data/environment';
import { hydratePracticeTempos } from './data/practiceTempo';
import { hydratePreferences } from './data/preferences';
import { colors, fontsToLoad } from './design';
import { RootNavigator } from './navigation/RootNavigator';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
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
          <NavigationContainer theme={navigationTheme}>
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

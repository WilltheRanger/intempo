import {
  DefaultTheme,
  NavigationContainer,
  type Theme,
} from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorBoundary } from './components/ErrorBoundary';
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

export default function App() {
  const [fontsLoaded] = useFonts(fontsToLoad);

  // Settings are read synchronously from press handlers, so the saved values
  // have to be in memory before anything can consult them. Fonts gate the
  // first frame anyway, which is more than enough time for one storage read.
  useEffect(() => {
    void hydratePreferences();
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
        {fontsLoaded ? (
          <NavigationContainer theme={navigationTheme}>
            <RootNavigator />
          </NavigationContainer>
        ) : (
          // Holds the page colour so the first frame doesn't flash white.
          <View style={{ flex: 1, backgroundColor: colors.bg }} />
        )}
      </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

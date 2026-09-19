import { registerRootComponent } from 'expo';
import * as Sentry from '@sentry/react-native';

import App from './src/App';

const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (!__DEV__ && sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(!__DEV__ && sentryDsn ? Sentry.wrap(App) : App);

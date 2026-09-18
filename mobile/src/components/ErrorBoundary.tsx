import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Sentry from '@sentry/react-native';

import { colors, spacing } from '../design';
import { PrimaryButton } from './primitives/PrimaryButton';
import { ScreenContainer } from './primitives/ScreenContainer';
import { Text } from './primitives/Text';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches a render crash and offers a way out.
 *
 * Without one, a thrown error unmounts the whole tree and leaves a blank
 * screen — on a release build with no red box, that reads as the app dying.
 *
 * "Try again" clears the error and remounts. That genuinely fixes the
 * transient causes (a bad response, a race on mount) and genuinely doesn't fix
 * a deterministic bug, which will simply throw again — an honest outcome, and
 * better than a dead end either way.
 *
 * A class because there is still no hook for this; `componentDidCatch` has no
 * function-component equivalent.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (!__DEV__ && process.env.EXPO_PUBLIC_SENTRY_DSN) {
      Sentry.captureException(error, {
        contexts: { react: { componentStack: info.componentStack } },
      });
    }
    // The only place this is recorded today. When crash reporting is wired up,
    // it reports from here.
    //
    // The one `console` in shipped code besides `App.tsx`'s boot line, and the
    // exception `CLAUDE.md` §1 is about is *debug* output. A render that threw
    // has already put a fallback in front of the musician; the stack is the
    // only trace of why, and dropping it to satisfy a lint rule would leave
    // the crash with no record at all.
    // eslint-disable-next-line no-console
    console.error('Unhandled render error', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <View style={styles.root}>
        <ScreenContainer contentStyle={styles.centred}>
          <View>
            <Text variant="screenTitle">Something broke</Text>
            <Text variant="body" color="textSecondary" style={styles.message}>
              InTempo hit an error it couldn&apos;t recover from on its own.
              Nothing you&apos;ve saved is affected.
            </Text>

            {/*
              The message is developer text, so it's set quietly and last —
              useless to most people, and the only thing worth quoting in a bug
              report for the few who need it.
            */}
            <Text
              variant="metadataSmall"
              color="textTertiary"
              style={styles.detail}
            >
              {error.message}
            </Text>

            <PrimaryButton
              label="Try again"
              onPress={() => this.setState({ error: null })}
              style={styles.retry}
            />
          </View>
        </ScreenContainer>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centred: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  message: {
    marginTop: spacing.md,
  },
  detail: {
    marginTop: spacing.xl,
  },
  retry: {
    marginTop: spacing['3xl'],
  },
});

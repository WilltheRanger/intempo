import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { PrimaryButton, Text } from '../../components/primitives';
import { arrival } from '../../data/arrival';
import { EASE_OUT, spacing } from '../../design';
import { useReducedMotion } from '../../lib/useReducedMotion';
import { CentredScreen } from './CentredScreen';
import { StaffIllustration } from './StaffIllustration';

/**
 * After the last answer has reached the account
 * (`redesign/OnboardDone.dc.html`): a bar written out and read back, "Welcome
 * to InTempo", and the way into the app.
 *
 * Shown once, by `RootNavigator`, while `useArrival()` says `welcome` — so it
 * is not a route anybody can come back to, and it never appears for an
 * account that was onboarded before this launch. "Start practicing" hands
 * over to Today, which fades in the once.
 *
 * The three-foot test: the bar first, the welcome second, the button third.
 * The three arrive in that order too, each a little later than the last.
 */
export function OnboardingDone() {
  return (
    <CentredScreen
      footer={
        <Arrive over={1260} style={styles.button}>
          <PrimaryButton label="Start practicing" onPress={() => arrival.started()} />
        </Arrive>
      }
    >
      <Arrive over={820}>
        <StaffIllustration />
      </Arrive>
      <Arrive over={1040} style={styles.titleBlock}>
        <Text variant="displayTitle" accessibilityRole="header" style={styles.title}>
          Welcome to InTempo
        </Text>
      </Arrive>
      <Arrive over={1260}>
        <Text variant="body" color="textSecondary" style={styles.lede}>
          Everything is set. Photograph a piece and play it.
        </Text>
      </Arrive>
    </CentredScreen>
  );
}

/** Up 14 and in, over the given time — the prototype's `.in` classes. */
function Arrive({
  over,
  style,
  children,
}: {
  over: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: over,
      easing: EASE_OUT,
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [over, progress, reduceMotion]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  titleBlock: {
    marginTop: 30,
  },
  title: {
    fontSize: 40,
    lineHeight: 46,
    textAlign: 'center',
  },
  lede: {
    marginTop: 14,
    maxWidth: 280,
    textAlign: 'center',
  },
  button: {
    // The prototype's footer is 4pt deeper here than on Welcome, which has a
    // second line under its button and this has none.
    paddingBottom: spacing.xs,
  },
});

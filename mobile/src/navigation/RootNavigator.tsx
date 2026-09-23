import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Platform, StyleSheet, View, type ViewStyle } from 'react-native';

import { useAuthStatus } from '../data/auth/useAuthStatus';
import { useMe } from '../data/hooks/useMe';
import { preferences } from '../data/preferences';
import { EASE_OUT, colors, motion } from '../design';
import { shouldOnboard } from '../lib/onboarding';
import { useApplyOnboardingDraft } from '../data/hooks/useApplyOnboardingDraft';
import { useReducedMotion } from '../lib/useReducedMotion';
import { AcknowledgementsScreen } from '../screens/account/AcknowledgementsScreen';
import { AccountStartupScreen } from '../screens/account/AccountStartupScreen';
import { ChangeEmailScreen } from '../screens/account/ChangeEmailScreen';
import { ChangePasswordScreen } from '../screens/account/ChangePasswordScreen';
import { DeleteAccountScreen } from '../screens/account/DeleteAccountScreen';
import { ExportDataScreen } from '../screens/account/ExportDataScreen';
import { LegalScreen } from '../screens/legal/LegalScreen';
import { HelpScreen } from '../screens/account/HelpScreen';
import { AddPieceScreen } from '../screens/addPiece/AddPieceScreen';
import { SignedOutFlow } from '../screens/auth/SignedOutFlow';
import { SetPasswordScreen } from '../screens/auth/SetPasswordScreen';
import { CapturedPagesScreen } from '../screens/capturedPages/CapturedPagesScreen';
import { InsightsScreen } from '../screens/insights/InsightsScreen';
import { WarmupScreen } from '../screens/warmup/WarmupScreen';
import { LibraryScreen } from '../screens/library/LibraryScreen';
import { PieceDetailScreen } from '../screens/pieceDetail/PieceDetailScreen';
import { MeasureEditScreen } from '../screens/measureEdit/MeasureEditScreen';
import { ProofReadScreen } from '../screens/proofRead/ProofReadScreen';
import { OnboardingScreen } from '../screens/onboarding/OnboardingScreen';
import { PieceScoreScreen } from '../screens/pieceScore/PieceScoreScreen';
import { RecordScreen } from '../screens/record/RecordScreen';
import { TempoScreen } from '../screens/tempo/TempoScreen';
import { ProfileScreen } from '../screens/profile/ProfileScreen';
import { ScannerScreen } from '../screens/scanner/ScannerScreen';
import { TodayScreen } from '../screens/today/TodayScreen';
import { TranscribeScreen } from '../screens/transcribe/TranscribeScreen';
import { TranscriptionReviewScreen } from '../screens/transcriptionReview/TranscriptionReviewScreen';
import { VerdictScreen } from '../screens/verdict/VerdictScreen';
import { BottomTabBar } from './BottomTabBar';
import { StackScene } from './StackScene';
import type { RootStackParamList, TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();


function webTabSceneStyle(focused: boolean): ViewStyle {
  return {
    opacity: focused ? 1 : 0.96,
    transform: [{ translateY: focused ? 0 : 3 }],
    transitionProperty: 'opacity, transform',
    transitionDuration: `${motion.scene}ms`,
    transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
    willChange: 'opacity, transform',
  } as unknown as ViewStyle;
}

function TabScene({ children }: { children: ReactNode }) {
  const focused = useIsFocused();
  const reduceMotion = useReducedMotion();
  const arrival = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (Platform.OS === 'web' || !focused || reduceMotion) {
      arrival.setValue(1);
      return;
    }
    // Tabs stay mounted so lists and scroll positions survive navigation. Each
    // time one becomes visible, briefly settle the existing scene into place
    // instead of remounting it just to replay an entrance animation.
    arrival.setValue(0);
    const animation = Animated.timing(arrival, {
      toValue: 1,
      duration: motion.scene,
      easing: EASE_OUT,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [arrival, focused, reduceMotion]);

  const content = (
    <Animated.View
      style={[
        styles.tabScene,
        reduceMotion
          ? null
          : Platform.OS === 'web'
            ? webTabSceneStyle(focused)
            : {
                opacity: arrival.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.96, 1],
                }),
                transform: [
                  {
                    translateY: arrival.interpolate({
                      inputRange: [0, 1],
                      outputRange: [3, 0],
                    }),
                  },
                ],
              },
      ]}
    >
      {children}
    </Animated.View>
  );

  // React Navigation correctly hides inactive scenes from screen readers, but
  // on web aria-hidden does not remove descendant buttons from the keyboard
  // order. A musician tabbing through Insights could therefore land on every
  // control in the invisible Today and Library screens first. HTML inert is
  // the platform primitive that blocks focus, pointer input and accessibility
  // exposure together. Native keeps its own equivalent flags.
  if (Platform.OS === 'web') {
    return (
      <div
        aria-hidden={!focused}
        inert={focused ? undefined : true}
        style={{ display: 'flex', flex: 1, minHeight: 0 }}
      >
        {content}
      </div>
    );
  }

  return (
    <View
      style={styles.tabScene}
      accessibilityElementsHidden={!focused}
      importantForAccessibility={focused ? 'auto' : 'no-hide-descendants'}
      pointerEvents={focused ? 'auto' : 'none'}
    >
      {content}
    </View>
  );
}

function TodayTab() {
  return (
    <TabScene>
      <TodayScreen />
    </TabScene>
  );
}

function LibraryTab() {
  return (
    <TabScene>
      <LibraryScreen />
    </TabScene>
  );
}

function InsightsTab() {
  return (
    <TabScene>
      <InsightsScreen />
    </TabScene>
  );
}

function ProfileTab() {
  return (
    <TabScene>
      <ProfileScreen />
    </TabScene>
  );
}

function TabNavigator() {
  return (
    <Tab.Navigator
      tabBar={(props) => <BottomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Today" component={TodayTab} />
      <Tab.Screen name="Library" component={LibraryTab} />
      <Tab.Screen name="Insights" component={InsightsTab} />
      <Tab.Screen name="Profile" component={ProfileTab} />
    </Tab.Navigator>
  );
}

/**
 * Tabs at the root, with full-screen flows pushed above them.
 *
 * Headers are off everywhere — screens supply their own `PageHeader` so the
 * type scale stays under the design system's control rather than the
 * navigator's defaults.
 *
 * Signed out, the whole tree is replaced rather than covered: there is nothing
 * behind the sign-in screen to go back to, and unmounting the tabs means a
 * previous account's library isn't sitting in memory under the form.
 */
export function RootNavigator() {
  const status = useAuthStatus();

  if (status === 'loading') {
    // Restoring a stored session takes a moment on a cold start. Holding the
    // page colour beats flashing the sign-in form at someone already signed in.
    return <View style={styles.holding} />;
  }

  if (status === 'signedOut') {
    return <SignedOutFlow />;
  }

  // A reset link establishes a real session, so this would otherwise read as
  // "signed in" and drop someone into Today with the reset they clicked on
  // unfinished. Held outside the navigator like the sign-in gate, because it is
  // the same kind of thing: the app is not reachable until it is dealt with.
  if (status === 'recovering') {
    return <SetPasswordScreen />;
  }

  return <SignedInApp />;
}

/**
 * The app, once there is an account behind it.
 *
 * Its own component so `useMe` runs **only** when signed in. Called from
 * `RootNavigator` it would fire a `/v1/me` on the sign-in screen, where there
 * is no session to answer it — the hook has no `enabled` flag, and giving it
 * one would put this screen's concern into every other caller.
 */
function SignedInApp() {
  const {
    data: me,
    isPending,
    isError,
    error,
    isFetching,
    refetch,
  } = useMe();

  /*
   * Fill the device's instrument from the account, on a device that has none.
   *
   * **Above the early returns, and that is not style.** `EDIT_LOG` records a
   * `useState` placed below one taking the screen down with React error #310;
   * a hook after a conditional return is the same fault.
   *
   * The rule itself is in `preferences.adoptAccountInstrument`, where it can
   * be tested — this is only the place that knows when the account has
   * arrived. Idempotent, so re-running it on every change of the value is
   * free, and it does nothing at all once the device has an instrument.
   */
  useEffect(() => {
    preferences.adoptAccountInstrument(me?.instrument);
  }, [me?.instrument]);

  /*
   * The answers given before this account existed, put on it now that it does.
   *
   * Onboarding runs ahead of the sign-up form, and creating an account returns
   * no session — so the answers waited on the device through a confirmation
   * link. This is where they land. Above the early returns for the same reason
   * as the effect above it.
   */
  const applyingDraft = useApplyOnboardingDraft(me);

  // Restore the account before mounting any tab. A failed /v1/me used to open
  // the app anyway, so Today, Library, Insights and Profile each rendered a
  // different error for the same unavailable account. It also bypassed
  // onboarding because "unknown" was treated as "already done".
  if (isPending) {
    return <AccountStartupScreen />;
  }

  if (isError || !me) {
    return (
      <AccountStartupScreen
        error={error ?? new Error('The server returned no account profile.')}
        retrying={isFetching}
        onRetry={() => {
          void refetch();
        }}
      />
    );
  }

  // Held in front of the app the way sign-in and password recovery are. Saving
  // invalidates `me`; the refetched profile carries `onboarded_at`, and this
  // gate falls away without a navigation reset.
  //
  // The draft is applied first, and the holding screen is not politeness: the
  // answers are already given, so showing the form while they are being sent
  // would ask for them a second time and let somebody answer it twice.
  if (applyingDraft) {
    return <AccountStartupScreen />;
  }

  if (shouldOnboard(me)) {
    return <OnboardingScreen />;
  }

  return (
    <Stack.Navigator
      screenOptions={{ headerShown: false }}
      /*
        **Every pushed screen arrives, on the build that draws no transition
        of its own.** `native-stack` is the platform's own navigation
        controller on a phone and a `display: none` switch on the web, so this
        wrapper is a no-op on native and the whole entrance on the web — see
        `StackScene`. One `screenLayout` rather than nineteen wrapped
        components: a screen added below would otherwise be the one that pops.
      */
      screenLayout={({ children }) => <StackScene>{children}</StackScene>}
    >
      <Stack.Screen name="Tabs" component={TabNavigator} />
      <Stack.Screen name="AddPiece" component={AddPieceScreen} />
      {/* Full-bleed dark camera surface — presented over everything. */}
      <Stack.Screen
        name="Scanner"
        component={ScannerScreen}
        options={{ animation: 'slide_from_bottom' }}
      />
      <Stack.Screen name="CapturedPages" component={CapturedPagesScreen} />
      <Stack.Screen name="Transcribe" component={TranscribeScreen} />
      <Stack.Screen
        name="TranscriptionReview"
        component={TranscriptionReviewScreen}
      />
      <Stack.Screen name="PieceDetail" component={PieceDetailScreen} />
      <Stack.Screen name="PieceScore" component={PieceScoreScreen} />
      <Stack.Screen name="MeasureEdit" component={MeasureEditScreen} />
      <Stack.Screen name="ProofRead" component={ProofReadScreen} />
      <Stack.Screen name="ChangeEmail" component={ChangeEmailScreen} />
      <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
      <Stack.Screen name="DeleteAccount" component={DeleteAccountScreen} />
      <Stack.Screen name="ExportData" component={ExportDataScreen} />
      <Stack.Screen name="Legal" component={LegalScreen} />
      <Stack.Screen name="Help" component={HelpScreen} />
      <Stack.Screen
        name="Acknowledgements"
        component={AcknowledgementsScreen}
      />
      <Stack.Screen name="Record" component={RecordScreen} />
      <Stack.Screen name="Tempo" component={TempoScreen} />
      <Stack.Screen name="Warmup" component={WarmupScreen} />
      <Stack.Screen name="Verdict" component={VerdictScreen} />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  tabScene: {
    flex: 1,
  },
  holding: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});

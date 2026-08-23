import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';

import { useAuthStatus } from '../data/auth/useAuthStatus';
import { colors } from '../design';
import { AcknowledgementsScreen } from '../screens/account/AcknowledgementsScreen';
import { ChangeEmailScreen } from '../screens/account/ChangeEmailScreen';
import { ChangePasswordScreen } from '../screens/account/ChangePasswordScreen';
import { AddPieceScreen } from '../screens/addPiece/AddPieceScreen';
import { AuthScreen } from '../screens/auth/AuthScreen';
import { SetPasswordScreen } from '../screens/auth/SetPasswordScreen';
import { CapturedPagesScreen } from '../screens/capturedPages/CapturedPagesScreen';
import { InsightsScreen } from '../screens/insights/InsightsScreen';
import { WarmupScreen } from '../screens/warmup/WarmupScreen';
import { LibraryScreen } from '../screens/library/LibraryScreen';
import { PieceDetailScreen } from '../screens/pieceDetail/PieceDetailScreen';
import { MeasureEditScreen } from '../screens/measureEdit/MeasureEditScreen';
import { PieceScoreScreen } from '../screens/pieceScore/PieceScoreScreen';
import { RecordScreen } from '../screens/record/RecordScreen';
import { ProfileScreen } from '../screens/profile/ProfileScreen';
import { ScannerScreen } from '../screens/scanner/ScannerScreen';
import { TodayScreen } from '../screens/today/TodayScreen';
import { TranscribeScreen } from '../screens/transcribe/TranscribeScreen';
import { TranscriptionReviewScreen } from '../screens/transcriptionReview/TranscriptionReviewScreen';
import { VerdictScreen } from '../screens/verdict/VerdictScreen';
import { BottomTabBar } from './BottomTabBar';
import type { RootStackParamList, TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

function TabNavigator() {
  return (
    <Tab.Navigator
      tabBar={(props) => <BottomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Today" component={TodayScreen} />
      <Tab.Screen name="Library" component={LibraryScreen} />
      <Tab.Screen name="Insights" component={InsightsScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
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
    return <AuthScreen />;
  }

  // A reset link establishes a real session, so this would otherwise read as
  // "signed in" and drop someone into Today with the reset they clicked on
  // unfinished. Held outside the navigator like the sign-in gate, because it is
  // the same kind of thing: the app is not reachable until it is dealt with.
  if (status === 'recovering') {
    return <SetPasswordScreen />;
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
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
      <Stack.Screen name="ChangeEmail" component={ChangeEmailScreen} />
      <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
      <Stack.Screen
        name="Acknowledgements"
        component={AcknowledgementsScreen}
      />
      <Stack.Screen name="Record" component={RecordScreen} />
      <Stack.Screen name="Warmup" component={WarmupScreen} />
      <Stack.Screen name="Verdict" component={VerdictScreen} />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  holding: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});

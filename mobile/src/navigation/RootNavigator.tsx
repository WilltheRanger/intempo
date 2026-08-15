import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { InsightsScreen } from '../screens/insights/InsightsScreen';
import { LibraryScreen } from '../screens/library/LibraryScreen';
import { PracticeScreen } from '../screens/practice/PracticeScreen';
import { ProfileScreen } from '../screens/profile/ProfileScreen';
import { TodayScreen } from '../screens/today/TodayScreen';
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
 */
export function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={TabNavigator} />
      <Stack.Screen name="Practice" component={PracticeScreen} />
    </Stack.Navigator>
  );
}

import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

/** How a piece gets into the library. */
export type AddPieceOption = 'scan' | 'import' | 'manual';

export type RootStackParamList = {
  Tabs: undefined;
  Practice: { pieceId: string };
  /** Scan has its own screen; this covers the other two options. */
  AddPiece: { option: Exclude<AddPieceOption, 'scan'> };
  Scanner: undefined;
  CapturedPages: { pageCount: number };
};

export type TabParamList = {
  Today: undefined;
  Library: undefined;
  Insights: undefined;
  Profile: undefined;
};

export type RootNavigation = NativeStackNavigationProp<RootStackParamList>;

/**
 * Navigation as seen from inside a tab screen: it can switch tabs *and* push
 * onto the root stack, so both `navigate('Library')` and
 * `navigate('Practice', …)` typecheck.
 */
export type TabScreenNavigation<T extends keyof TabParamList> =
  CompositeNavigationProp<
    BottomTabNavigationProp<TabParamList, T>,
    NativeStackNavigationProp<RootStackParamList>
  >;

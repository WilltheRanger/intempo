import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { CONTENT_MAX_WIDTH, SCREEN_GUTTER } from '../../components/primitives/ScreenContainer';
import { colors, spacing } from '../../design';
import { centringLift } from './centring';

/**
 * Onboarding's two unframed screens, Welcome and Done: a picture and a title
 * centred on the screen, and the button in the thumb zone under them. The
 * centring is `centringLift`'s.
 */
export function CentredScreen({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [area, setArea] = useState(0);
  const [content, setContent] = useState(0);
  const [below, setBelow] = useState(0);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View
        style={[styles.centre, { paddingTop: centringLift(area, content, below) }]}
        onLayout={(event) => setArea(event.nativeEvent.layout.height)}
      >
        <View
          style={styles.block}
          onLayout={(event) => setContent(event.nativeEvent.layout.height)}
        >
          {children}
        </View>
      </View>
      <View
        style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.sm }]}
        onLayout={(event) => setBelow(event.nativeEvent.layout.height)}
      >
        {footer}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centre: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: SCREEN_GUTTER,
  },
  block: {
    alignItems: 'center',
  },
  footer: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: SCREEN_GUTTER,
    paddingTop: spacing.lg,
  },
});

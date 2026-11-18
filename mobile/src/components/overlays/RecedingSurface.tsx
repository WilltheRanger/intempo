import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Animated, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../../design';
import { RECEDE_RADIUS, recedeGeometry } from '../../lib/motion/recede';

/** 0 with the screen in place, 1 with it fully back. */
type RecedeDriver = Animated.AnimatedInterpolation<number> | Animated.Value;

interface Recede {
  /** Drive the screen back from a sheet's own movement; returns the release. */
  attach(driver: RecedeDriver): () => void;
}

const RecedeContext = createContext<Recede | null>(null);

/**
 * The app, drawn on a surface a tall sheet can push back (`lib/motion/recede`).
 *
 * **Driven by the sheet's own animated values, not by a copy of them.** A
 * sheet hands over the 0–1 value its rise and its drag already produce, so the
 * screen behind moves with the finger and settles with the spring, frame for
 * frame, with nothing to keep in step. Sheets are drawn in a `Modal`, which is
 * outside this surface on both platforms, so only the screen moves.
 *
 * The ground under it is the app's warm ink: what shows round the card's
 * corners while it is back, where UIKit shows black.
 */
export function RecedingSurface({ children }: { children: ReactNode }) {
  const [driver, setDriver] = useState<RecedeDriver | null>(null);
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const recede = useMemo<Recede>(
    () => ({
      attach(next) {
        setDriver(next);
        return () => setDriver((current) => (current === next ? null : current));
      },
    }),
    [],
  );

  const geometry = recedeGeometry(window, insets.top);
  const back = driver
    ? {
        transform: [
          { translateY: driver.interpolate({ inputRange: [0, 1], outputRange: [0, geometry.translateY] }) },
          { scale: driver.interpolate({ inputRange: [0, 1], outputRange: [1, geometry.scale] }) },
        ],
        // The web animates the corner with the rest; a phone's native driver
        // cannot animate a radius, so there it is set while a sheet is up.
        borderRadius:
          Platform.OS === 'web'
            ? driver.interpolate({ inputRange: [0, 1], outputRange: [0, RECEDE_RADIUS] })
            : RECEDE_RADIUS,
      }
    : null;

  return (
    <RecedeContext.Provider value={recede}>
      <View style={styles.ground}>
        <Animated.View style={[styles.surface, back]}>{children}</Animated.View>
      </View>
    </RecedeContext.Provider>
  );
}

/**
 * Push the screen back with `driver` while `active`.
 *
 * Outside a `RecedingSurface` — a test, the error screen — it does nothing.
 */
export function useRecede(driver: RecedeDriver, active: boolean): void {
  const recede = useContext(RecedeContext);
  useEffect(() => {
    if (!recede || !active) {
      return undefined;
    }
    return recede.attach(driver);
  }, [active, driver, recede]);
}

const styles = StyleSheet.create({
  ground: {
    flex: 1,
    backgroundColor: colors.darkBg,
  },
  surface: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: colors.bg,
  },
});

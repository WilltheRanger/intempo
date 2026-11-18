import { StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import { SPINNER_TICKS } from '../../lib/motion/pullToRefresh';

/** UIActivityIndicatorView at its medium size. */
export const ACTIVITY_SPINNER_SIZE = 20;
const SIZE = ACTIVITY_SPINNER_SIZE;

/**
 * The iPhone's spinner: eight ticks round a centre, the newest darkest,
 * turning a tick at a time.
 *
 * `shown` draws only the first ticks, which is how a pull reveals it; while
 * `spinning` it steps round once a second, as UIKit's does. The web build
 * only — a phone has the platform's own (`RefreshControl`).
 */
export function ActivitySpinner({
  color,
  shown = SPINNER_TICKS,
  spinning,
}: {
  color: string;
  shown?: number;
  spinning: boolean;
}) {
  const centre = SIZE / 2;
  return (
    <View style={[styles.box, spinning ? SPINNING : null]} aria-hidden>
      <Svg width={SIZE} height={SIZE}>
        {Array.from({ length: SPINNER_TICKS }, (_, index) => {
          const angle = (index / SPINNER_TICKS) * Math.PI * 2 - Math.PI / 2;
          const inner = SIZE * 0.22;
          const outer = SIZE * 0.46;
          return index < shown ? (
            <Line
              key={index}
              x1={centre + Math.cos(angle) * inner}
              y1={centre + Math.sin(angle) * inner}
              x2={centre + Math.cos(angle) * outer}
              y2={centre + Math.sin(angle) * outer}
              stroke={color}
              strokeWidth={SIZE * 0.1}
              strokeLinecap="round"
              // The newest tick darkest, fading back round the circle.
              opacity={0.25 + 0.75 * ((index + 1) / SPINNER_TICKS)}
            />
          ) : null;
        })}
      </Svg>
    </View>
  );
}

/** One turn a second, a tick at a time. */
const SPINNING = {
  animationKeyframes: [{ '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } }],
  animationDuration: '1000ms',
  animationTimingFunction: `steps(${SPINNER_TICKS})`,
  animationIterationCount: 'infinite',
} as unknown as ViewStyle;

const styles = StyleSheet.create({
  box: {
    width: SIZE,
    height: SIZE,
  },
});

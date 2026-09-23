import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Platform,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { Text } from '../../components/primitives';
import { BORDER_WIDTH, colors, radii } from '../../design';
import { fractionOf, tempoAtFraction } from '../../lib/record/tapTempo';

const THUMB = 24;
const HEIGHT = 34;

/**
 * The redesign's tempo bar: a rail with a gold fill and a white thumb, the ends
 * labelled underneath (`redesign/Tempo.dc.html`).
 *
 * **Grab anywhere on it**, not only the thumb, as the prototype does: a press
 * lands the tempo where the finger is and a drag carries it. The 34pt strip is
 * the target; the 4pt rail is only what is drawn.
 *
 * A real slider to assistive tech: `role="slider"` with its value range, and
 * on the web the arrow keys step it by one (five with Shift), which is what
 * the prototype's `nudge` did. `aria-*` rather than `accessibilityValue`,
 * which react-native-web drops.
 */
export function TempoSlider({
  bpm,
  bounds,
  unitLabel,
  marked = null,
  onChange,
}: {
  bpm: number;
  bounds: { min: number; max: number };
  unitLabel: string;
  /**
   * The tempo printed on the page, drawn as a tick on the rail with its number
   * over it (`redesign/SetTempo.dc.html`): where "as written" is, while the
   * thumb says where you are. Null draws nothing.
   */
  marked?: number | null;
  onChange: (bpm: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const node = useRef<View>(null);

  // Read through a ref: the responder below is created once.
  const live = useRef({ width, bounds, bpm, onChange });
  live.current = { width, bounds, bpm, onChange };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // A horizontal drag on this strip is always the slider's, even inside
        // something that scrolls.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event) => {
          const { width: w, bounds: b, onChange: set } = live.current;
          if (w > 0) set(tempoAtFraction(event.nativeEvent.locationX / w, b));
        },
        onPanResponderMove: (event) => {
          const { width: w, bounds: b, onChange: set } = live.current;
          if (w > 0) set(tempoAtFraction(event.nativeEvent.locationX / w, b));
        },
      }),
    [],
  );

  // Arrow keys on the web. React Native has no keyboard prop for a plain view,
  // so the handler goes on the DOM node react-native-web renders.
  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }
    const element = node.current as unknown as HTMLElement | null;
    if (!element?.addEventListener) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      const { bpm: now, bounds: b, onChange: set } = live.current;
      const step = event.shiftKey ? 5 : 1;
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
        event.preventDefault();
        set(Math.min(b.max, now + step));
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
        event.preventDefault();
        set(Math.max(b.min, now - step));
      }
    }
    element.addEventListener('keydown', onKey);
    return () => element.removeEventListener('keydown', onKey);
  }, []);

  function handleLayout(event: LayoutChangeEvent) {
    const measured = event.nativeEvent.layout.width;
    setWidth((current) => (current === measured ? current : measured));
  }

  const at = `${fractionOf(bpm, bounds) * 100}%` as const;

  return (
    <View>
      <View
        ref={node}
        onLayout={handleLayout}
        role="slider"
        aria-label={`Tempo, ${unitLabel}`}
        aria-valuemin={bounds.min}
        aria-valuemax={bounds.max}
        aria-valuenow={bpm}
        focusable
        style={styles.strip}
        {...pan.panHandlers}
      >
        <View style={styles.rail} pointerEvents="none" />
        {marked !== null && marked >= bounds.min && marked <= bounds.max ? (
          <View
            pointerEvents="none"
            style={[styles.markedAt, { left: `${fractionOf(marked, bounds) * 100}%` }]}
          >
            <Text variant="caption" color="textTertiary" style={styles.markedLabel}>
              marked {marked}
            </Text>
            <View style={styles.markedTick} />
          </View>
        ) : null}
        <View style={[styles.fill, { width: at }]} pointerEvents="none" />
        <View style={[styles.thumb, { left: at }]} pointerEvents="none" />
      </View>
      <View style={styles.ends}>
        <Text variant="caption" color="textTertiary" style={styles.number}>
          {bounds.min}
        </Text>
        <Text variant="caption" color="textTertiary" style={styles.number}>
          {bounds.max}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    height: HEIGHT,
    justifyContent: 'center',
  },
  rail: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 15,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 15,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  thumb: {
    position: 'absolute',
    top: (HEIGHT - THUMB) / 2,
    width: THUMB,
    height: THUMB,
    marginLeft: -THUMB / 2,
    borderRadius: THUMB / 2,
    backgroundColor: colors.surface,
    borderWidth: BORDER_WIDTH * 2,
    borderColor: colors.accent,
  },
  // The tick and its label, centred on the marked tempo and standing above the
  // rail so the thumb can pass over the tick without hiding the number.
  markedAt: {
    position: 'absolute',
    bottom: HEIGHT - 15,
    width: 80,
    marginLeft: -40,
    alignItems: 'center',
  },
  markedLabel: {
    fontSize: 11,
    lineHeight: 14,
    marginBottom: 4,
  },
  markedTick: {
    width: BORDER_WIDTH,
    height: 12,
    marginBottom: -8,
    backgroundColor: colors.textTertiary,
  },
  ends: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  number: {
    fontVariant: ['tabular-nums'],
  },
});

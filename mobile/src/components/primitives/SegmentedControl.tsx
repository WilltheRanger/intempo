import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import {
  BORDER_WIDTH,
  colors,
  fontFamily,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
} from '../../design';
import { Text } from './Text';

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Names the group for screen readers, e.g. "Score view". */
  label: string;
  /**
   * What choosing does, which decides how it is announced.
   *
   * `views` — flips between views of the same thing in place: tabs. The
   * score's notation and original pages; the result's tempo and pitch.
   *
   * `setting` — sets something, with nothing shown or hidden: a radio group.
   * Profile's metronome was tabs, so a screen reader announced four tabs and
   * no panel for any of them (2026-10-06).
   */
  kind?: 'views' | 'setting';
  style?: StyleProp<ViewStyle>;
}

/**
 * Two or three mutually exclusive views of the same thing.
 *
 * Used where the point is comparison — flipping between them in place, so what
 * differs is the content and not its position on screen.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  kind = 'views',
  style,
}: SegmentedControlProps<T>) {
  const setting = kind === 'setting';
  return (
    <View
      style={[styles.track, style]}
      accessibilityRole={setting ? 'radiogroup' : 'tablist'}
      accessibilityLabel={label}
    >
      <View pointerEvents="none" style={styles.well} />
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole={setting ? 'radio' : 'tab'}
            accessibilityState={setting ? { checked: selected } : { selected }}
            // **react-native-web does not derive these from
            // `accessibilityState`.** Without it a screen reader announces
            // "Notation, tab" and "Original, tab" and never which one is
            // showing — and selection here is carried by a fill, so that is
            // the only signal there was. A tab is selected; a radio is checked.
            aria-selected={setting ? undefined : selected}
            aria-checked={setting ? selected : undefined}
            accessibilityLabel={option.label}
            style={styles.segment}
          >
            {({ pressed }) => (
              // The tile holds the label rather than lying under it: on the
              // web a positioned layer paints over its unpositioned siblings
              // whatever their order, so a tile drawn beside the words would
              // cover them.
              <View
                style={[
                  styles.tile,
                  selected && styles.tileSelected,
                  pressed && !selected && styles.tilePressed,
                ]}
              >
                <Text
                  variant="metadata"
                  color={selected ? 'textPrimary' : 'textSecondary'}
                  style={selected ? styles.labelSelected : styles.label}
                >
                  {option.label}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/** The well's padding around its tiles. */
const TRACK_INSET = 3;

/**
 * How tall the well is drawn: the redesign's 34 (`redesign/Profile.dc.html`).
 *
 * **Drawn at 34 inside a 44pt box, where it was drawn at 52** (2026-11-18).
 * "The design draws 34; the finger needs 44, and the finger wins" was right
 * about the finger and needlessly conceded the drawing: each option became a
 * 44pt tile, and the well round them came out 52pt — a full-width box under
 * the result's headline, heavier than the finding beneath it, for a control
 * that only switches between two views (the ui-forge-kit review). The finger
 * keeps its 44: each option is still a 44pt box, measured as one, and only
 * the well and the chosen tile are drawn smaller, centred inside it.
 */
const WELL_HEIGHT = 34;
/** The space above and below the drawn well, inside the 44pt box. */
const WELL_OUTSET = (MIN_TOUCH_TARGET - WELL_HEIGHT) / 2;
/** A chosen option's tile: the well, less its edge and inset on each side. */
const TILE_HEIGHT = WELL_HEIGHT - 2 * (BORDER_WIDTH + TRACK_INSET);

const styles = StyleSheet.create({
  /**
   * The redesign's track: a sunken well with a hairline edge, and the chosen
   * option a white tile inside it with no border of its own — the fill and
   * the weight say which one, not a box.
   */
  track: {
    flexDirection: 'row',
    // The well's edge and inset, so the options' tiles sit where they did.
    paddingHorizontal: BORDER_WIDTH + TRACK_INSET,
    gap: spacing['2xs'],
  },
  well: {
    position: 'absolute',
    top: WELL_OUTSET,
    bottom: WELL_OUTSET,
    left: 0,
    right: 0,
    backgroundColor: colors.surfacePressed,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    borderRadius: radii.md,
  },
  segment: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  tile: {
    height: TILE_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    // Concentric with the well it sits in (`radii.ts`).
    borderRadius: radii.md - TRACK_INSET,
  },
  tileSelected: {
    backgroundColor: colors.surface,
  },
  tilePressed: {
    backgroundColor: colors.border,
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
  },
  labelSelected: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.sansMedium,
  },
});

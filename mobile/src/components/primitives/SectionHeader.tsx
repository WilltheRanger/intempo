import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { MIN_TOUCH_TARGET, spacing } from '../../design';
import { Text } from './Text';

export interface SectionHeaderProps {
  label: string;
  /** Optional trailing action, e.g. "See all". */
  actionLabel?: string;
  onActionPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * A quiet label above a group of content, optionally with one action.
 *
 * **Small, uppercase and letterspaced** — a different *register* from the
 * content beneath it, not a smaller heading. That separation is what lets one
 * screen carry several groups without their labels competing with the titles
 * inside them; before it, "Warmup" and "Long tones, then a G major scale" were
 * two headings a reader had to rank by size alone.
 *
 * This reverses the earlier "sentence case — the brief rules out decorative
 * uppercase labels" note. Uppercase here is not decoration: it is the only
 * thing distinguishing a label from a title at these sizes, and it is what iOS
 * itself uses for exactly this element. See `DECISIONS.md`, 2026-09-06.
 */
export function SectionHeader({
  label,
  actionLabel,
  onActionPress,
  style,
}: SectionHeaderProps) {
  return (
    <View style={[styles.container, style]}>
      <Text variant="eyebrow" color="textTertiary" style={styles.label}>
        {label.toUpperCase()}
      </Text>

      {actionLabel && onActionPress ? (
        <Pressable
          onPress={onActionPress}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed }) => [
            styles.target,
            pressed ? styles.pressed : undefined,
          ]}
        >
          <Text variant="sectionAction" color="textPrimary">
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}


const styles = StyleSheet.create({
  /**
   * Padded to a real touch target, not `hitSlop`-ed to one.
   *
   * **`hitSlop` does nothing on the web build.** Measured in Chromium: a click
   * 8pt above such a control — well inside a 12pt slop — did not activate it,
   * while a click on the visible 18pt box did. `PlaybackSettings` reached the
   * same conclusion from the other direction: "a hit area nothing can see is a
   * hit area nothing checks."
   */
  target: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  pressed: {
    opacity: 0.6,
  },
  /*
    Uppercased in render rather than by `textTransform`, so a screen reader is
    handed the label as written. VoiceOver spells out some short all-caps
    strings character by character when the transform is visual only, and every
    label here is short.
  */
  label: {
    flexShrink: 1,
  },
});

import { Search, X } from 'lucide-react-native';
import { useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {
  BORDER_WIDTH,
  colors,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../../design';

/**
 * react-native-web renders TextInput as a DOM input, which draws the browser's
 * own focus ring inside our container. The container carries the focus
 * treatment, so suppress the inner one. No-op on native, where TextInput draws
 * no outline of its own.
 */
const NO_INNER_OUTLINE = Platform.select({
  web: { outlineStyle: 'none', outlineWidth: 0 },
  default: {},
}) as TextStyle;

export interface SearchFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Search input. Same surface, border, and radius as a card, so it belongs to
 * the same family rather than reading as a control bolted on top.
 *
 * Focus is tracked in state because React Native has no `:focus` — the border
 * darkens rather than gaining a ring, which would mean a shadow.
 */
export function SearchField({
  value,
  onChangeText,
  placeholder = 'Search',
  style,
}: SearchFieldProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.field, focused && styles.focused, style]}>
      <Search
        size={ICON_SIZE.md}
        strokeWidth={ICON_STROKE_WIDTH}
        color={colors.textTertiary}
      />

      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        // Android draws its own underline under TextInput; the container's
        // border is the only edge this field should have.
        underlineColorAndroid="transparent"
        style={[styles.input, NO_INNER_OUTLINE]}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        clearButtonMode="never"
        accessibilityLabel={placeholder}
      />

      {value.length > 0 ? (
        <Pressable
          onPress={() => onChangeText('')}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={spacing.md}
        >
          <X
            size={ICON_SIZE.md}
            strokeWidth={ICON_STROKE_WIDTH}
            color={colors.textTertiary}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    // Shorter than a button — a field this size still taps comfortably, and
    // it sits at the minimum target rather than below it.
    height: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
  },
  focused: {
    // The whole container takes the accent on focus — the one place the gold
    // marks state rather than an action.
    borderColor: colors.accent,
  },
  input: {
    flex: 1,
    // **Full height, so the target is the field and not the text.** The
    // container is `MIN_TOUCH_TARGET` tall; the input inside it measured 24pt,
    // so half the row looked tappable and was not.
    alignSelf: 'stretch',
    ...typography.body,
    color: colors.textPrimary,
    // Android centres poorly without this; iOS ignores it.
    paddingVertical: 0,
  },
});

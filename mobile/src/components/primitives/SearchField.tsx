import { Search, X } from 'lucide-react-native';
import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  BORDER_WIDTH,
  colors,
  CONTROL_HEIGHT,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  radii,
  spacing,
  typography,
} from '../../design';

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
        style={styles.input}
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
    height: CONTROL_HEIGHT,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
  },
  focused: {
    borderColor: colors.borderStrong,
  },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.textPrimary,
    // Android centres poorly without this; iOS ignores it.
    paddingVertical: 0,
  },
});

import { useState } from 'react';
import {
  Platform,
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
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../../design';
import { Text } from './Text';

/**
 * react-native-web renders TextInput as a DOM input, which draws the browser's
 * own focus ring inside our border. The field carries the focus treatment, so
 * suppress the inner one. No-op on native.
 */
const NO_INNER_OUTLINE = Platform.select({
  web: { outlineStyle: 'none', outlineWidth: 0 },
  default: {},
}) as TextStyle;

export interface InputProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  /** Serif, for a composition title. Sans for everything else. */
  serif?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * A labelled single-line text field.
 *
 * Same surface, border, and radius as a card, and it takes the accent on focus
 * — the same treatment as search, so a field reads as a field wherever it is.
 */
export function Input({
  label,
  value,
  onChangeText,
  placeholder,
  serif = false,
  style,
}: InputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={style}>
      <Text variant="sectionLabel" color="textSecondary" style={styles.label}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        underlineColorAndroid="transparent"
        accessibilityLabel={label}
        style={[
          styles.field,
          serif ? styles.serifText : styles.sansText,
          focused && styles.focused,
          NO_INNER_OUTLINE,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    marginBottom: spacing.sm,
  },
  field: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    color: colors.textPrimary,
  },
  sansText: {
    ...typography.body,
  },
  serifText: {
    ...typography.pieceTitle,
  },
  focused: {
    borderColor: colors.accent,
  },
});

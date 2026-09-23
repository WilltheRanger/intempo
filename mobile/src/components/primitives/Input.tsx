import { useState, type ReactNode } from 'react';
import {
  Platform,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {
  BORDER_WIDTH,
  colors,
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
  /**
   * Small control on the label's right — a "Show" for a password, say. Keep it
   * to a word; the label leads.
   */
  action?: ReactNode;
  /**
   * Keyboard and autofill behaviour. Passed straight through, because an email
   * field that autocapitalises or a password field the keychain can't see is
   * broken in a way no amount of styling fixes.
   */
  secureTextEntry?: boolean;
  keyboardType?: TextInputProps['keyboardType'];
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoComplete?: TextInputProps['autoComplete'];
  textContentType?: TextInputProps['textContentType'];
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: TextInputProps['onSubmitEditing'];
  /**
   * Focus and blur, passed straight through.
   *
   * Added for `ComposerField`, which shows its suggestions only while the
   * field has focus — a list that stays after you have tapped away is a list
   * that will not go away.
   */
  onFocus?: TextInputProps['onFocus'];
  onBlur?: TextInputProps['onBlur'];
  editable?: boolean;
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
  action,
  secureTextEntry = false,
  keyboardType,
  autoCapitalize,
  autoComplete,
  textContentType,
  returnKeyType,
  onSubmitEditing,
  onFocus,
  onBlur,
  editable = true,
  style,
}: InputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={style}>
      <View style={styles.labelRow}>
        {/*
          The redesign's field label (`redesign/NamePiece.dc.html`,
          `SignIn.dc.html`): small, uppercase, tertiary — a name for the box
          rather than a heading over it, so the eye goes to what is typed.
        */}
        <Text variant="caption" color="textTertiary" style={styles.label}>
          {label}
        </Text>
        {action}
      </View>

      <TextInput
        value={value}
        onChangeText={onChangeText}
        // **Composed, not replaced.** This field draws its own focus ring, so
        // a caller's `onFocus` has to run alongside it rather than instead of
        // it — handing the prop straight to `TextInput` silently removed the
        // ring from every field that used one.
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        underlineColorAndroid="transparent"
        accessibilityLabel={label}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        textContentType={textContentType}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        editable={editable}
        style={[
          styles.field,
          serif ? styles.serifText : styles.sansText,
          focused && styles.focused,
          !editable && styles.disabled,
          NO_INNER_OUTLINE,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 7,
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  field: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    color: colors.textPrimary,
  },
  sansText: {
    ...typography.body,
    fontSize: 17,
  },
  serifText: {
    ...typography.pieceTitle,
    fontSize: 17,
  },
  focused: {
    borderColor: colors.accent,
  },
  disabled: {
    color: colors.textTertiary,
  },
});

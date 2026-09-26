import { useRef, useState, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text as NativeText,
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
import { acceptsCompletion } from '../../lib/autofill';
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

/**
 * On the web, a press on the suggestion must not take focus from the field.
 *
 * A mousedown moves focus to whatever was pressed, the field blurs, and the
 * suggestion — drawn only while the field has focus — unmounts under the
 * finger. That is exactly how the composer list this replaces once did
 * nothing at all (`ComposerField`, 2026-09). Cancelling the mousedown keeps
 * focus where the typing is. Native has no such event, and needs none.
 */
const KEEP_FOCUS = (
  Platform.OS === 'web'
    ? { onMouseDown: (event: { preventDefault(): void }) => event.preventDefault() }
    : {}
) as object;

/**
 * Spaces that measure as spaces. A browser drops a trailing space from a line
 * of text, so "Ludwig " would measure as "Ludwig" and the suggestion would
 * start on top of the space the musician just typed.
 */
const measured = (text: string) => text.replace(/ /g, '\u00a0');

export interface InputProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  /** Serif, for a composition title. Sans for everything else. */
  serif?: boolean;
  /**
   * The one field that is a whole screen's question — onboarding's name
   * (`redesign/OnboardName.dc.html`): taller, and the type at 21.
   */
  large?: boolean;
  /**
   * Draws `action` inside the field at its right edge instead of beside the
   * label — the redesign's password "Show" (`redesign/SignIn.dc.html`).
   */
  actionInside?: boolean;
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
   * Focus and blur, passed straight through — composed with the field's own
   * focus ring and its suggestion, which is drawn only while it has focus.
   */
  onFocus?: TextInputProps['onFocus'];
  onBlur?: TextInputProps['onBlur'];
  editable?: boolean;
  style?: StyleProp<ViewStyle>;
  /**
   * Says "(optional)" beside the label — the owner, 2026-09-26: on the
   * add-a-piece screens, everything but the title.
   */
  optional?: boolean;
  /**
   * The rest of a suggestion, drawn in grey straight after what is typed
   * (`lib/autofill.ts`). Accepted by a tap on it, Return, Tab, or → at the
   * end of the text; any other key carries on typing.
   */
  completion?: string | null;
  /** Called when the suggestion is accepted. The caller sets the value. */
  onAcceptCompletion?: () => void;
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
  large = false,
  actionInside = false,
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
  optional = false,
  completion = null,
  onAcceptCompletion,
}: InputProps) {
  const [focused, setFocused] = useState(false);
  const input = useRef<TextInput>(null);
  // Where the cursor is, so → accepts only from the end of the text.
  const [cursor, setCursor] = useState<number | null>(null);
  // How wide what is typed is, and how wide the box is: the suggestion starts
  // where the text ends, and is not drawn when there is no room for it.
  const [typedWidth, setTypedWidth] = useState<number | null>(null);
  const [boxWidth, setBoxWidth] = useState(0);

  // Only while typing here: grey text in a field you have left reads as
  // something you wrote.
  const offering = Boolean(completion) && focused && editable;
  const textStyle = [
    serif ? styles.serifText : styles.sansText,
    large && styles.largeText,
  ];
  const insetLeft = BORDER_WIDTH + (large ? spacing.lg : FIELD_PADDING);
  const insetRight =
    BORDER_WIDTH + (actionInside && action ? ACTION_ROOM : large ? spacing.lg : FIELD_PADDING);
  const ghostLeft = typedWidth === null ? null : insetLeft + typedWidth;
  const hasRoom = ghostLeft !== null && boxWidth - insetRight - ghostLeft >= MIN_GHOST_ROOM;

  function accept() {
    if (!completion) return;
    onAcceptCompletion?.();
    // Keep the keyboard where it is. Deferred so it lands after a browser has
    // finished handling the press, if it moved focus anyway.
    setTimeout(() => input.current?.focus(), 0);
  }

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
          {/* Lower case, so it reads as a note on the name rather than part of it. */}
          {/* A plain nested text, so it inherits the label's size and colour. */}
          {optional ? <NativeText style={styles.optional}> (optional)</NativeText> : null}
        </Text>
        {actionInside ? null : action}
      </View>

      <View onLayout={(event) => setBoxWidth(event.nativeEvent.layout.width)}>
        <TextInput
          ref={input}
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
          accessibilityLabel={optional ? `${label}, optional` : label}
          accessibilityHint={offering ? `Suggests ${value}${completion}. Press return to accept.` : undefined}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          textContentType={textContentType}
          returnKeyType={returnKeyType}
          // **Return accepts first, then does what it always did.** While a
          // suggestion is showing, the field keeps focus on Return and takes
          // the suggestion; with none, Return is the caller's.
          onSubmitEditing={(event) => {
            if (offering) {
              accept();
              return;
            }
            onSubmitEditing?.(event);
          }}
          submitBehavior={offering ? 'submit' : undefined}
          blurOnSubmit={offering ? false : undefined}
          onKeyPress={(event) => {
            const atEnd = cursor === null || cursor >= value.length;
            if (offering && acceptsCompletion(event.nativeEvent.key, atEnd)) {
              // Tab would otherwise move focus to the next field.
              (event as unknown as { preventDefault?: () => void }).preventDefault?.();
              accept();
            }
          }}
          onSelectionChange={(event) => setCursor(event.nativeEvent.selection.end)}
          editable={editable}
          style={[
            styles.field,
            ...textStyle,
            large && styles.large,
            actionInside && action ? styles.roomForAction : null,
            focused && styles.focused,
            !editable && styles.disabled,
            NO_INNER_OUTLINE,
          ]}
        />
        {offering ? (
          <View pointerEvents="box-none" style={styles.ghostLayer}>
            {/* What is typed, invisible, to find where it ends. */}
            <NativeText
              numberOfLines={1}
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              onLayout={(event) => setTypedWidth(event.nativeEvent.layout.width)}
              style={[...textStyle, styles.measure, { left: insetLeft }]}
            >
              {measured(value)}
            </NativeText>
            {hasRoom ? (
              <View {...KEEP_FOCUS} style={[styles.ghost, { left: ghostLeft, right: insetRight }]}>
                {/*
                  Accepted on the press going down, not up: a finger that
                  lands on it has chosen it, and nothing can take the
                  suggestion away between the two.
                */}
                <Pressable
                  onPressIn={accept}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${value}${completion}`}
                  style={styles.ghostPress}
                >
                  <NativeText numberOfLines={1} style={[...textStyle, styles.ghostText]}>
                    {measured(completion ?? '')}
                  </NativeText>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}
        {actionInside && action ? <View style={styles.insideAction}>{action}</View> : null}
      </View>
    </View>
  );
}

/** The field's own horizontal padding, which the suggestion lines up with. */
const FIELD_PADDING = 14;
/** Room kept on the right for an action drawn inside the field. */
const ACTION_ROOM = 64;
/** Narrower than this and the suggestion is not worth drawing. */
const MIN_GHOST_ROOM = 12;

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
  optional: {
    textTransform: 'none',
    letterSpacing: 0,
  },
  field: {
    minHeight: 48,
    paddingHorizontal: FIELD_PADDING,
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
  large: {
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    borderRadius: 14,
  },
  largeText: {
    fontSize: 21,
    lineHeight: 26,
  },
  roomForAction: {
    paddingRight: ACTION_ROOM,
  },
  ghostLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
  measure: {
    position: 'absolute',
    top: 0,
    opacity: 0,
  },
  ghost: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
  ghostPress: {
    flex: 1,
    justifyContent: 'center',
  },
  ghostText: {
    color: colors.textTertiary,
  },
  insideAction: {
    position: 'absolute',
    right: 2,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  focused: {
    borderColor: colors.accent,
  },
  disabled: {
    color: colors.textTertiary,
  },
});

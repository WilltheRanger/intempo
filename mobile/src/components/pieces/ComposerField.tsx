import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BORDER_WIDTH, colors, radii, spacing } from '../../design';
import { canonical, searchComposers, type Composer } from '../../lib/composers';
import { Input } from '../primitives/Input';
import { Text } from '../primitives/Text';

export interface ComposerFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  style?: import('react-native').StyleProp<import('react-native').ViewStyle>;
}

/**
 * A composer's name, with the repertoire offered as you type.
 *
 * **Suggestions, not a picker.** This is a text field that helps, and the
 * distinction is the whole design: a musician working on a living composer, a
 * teacher's own exercises, or a name spelled the way their edition spells it
 * must be able to type it and be left alone. Nothing here rejects, corrects,
 * or requires a selection — the list disappears the moment what is typed
 * already names someone it knows.
 *
 * What it buys is worth having anyway: one spelling for a library that groups
 * by composer (four ways of writing Bach are otherwise four rows and four
 * covers), fewer keystrokes for a name with an umlaut in it, and a cover
 * picture where a hand-entered piece has no photograph of a page.
 *
 * Rows rather than a modal, because the answer is usually one tap away and a
 * sheet that covers the form to offer three names is heavier than the problem.
 */
export function ComposerField({ value, onChangeText, style }: ComposerFieldProps) {
  const [focused, setFocused] = useState(false);

  // Nothing to offer once what is typed already names someone. Continuing to
  // show the row a musician has just chosen is a list that will not go away.
  const settled = canonical(value) !== null;
  const suggestions = focused && !settled ? searchComposers(value, 5) : [];

  return (
    <View style={style}>
      <Input
        label="Composer"
        value={value}
        onChangeText={onChangeText}
        placeholder="Optional"
        autoCapitalize="words"
        // Off: the field's own suggestions are the repertoire, and the
        // keyboard's are a person's contacts.
        autoComplete="off"
        returnKeyType="next"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />

      {suggestions.length > 0 ? (
        <View style={styles.list}>
          {suggestions.map((composer, index) => (
            <Suggestion
              key={composer.name}
              composer={composer}
              last={index === suggestions.length - 1}
              onPress={() => {
                onChangeText(composer.name);
                setFocused(false);
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Suggestion({
  composer,
  onPress,
  last,
}: {
  composer: Composer;
  onPress: () => void;
  last: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${composer.name}, ${composer.dates}`}
      style={({ pressed }) => [
        styles.row,
        !last && styles.ruled,
        pressed && styles.pressed,
      ]}
    >
      <Text variant="body" numberOfLines={1} style={styles.name}>
        {composer.name}
      </Text>
      {/* Dates, because two composers can share a surname and a musician
          reading a suggestion needs to know which one this is. */}
      <Text variant="metadataSmall" color="textTertiary">
        {composer.dates}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    borderRadius: radii.sm,
    // Suggestions attached to a field are the one thing that genuinely needs a
    // container: they are a layer over the form, and without an edge they read
    // as more fields.
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  ruled: {
    borderBottomWidth: BORDER_WIDTH,
    borderBottomColor: colors.border,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
  name: {
    flexShrink: 1,
  },
});

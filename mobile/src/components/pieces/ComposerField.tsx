import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BORDER_WIDTH, colors, radii, spacing } from '../../design';
import { canonical, searchComposers, type Composer } from '../../lib/composers';
import { Input } from '../primitives/Input';
import { Text } from '../primitives/Text';
import { rowDivided } from '../rowMetrics';

export interface ComposerFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  style?: import('react-native').StyleProp<import('react-native').ViewStyle>;
  /**
   * For a form where the composer is the last field before the button.
   *
   * Defaults to `next`, which is right wherever a Movement field follows.
   */
  returnKeyType?: 'next' | 'done';
  onSubmitEditing?: () => void;
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
export function ComposerField({
  value,
  onChangeText,
  style,
  returnKeyType = 'next',
  onSubmitEditing,
}: ComposerFieldProps) {
  /**
   * Whether the suggestions are on screen.
   *
   * **Not "is the field focused", which is what this was and why the whole
   * component did nothing.** Pressing a suggestion blurs the input, `focused`
   * went false, the row unmounted — and it unmounted *between the mousedown and
   * the mouseup*, so the press never completed and tapping "Ludwig van
   * Beethoven" left the field reading `bee`. Traced in Chromium with raw DOM
   * listeners: `row:pointerdown → row:mousedown → row:REMOVED`, and no press
   * handler ran at all.
   *
   * No guard fixes that from inside the press, because the press handler is
   * exactly what never runs; and no timer fixes it either, since a `setTimeout`
   * queued on the mousedown fires long before a real finger lifts. So the list
   * is not tied to focus. It opens when a name is being typed and closes on
   * the three things that mean the field is answered: a suggestion chosen, the
   * text already naming somebody, or nothing typed at all.
   */
  const [open, setOpen] = useState(false);

  // Nothing to offer once what is typed already names someone. Continuing to
  // show the row a musician has just chosen is a list that will not go away.
  const settled = canonical(value) !== null;
  const suggestions = open && !settled ? searchComposers(value, 5) : [];

  return (
    <View style={style}>
      <Input
        label="Composer"
        value={value}
        onChangeText={(next) => {
          // Typing is what opens it, and clearing the field closes it: an
          // empty query would otherwise offer the whole list under a blank
          // field.
          setOpen(next.trim().length > 0);
          onChangeText(next);
        }}
        placeholder="Optional"
        autoCapitalize="words"
        // Off: the field's own suggestions are the repertoire, and the
        // keyboard's are a person's contacts.
        autoComplete="off"
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        // Only when there is something to suggest *about*. On a blank field
        // this would drop five rows in the moment it is touched and push the
        // rest of the form down by them.
        onFocus={() => setOpen(value.trim().length > 0)}
      />

      {suggestions.length > 0 ? (
        <View style={styles.list}>
          {suggestions.map((composer, index) => (
            <Suggestion
              key={composer.name}
              composer={composer}
              divided={rowDivided(index)}
              onPress={() => {
                onChangeText(composer.name);
                setOpen(false);
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
  divided,
}: {
  composer: Composer;
  onPress: () => void;
  divided: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${composer.name}, ${composer.dates}`}
      style={({ pressed }) => [
        styles.row,
        divided && styles.ruled,
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
    /*
      **Denser than `ROW_PADDING_VERTICAL`, deliberately.** This list appears
      under a field somebody is typing into, above a keyboard, and every point
      of row height is a suggestion that does not fit on screen. A settings row
      is read; these are scanned and dismissed in a second.
    */
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  ruled: {
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
  name: {
    flexShrink: 1,
  },
});

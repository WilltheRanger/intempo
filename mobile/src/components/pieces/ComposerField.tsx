import type { StyleProp, ViewStyle } from 'react-native';

import { completeComposer } from '../../lib/autofill';
import { Input } from '../primitives/Input';

export interface ComposerFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  style?: StyleProp<ViewStyle>;
  /**
   * For a form where the composer is the last field before the button.
   *
   * Defaults to `next`, which is right wherever a Movement field follows.
   */
  returnKeyType?: 'next' | 'done';
  onSubmitEditing?: () => void;
}

/**
 * A composer's name, with the rest of it offered in grey as you type.
 *
 * **Inline, since 2026-09-26.** This drew up to five rows under the field,
 * with dates; the owner asked for a suggestion "in the typing bar kind of like
 * Google Docs" and chose it over keeping both. "Bee" shows *thoven* after what
 * was typed, and accepting it — a tap on it, Return, Tab — writes the name the
 * way the library spells it: "Ludwig van Beethoven". The rules are
 * `lib/autofill.ts`.
 *
 * **A suggestion, never a constraint**, which is the design this field always
 * had: a living composer, a teacher's own exercises, or a name spelled the way
 * an edition spells it is typed and kept exactly as typed. Nothing is changed
 * unless it is accepted.
 *
 * What the suggestion buys is what the list bought: one spelling for a library
 * that groups by composer, fewer keystrokes for a name with an accent in it,
 * and a cover picture for a piece entered by hand (`composers.ts`).
 *
 * Always "(optional)": there is no form in the app that needs a composer.
 */
export function ComposerField({
  value,
  onChangeText,
  style,
  returnKeyType = 'next',
  onSubmitEditing,
}: ComposerFieldProps) {
  const offer = completeComposer(value);
  return (
    <Input
      label="Composer"
      optional
      value={value}
      onChangeText={onChangeText}
      autoCapitalize="words"
      // Off: the field's own suggestion is the repertoire, and the keyboard's
      // are a person's contacts.
      autoComplete="off"
      returnKeyType={returnKeyType}
      onSubmitEditing={onSubmitEditing}
      completion={offer?.rest ?? null}
      onAcceptCompletion={() => {
        if (offer) onChangeText(offer.value);
      }}
      style={style}
    />
  );
}

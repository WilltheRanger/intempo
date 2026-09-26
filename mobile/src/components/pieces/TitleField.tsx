import { useMemo } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { useLibrary } from '../../data/hooks/usePieces';
import { completeTitle } from '../../lib/autofill';
import { Input } from '../primitives/Input';

export interface TitleFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  /** What the composer field holds: that composer's titles are offered first. */
  composer: string;
  /** Fills an empty composer field when a suggested title is accepted. */
  onComposerChange: (composer: string) => void;
  style?: StyleProp<ViewStyle>;
  returnKeyType?: 'next' | 'done';
  onSubmitEditing?: () => void;
}

/**
 * A piece's title, with the rest of one offered in grey as you type — the
 * owner's "recommendation in the typing bar kind of like Google Docs"
 * (2026-09-26).
 *
 * From the musician's own library first, then the built-in repertoire
 * (`lib/repertoire.ts`); the rules are `lib/autofill.ts`. Accepting "Cello
 * Su" → *ite No. 1 in G major, BWV 1007* also writes J. S. Bach into the
 * composer field, **only if that field is empty**: a composer the musician
 * typed is theirs.
 *
 * The one field on the add-a-piece screens that is not "(optional)".
 */
export function TitleField({
  value,
  onChangeText,
  composer,
  onComposerChange,
  style,
  returnKeyType = 'next',
  onSubmitEditing,
}: TitleFieldProps) {
  // Usually already cached: the Library tab asked for it. Until it answers,
  // the built-in list is offered on its own.
  const { data: library } = useLibrary();
  const known = useMemo(
    () => (library ?? []).map((piece) => ({ title: piece.title, composer: piece.composer })),
    [library],
  );
  const offer = completeTitle(value, known, composer);
  return (
    <Input
      label="Title"
      value={value}
      onChangeText={onChangeText}
      placeholder="Sonata No. 1 in G minor"
      serif
      autoCapitalize="words"
      // Off, so a browser's own list of past entries does not open over ours.
      autoComplete="off"
      returnKeyType={returnKeyType}
      onSubmitEditing={onSubmitEditing}
      completion={offer?.rest ?? null}
      onAcceptCompletion={() => {
        if (!offer) return;
        onChangeText(offer.value);
        if (!composer.trim() && offer.composer) onComposerChange(offer.composer);
      }}
      style={style}
    />
  );
}

import { useRef } from 'react';

import { afterReturn, returnKeyFor, type FieldHandle } from '../../lib/fieldOrder';

/**
 * Return-key props for the fields of one form, in order.
 *
 *     const field = useFieldOrder(3, save);
 *     <TitleField {...field(0)} … />
 *     <ComposerField {...field(1)} … />
 *     <Input {...field(2)} … />
 *
 * Every field but the last says "next" and moves on, keeping the keyboard up
 * while it does; the last says `last` and calls `finish`. The rules are
 * `lib/fieldOrder.ts`, with tests.
 */
export function useFieldOrder(count: number, finish: () => void, last: 'done' | 'go' = 'done') {
  const fields = useRef<(FieldHandle | null)[]>([]);
  return (index: number) => ({
    ref: (handle: FieldHandle | null) => {
      fields.current[index] = handle;
    },
    returnKeyType: returnKeyFor(index, count, last),
    keepFocusOnSubmit: index < count - 1,
    onSubmitEditing: () => afterReturn(index, fields.current, finish),
  });
}

/**
 * What Return does in a form: move to the next field, or finish.
 *
 * **Every "next" key in the app was a label and nothing else.** Forms set
 * `returnKeyType="next"`, which draws the word on the keyboard, and no field
 * moved focus on — so on a phone the key read "next" and closed the keyboard
 * (measured 2026-10-05: Return in Title on the manual add-a-piece form left
 * focus on `<body>`). `CLAUDE.md` §3: a drawn affordance does the thing it
 * depicts.
 */

/** A field that can be focused — `Input` hands one of these to its `ref`. */
export interface FieldHandle {
  focus(): void;
}

/** The key the keyboard draws for field `index` of `count`. */
export function returnKeyFor(
  index: number,
  count: number,
  last: 'done' | 'go',
): 'next' | 'done' | 'go' {
  return index < count - 1 ? 'next' : last;
}

/**
 * Return was pressed in field `index`: focus the next field that is on
 * screen, or finish the form if there is none.
 *
 * Skipping a missing field rather than stopping at it, because some are
 * conditional — a form with its password field hidden is a one-field form,
 * and Return in the email field should send it rather than do nothing.
 */
export function afterReturn(
  index: number,
  fields: readonly (FieldHandle | null | undefined)[],
  finish: () => void,
): void {
  for (let next = index + 1; next < fields.length; next += 1) {
    const field = fields[next];
    if (field) {
      field.focus();
      return;
    }
  }
  finish();
}

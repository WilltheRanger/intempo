/**
 * Which elements Space and Enter should press, on the web, where
 * react-native-web's own press responder does not.
 *
 * **Space presses only buttons.** The responder accepts Enter on anything but
 * Space only on `role="button"` or a real `<button>` — so every control here
 * drawn as a switch, a radio or a tab answered Enter and ignored the key the
 * ARIA patterns give it: Space toggles a switch and a checkbox, selects a
 * radio and an option, activates a tab. Measured 2026-10-05 on Profile's
 * "Haptic feedback": Space did nothing, Enter and a tap toggled it. Fourteen
 * controls in the app carry those roles.
 *
 * **Enter presses no link.** The responder counts `role="link"` as a native
 * link and leaves Enter to the browser, which follows an `<a href>` and does
 * nothing at all for anything else — and a `Pressable` with the link role is
 * a `<div>`. Measured 2026-10-05: "Back to library", focused, ignored Enter,
 * on every one of the eleven screens with a back link, and so did the Terms
 * and Privacy links under sign-up. A click or a tap worked.
 *
 * A native form control already does its own thing with Space, a real `<a>`
 * already follows itself on Enter, and a disabled control should do nothing;
 * all three are left alone.
 */
const SPACE_ROLES = new Set(['switch', 'checkbox', 'radio', 'tab', 'option', 'menuitemradio', 'menuitemcheckbox']);
const NATIVE = new Set(['INPUT', 'BUTTON', 'TEXTAREA', 'SELECT']);

/** The part of an element this reads. */
export interface RoleBearer {
  tagName: string;
  getAttribute(name: string): string | null;
}

const enabled = (element: RoleBearer) => element.getAttribute('aria-disabled') !== 'true';

export function activatesOnSpace(element: RoleBearer): boolean {
  const role = element.getAttribute('role');
  return (
    role !== null &&
    SPACE_ROLES.has(role) &&
    !NATIVE.has(element.tagName.toUpperCase()) &&
    enabled(element)
  );
}

export function activatesOnEnter(element: RoleBearer): boolean {
  return (
    element.getAttribute('role') === 'link' &&
    element.tagName.toUpperCase() !== 'A' &&
    enabled(element)
  );
}

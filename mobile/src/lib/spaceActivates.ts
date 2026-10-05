/**
 * Which elements Space should press, on the web.
 *
 * **react-native-web presses only buttons with Space.** Its press responder
 * accepts Enter on anything but Space only on `role="button"` or a real
 * `<button>` — so every control here drawn as a switch, a radio or a tab
 * answered Enter and ignored the key the ARIA patterns give it: Space toggles
 * a switch and a checkbox, selects a radio and an option, activates a tab.
 * Measured 2026-10-05 on Profile's "Haptic feedback": Space did nothing, Enter
 * and a tap toggled it. Fourteen controls in the app carry those roles.
 *
 * A native form control already does its own thing with Space, and a disabled
 * one should do nothing; both are left alone.
 */
const SPACE_ROLES = new Set(['switch', 'checkbox', 'radio', 'tab', 'option', 'menuitemradio', 'menuitemcheckbox']);
const NATIVE = new Set(['INPUT', 'BUTTON', 'TEXTAREA', 'SELECT']);

/** The part of an element this reads. */
export interface RoleBearer {
  tagName: string;
  getAttribute(name: string): string | null;
}

export function activatesOnSpace(element: RoleBearer): boolean {
  const role = element.getAttribute('role');
  return (
    role !== null &&
    SPACE_ROLES.has(role) &&
    !NATIVE.has(element.tagName.toUpperCase()) &&
    element.getAttribute('aria-disabled') !== 'true'
  );
}

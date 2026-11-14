import type { CSSProperties, MouseEvent } from 'react';

import { usePreferences } from '../../data/preferences';
import { hapticEnvironment, tapsCarrySwitch } from '../../lib/hapticsSupport';

/** Decided once: the browser does not change under the page. */
const ON_THIS_DEVICE = (() => {
  const environment = hapticEnvironment();
  return environment !== null && tapsCarrySwitch(environment);
})();

/** The switch attribute, which React's input types do not know about. */
const SWITCH = { switch: '' } as Record<string, string>;

/**
 * A hidden switch under the finger: how a tap on an iPhone makes the phone
 * tap back (`lib/hapticsSupport.ts`).
 *
 * Put it inside a control that asks for a haptic, as its last child. It lays
 * a transparent label over the control, wired to a hidden `<input
 * type="checkbox" switch>`. The finger's own tap lands on the label, and the
 * browser hands that trusted tap to the switch, which is the one thing Safari
 * plays a haptic for. The tap still reaches the control: the label's click
 * bubbles to it as any click would. The switch's own click, which follows,
 * is stopped where it starts, so the control is pressed once.
 *
 * Drawn only on a touch screen whose browser has the switch and no vibration
 * API — Safari on an iPhone — and only while haptics are on in Profile.
 * Invisible, unfocusable and out of the accessibility tree.
 */
export function HapticTap() {
  const { haptics } = usePreferences();
  if (!ON_THIS_DEVICE || !haptics) {
    return null;
  }
  return (
    <label aria-hidden="true" style={COVER}>
      <input
        type="checkbox"
        {...SWITCH}
        tabIndex={-1}
        aria-hidden="true"
        style={HIDDEN}
        onClick={(event: MouseEvent<HTMLInputElement>) => event.stopPropagation()}
      />
    </label>
  );
}

const COVER: CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  zIndex: 1,
  cursor: 'inherit',
  WebkitTapHighlightColor: 'transparent',
};

const HIDDEN: CSSProperties = {
  display: 'none',
};

import { activatesOnEnter, activatesOnSpace } from './keyActivation';

/**
 * Make Space press switches, radios and tabs, as it presses buttons, and make
 * Enter follow a link that is not an `<a>`.
 *
 * Space: down stops the page scrolling; up clicks, which is when a native
 * button acts too. Enter: down clicks, which is when a native link follows
 * itself, and a held key does not follow it again. A click is what
 * react-native-web's press responder turns into `onPress`.
 *
 * **Enter is caught on the way down, not the way up.** The responder stops a
 * keydown it accepts from bubbling past the app's root, and it accepts Enter
 * on a link — it only declines to act on it — so a listener on the document
 * in the usual phase never hears the key. The rules for which elements are
 * in `keyActivation.ts`. Returns the cleanup, for an effect.
 */
export function installKeyActivation(): () => void {
  let pressed: Element | null = null;
  const isSpace = (event: KeyboardEvent) => event.key === ' ' || event.key === 'Spacebar';

  const down = (event: KeyboardEvent) => {
    const target = event.target;
    if (!isSpace(event) || !(target instanceof HTMLElement) || !activatesOnSpace(target)) return;
    event.preventDefault();
    pressed = target;
  };
  const up = (event: KeyboardEvent) => {
    const target = event.target;
    if (!isSpace(event) || pressed === null || target !== pressed) return;
    pressed = null;
    event.preventDefault();
    (target as HTMLElement).click();
  };
  const enter = (event: KeyboardEvent) => {
    const target = event.target;
    if (event.key !== 'Enter' || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!(target instanceof HTMLElement) || !activatesOnEnter(target)) return;
    target.click();
  };

  document.addEventListener('keydown', down);
  document.addEventListener('keyup', up);
  document.addEventListener('keydown', enter, true);
  return () => {
    document.removeEventListener('keydown', down);
    document.removeEventListener('keyup', up);
    document.removeEventListener('keydown', enter, true);
  };
}

import { activatesOnSpace } from './spaceActivates';

/**
 * Make Space press switches, radios and tabs, as it presses buttons.
 *
 * Down stops the page scrolling; up clicks, which is when a native button
 * acts too — and a click is what react-native-web's press responder turns
 * into `onPress`. The rule for which elements is `spaceActivates.ts`.
 * Returns the cleanup, for an effect.
 */
export function installSpaceActivation(): () => void {
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

  document.addEventListener('keydown', down);
  document.addEventListener('keyup', up);
  return () => {
    document.removeEventListener('keydown', down);
    document.removeEventListener('keyup', up);
  };
}

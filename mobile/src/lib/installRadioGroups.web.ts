import { radioAfter, radioStep, radioTabStop, type RadioState } from './radioGroup';

/**
 * Give each group of radios one Tab stop and the arrow keys; the rule is
 * `radioGroup.ts`.
 *
 * The Tab stop is kept by rewriting tab indexes whenever a radio is added,
 * chosen, disabled or given a tab index of its own — react-native-web sets
 * `tabindex="0"` on every pressable, and sets it again when one is re-enabled.
 * Writing one sets off the observer once more, and that pass finds nothing to
 * change. Returns the cleanup, for an effect.
 */
const GROUP = '[role="radiogroup"]';

function radiosOf(group: Element): HTMLElement[] {
  return [...group.querySelectorAll<HTMLElement>('[role="radio"]')].filter(
    (radio) => radio.closest(GROUP) === group,
  );
}

function stateOf(radio: HTMLElement): RadioState {
  return {
    checked: radio.getAttribute('aria-checked') === 'true',
    enabled: radio.getAttribute('aria-disabled') !== 'true' && (radio.checkVisibility?.() ?? true),
  };
}

function settle() {
  for (const group of document.querySelectorAll(GROUP)) {
    const radios = radiosOf(group);
    const stop = radioTabStop(radios.map(stateOf));
    radios.forEach((radio, index) => {
      const wanted = index === stop ? '0' : '-1';
      if (radio.getAttribute('tabindex') !== wanted) radio.setAttribute('tabindex', wanted);
    });
  }
}

export function installRadioGroups(): () => void {
  const move = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const step = radioStep(event.key);
    const target = event.target;
    if (step === null || !(target instanceof HTMLElement) || target.getAttribute('role') !== 'radio') return;
    const group = target.closest(GROUP);
    if (group === null) return;
    const radios = radiosOf(group);
    const next = radioAfter(radios.map(stateOf), radios.indexOf(target), step);
    // Kept from scrolling the page or the score even when there is nowhere
    // to go: the key belongs to the group while focus is in it.
    event.preventDefault();
    if (next >= 0 && radios[next] !== target) radios[next].focus();
  };

  const observer = new MutationObserver(settle);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['role', 'aria-checked', 'aria-disabled', 'tabindex'],
  });
  settle();
  document.addEventListener('keydown', move, true);
  return () => {
    observer.disconnect();
    document.removeEventListener('keydown', move, true);
  };
}

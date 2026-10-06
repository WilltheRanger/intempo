import { rovingAfter, rovingStep, rovingTabStop, type RovingGroup, type RovingItem } from './rovingFocus';

/**
 * Give each radio group and tab list one Tab stop and the arrow keys; the rule
 * is `rovingFocus.ts`.
 *
 * The Tab stop is kept by rewriting tab indexes whenever an item is added,
 * chosen, disabled or given a tab index of its own — react-native-web sets
 * `tabindex="0"` on every pressable, and sets it again when one is re-enabled.
 * Writing one sets off the observer once more, and that pass finds nothing to
 * change. Returns the cleanup, for an effect.
 */
const KINDS: Record<RovingGroup, { item: string; chosen: string }> = {
  radiogroup: { item: 'radio', chosen: 'aria-checked' },
  tablist: { item: 'tab', chosen: 'aria-selected' },
};
const GROUPS = '[role="radiogroup"], [role="tablist"]';

function itemsOf(group: Element, kind: RovingGroup): HTMLElement[] {
  return [...group.querySelectorAll<HTMLElement>(`[role="${KINDS[kind].item}"]`)].filter(
    (item) => item.closest(GROUPS) === group,
  );
}

function stateOf(item: HTMLElement, kind: RovingGroup): RovingItem {
  return {
    chosen: item.getAttribute(KINDS[kind].chosen) === 'true',
    enabled: item.getAttribute('aria-disabled') !== 'true' && (item.checkVisibility?.() ?? true),
  };
}

function settle() {
  for (const group of document.querySelectorAll(GROUPS)) {
    const kind = group.getAttribute('role') as RovingGroup;
    const items = itemsOf(group, kind);
    const stop = rovingTabStop(items.map((item) => stateOf(item, kind)));
    items.forEach((item, index) => {
      const wanted = index === stop ? '0' : '-1';
      if (item.getAttribute('tabindex') !== wanted) item.setAttribute('tabindex', wanted);
    });
  }
}

export function installRovingFocus(): () => void {
  const move = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const group = target.closest(GROUPS);
    if (group === null) return;
    const kind = group.getAttribute('role') as RovingGroup;
    if (target.getAttribute('role') !== KINDS[kind].item) return;
    const step = rovingStep(event.key, kind);
    if (step === null) return;
    const items = itemsOf(group, kind);
    const next = rovingAfter(items.map((item) => stateOf(item, kind)), items.indexOf(target), step);
    // Kept from scrolling the page or the score even when there is nowhere
    // to go: the key belongs to the group while focus is in it.
    event.preventDefault();
    if (next >= 0 && items[next] !== target) items[next].focus();
  };

  const observer = new MutationObserver(settle);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['role', 'aria-checked', 'aria-selected', 'aria-disabled', 'tabindex'],
  });
  settle();
  document.addEventListener('keydown', move, true);
  return () => {
    observer.disconnect();
    document.removeEventListener('keydown', move, true);
  };
}

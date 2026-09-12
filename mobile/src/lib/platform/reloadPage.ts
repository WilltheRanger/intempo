/**
 * Reload the document, where there is one.
 *
 * **The one recovery a web build can perform on its own.** Every other answer
 * to a refused microphone lives in browser chrome — site permissions behind
 * the address bar, Settings on a phone — which is why `permission.ts` returns
 * `canOpenSettings: false` on web and the screen draws no button there. A
 * reload is different: the page has always been able to do it, and nothing
 * ever asked it to.
 *
 * That gap is what shipped. `InvalidStateError` from `getUserMedia` means the
 * document is not fully active, the screen said so correctly, and then told a
 * musician to "pull down to refresh" on a screen with no scroll view, inside a
 * home-screen app with no address bar. Both routes it named were absent; this
 * one was present the whole time.
 *
 * **No `Platform.OS`, and that is not a style preference.** Importing
 * `react-native` here made `reloadPage.test.ts` fail to collect at all —
 * "Parse failure … react-native/index.js", reported as *no tests* rather than
 * as a failure, which is the same trap `takeFailure.ts` records for `ApiError`
 * and the reason it reads a status off the shape instead. So this asks the
 * environment what it can do rather than which platform it is: a runtime with
 * a `location.reload` can reload, and a phone has no document to reload
 * whatever it calls itself. That is also the more honest question — the
 * control exists if and only if the thing behind it does.
 */

/** Whether this runtime has a document it can reload. */
export function canReloadPage(): boolean {
  const location = (globalThis as { location?: { reload?: unknown } }).location;
  return typeof location?.reload === 'function';
}

/**
 * @returns whether a reload was actually started, so a caller can tell the
 * difference between "done" and "nothing happened" instead of guessing. A
 * control wired to something that silently does nothing is the affordance rule
 * in `CLAUDE.md` §3 broken by omission rather than by drawing.
 */
export function reloadPage(): boolean {
  if (!canReloadPage()) {
    return false;
  }
  (globalThis as unknown as { location: { reload: () => void } }).location.reload();
  return true;
}

/**
 * Native has nothing to teach here: VoiceOver and TalkBack move to a screen
 * that has been pushed, and there is no Tab key to leave stranded. The web
 * needs `installScreenFocus.web.ts`.
 */
export interface ScreenFocus {
  /** Navigation is ready; the screen showing now is where the page loaded. */
  ready(): void;
  /** The navigation state changed. */
  arrived(): void;
  dispose(): void;
}

export function installScreenFocus(_currentRoute: () => string | undefined): ScreenFocus {
  return { ready() {}, arrived() {}, dispose() {} };
}

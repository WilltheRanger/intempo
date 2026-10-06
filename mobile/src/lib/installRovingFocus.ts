/**
 * Native has nothing to install: VoiceOver and TalkBack move through a group
 * with their own gestures and announce its size themselves, and there is no
 * Tab order to collapse. The web needs `installRovingFocus.web.ts`.
 */
export function installRovingFocus(): () => void {
  return () => {};
}

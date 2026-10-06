/**
 * Native has no Space or Enter key to teach: VoiceOver and TalkBack activate a
 * control with their own gestures, and a hardware keyboard goes through the
 * platform's focus system. The web needs `installKeyActivation.web.ts`.
 */
export function installKeyActivation(): () => void {
  return () => {};
}

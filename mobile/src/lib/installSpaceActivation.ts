/**
 * Native has no Space key to teach: VoiceOver and TalkBack activate a control
 * with their own gestures, and a hardware keyboard goes through the platform's
 * focus system. The web needs `installSpaceActivation.web.ts`.
 */
export function installSpaceActivation(): () => void {
  return () => {};
}

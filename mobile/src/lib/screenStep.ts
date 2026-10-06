/**
 * Say that a screen's content has changed to a new step without the screen
 * itself changing — onboarding's questions are one screen.
 *
 * A no-op here: native screen readers are not told, and whether VoiceOver
 * keeps its place on a step change has not been checked on a device. The web
 * moves focus to the new step's title (`screenStep.web.ts`).
 */
export function announceScreenStep(_step: string): void {}

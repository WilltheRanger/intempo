import type { UpdateMeInput } from '../data/api/me';
import type { Instrument, Musician } from '../data/types';

/**
 * The rules the onboarding screen follows, out of the component so they can be
 * tested.
 *
 * There is no React Native testing library in this project (`DECISIONS.md`,
 * 2026-08-24), so a rule written inside a `.tsx` is a rule nothing checks —
 * which is how eight of the nine capture-path defects survived. The three
 * decisions on this screen that can be wrong live here instead: what it must
 * have before it will finish, what a save actually sends, and whether the
 * screen is shown at all.
 */

/** What onboarding collected. All three are required — see `MISSING_LABELS`. */
export interface OnboardingAnswers {
  /** As typed, untrimmed. Trimming is this module's job, not the screen's. */
  name: string;
  instrument: Instrument | null;
  /** The object key from `useUploadAvatar`, or null if none was chosen or it failed. */
  avatarKey: string | null;
}

/**
 * What onboarding still needs, in the order the screen asks for it.
 *
 * **All three are required.** The owner's call on 2026-08-25 — *"dont make
 * name profile and instrument optional"* — reversing the skippable screen
 * shipped earlier the same day. `PATCH /v1/me` enforces the same rule against
 * the resulting row, because a requirement only the client checks is a
 * convention: the endpoint is reachable without this screen.
 *
 * The photograph is the one with a real cost. It is the only answer that
 * cannot be supplied by thinking — someone signing up away from a picture they
 * are happy with has to stop and find one, and the app is shut until they do.
 * That is the owner's decision to make and it is made; recorded here so it is
 * visible to whoever reads this next rather than only in a commit message.
 */
export type OnboardingRequirement = 'name' | 'photo' | 'instrument';

/** What each missing answer is called in front of a musician. */
export const MISSING_LABELS: Record<OnboardingRequirement, string> = {
  name: 'your name',
  photo: 'a photo',
  instrument: 'your instrument',
};

/**
 * What is still unanswered, in asking order — empty when the screen can finish.
 *
 * A list rather than a boolean so the screen can say *which*. A disabled
 * button with no reason beside it is the interaction this project has already
 * called out elsewhere: it looks like a tap that did nothing.
 *
 * A name of only spaces is not a name, matching what the server stores: it
 * strips and writes NULL, so accepting one here would let someone through to
 * an account with no name on it.
 */
export function missingFromOnboarding(
  answers: OnboardingAnswers,
): OnboardingRequirement[] {
  const missing: OnboardingRequirement[] = [];
  if (!answers.name.trim()) {
    missing.push('name');
  }
  if (!answers.avatarKey) {
    missing.push('photo');
  }
  if (!answers.instrument) {
    missing.push('instrument');
  }
  return missing;
}

/**
 * What is still needed, as a sentence — or null when nothing is.
 *
 * Here rather than in the screen because the empty case is the one that
 * matters and it is invisible in a component: a disabled button beside the
 * words "Still needed:" and nothing after them is worse than no line at all.
 * Returning null makes "say nothing" the only way to render a satisfied form.
 *
 * Two items are joined with "and", three with a comma and "and" — the shape
 * English uses, not the shape `Array.join` produces.
 */
export function describeMissing(
  missing: OnboardingRequirement[],
): string | null {
  const labels = missing.map((requirement) => MISSING_LABELS[requirement]);
  if (labels.length === 0) {
    return null;
  }
  if (labels.length === 1) {
    return `Still needed: ${labels[0]}.`;
  }
  const last = labels[labels.length - 1];
  return `Still needed: ${labels.slice(0, -1).join(', ')} and ${last}.`;
}

/**
 * The PATCH body for finishing onboarding.
 *
 * **Only fields that were actually given**, even though all three are now
 * required. The guards are not redundant with `missingFromOnboarding`: they
 * guard a different failure. `UpdateMeInput` reads an omitted field as "leave
 * it" and an explicit `null` as "clear it", so a screen bug that called this
 * with a blank name would not merely fail to set one — it would send
 * `display_name: null` and *erase* a name the account already carried. A
 * request that does too little is recoverable; one that deletes is not.
 *
 * `onboarded: true` is always present. It is what the server stamps, and the
 * server refuses to stamp it unless the resulting row has all three.
 */
export function profileUpdateFor(answers: OnboardingAnswers): UpdateMeInput {
  const name = answers.name.trim();
  return {
    onboarded: true,
    ...(name ? { display_name: name } : {}),
    ...(answers.instrument ? { instrument: answers.instrument } : {}),
    ...(answers.avatarKey ? { avatar_key: answers.avatarKey } : {}),
  };
}

/**
 * Whether to put the onboarding screen in front of this musician.
 *
 * **Only on a definite no.** `undefined` — the query still in flight, or
 * failed — is not an answer, and it opens the app. A gate that waits for a
 * network request is a network request standing between someone and the app
 * they already have an account for; on a bad connection that is a blank screen
 * of unknown length, which this project has already shipped once (the boot
 * watchdog) and does not want again.
 *
 * The cost of failing open is a brief flash of Today on the one launch after
 * signing up, before `/v1/me` answers. The cost of failing closed is every
 * cold start, for everyone, forever.
 *
 * An older backend that has not run migration 009 sends no `onboarded_at` at
 * all, which `toMusician` reads as onboarded — so it never gates either. That
 * is the same direction, for the same reason.
 */
export function shouldOnboard(me: Musician | undefined): boolean {
  return me?.onboarded === false;
}

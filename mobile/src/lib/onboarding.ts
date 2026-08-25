import type { UpdateMeInput } from '../data/api/me';
import type { Instrument, Musician } from '../data/types';

/**
 * The rules the onboarding screen follows, out of the component so they can be
 * tested.
 *
 * There is no React Native testing library in this project (`DECISIONS.md`,
 * 2026-08-24), so a rule written inside a `.tsx` is a rule nothing checks —
 * which is how eight of the nine capture-path defects survived. Both of the
 * decisions on this screen that can be wrong live here instead: what a save
 * actually sends, and whether the screen is shown at all.
 */

/** What onboarding collected. Every field is optional — the screen is skippable. */
export interface OnboardingAnswers {
  /** As typed, untrimmed. Trimming is this module's job, not the screen's. */
  name: string;
  instrument: Instrument | null;
  /** The object key from `useUploadAvatar`, or null if none was chosen or it failed. */
  avatarKey: string | null;
}

/**
 * The PATCH body for finishing onboarding.
 *
 * **Only fields that were actually given.** `UpdateMeInput` reads an omitted
 * field as "leave it" and an explicit `null` as "clear it", so sending
 * `display_name: null` for a name nobody typed would be a request to *erase* a
 * name — a different act from never having set one, and on this screen there
 * is nothing to erase. An account that already carries a name from somewhere
 * else must not lose it because someone tapped through this screen.
 *
 * `onboarded: true` is in every result, including the skip. Being asked is
 * what the server records: someone who declines has been asked, and a
 * skippable screen that comes back is not skippable.
 */
export function profileUpdateFor(
  answers: OnboardingAnswers,
  options: { skipping: boolean },
): UpdateMeInput {
  if (options.skipping) {
    // Nothing but the flag, even if something was filled in before the tap.
    // Skip means "don't use what I put in here", not "save it quietly" — and
    // a half-typed name saved by a button labelled Skip is a small betrayal.
    return { onboarded: true };
  }

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

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

/** A photograph chosen from the library, before it has been uploaded. */
export interface PickedPhoto {
  uri: string;
  mimeType: string;
}

/** What onboarding collected. A name and an instrument are required. */
export interface OnboardingAnswers {
  /** As typed, untrimmed. Trimming is this module's job, not the screen's. */
  name: string;
  instrument: Instrument | null;
  /** The object key from `useUploadAvatar`, once the upload has finished. */
  avatarKey: string | null;
}

/**
 * What onboarding requires before it finishes: a name and an instrument.
 *
 * **The photograph was the third and is not any more.** The owner's call on
 * 2026-08-25 was *"dont make name profile and instrument optional"*; the
 * redesign's photo step ("Optional, and only you and your teacher ever see
 * it", with "Do this later") reverses the photograph half of it, confirmed by
 * the owner on 2026-09-23 — `DECISIONS.md`. The greeting and how playing is
 * read depend on the other two; nothing depends on a face.
 *
 * `PATCH /v1/me` enforces the same rule against the resulting row, because a
 * requirement only the client checks is a convention: the endpoint is
 * reachable without this screen.
 */
export type OnboardingRequirement = 'name' | 'instrument';

/**
 * What is still unanswered, in asking order — empty when onboarding can finish.
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
  if (!answers.instrument) {
    missing.push('instrument');
  }
  return missing;
}

/**
 * The PATCH body for finishing onboarding.
 *
 * **Only fields that were actually given**, even though two are required. The guards are not redundant with `missingFromOnboarding`: they
 * guard a different failure. `UpdateMeInput` reads an omitted field as "leave
 * it" and an explicit `null` as "clear it", so a screen bug that called this
 * with a blank name would not merely fail to set one — it would send
 * `display_name: null` and *erase* a name the account already carried. A
 * request that does too little is recoverable; one that deletes is not.
 *
 * `onboarded: true` is always present. It is what the server stamps, and the
 * server refuses to stamp it unless the resulting row has a name and an
 * instrument.
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
 * The object key to reuse for this photograph, if the upload already happened.
 *
 * Saving is two requests — put the bytes in the avatars bucket, then save the
 * key with the rest of the profile — and only the second one usually fails. A
 * retry that uploaded again would leave an orphan in storage every time, on
 * exactly the connection least able to afford it.
 *
 * Keyed on the file, not on a flag. The screen used to hold `avatarKey` in
 * state and clear it inside the photo picker, so "is this key still the right
 * one" was a fact spread across two handlers; picking a *different* photograph
 * and retrying is the case that gets that wrong, and it is silent — the
 * account ends up pointing at the picture they backed out of.
 */
export function reusableAvatarKey(
  photo: { uri: string } | null,
  uploaded: { uri: string; key: string } | null,
): string | null {
  if (!photo || !uploaded) {
    return null;
  }
  return photo.uri === uploaded.uri ? uploaded.key : null;
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

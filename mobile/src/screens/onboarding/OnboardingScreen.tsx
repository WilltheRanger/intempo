import { useState } from 'react';

import { arrival } from '../../data/arrival';
import { useMe } from '../../data/hooks/useMe';
import { useUpdateProfile, useUploadAvatar } from '../../data/hooks/useProfile';
import { profileUpdateFor, reusableAvatarKey } from '../../lib/onboarding';
import { OnboardingFlow, type OnboardingAnswers } from './OnboardingFlow';

/**
 * Onboarding for an account that already exists.
 *
 * The questions are `OnboardingFlow`, shared with the screen that asks them
 * *before* the account does — this one is only what happens to the answers:
 * the photograph, if there is one, goes to the avatars bucket and the key is
 * saved with the rest of the profile.
 *
 * ## It is a fallback now, not the main path
 *
 * Since 2026-09-08 onboarding runs ahead of the sign-up form, and
 * `useApplyOnboardingDraft` lands those answers the moment a session appears.
 * This screen is what is left when that could not happen:
 *
 * - the confirmation link was opened on **another device or browser**, where
 *   the draft never existed;
 * - somebody reached `PATCH /v1/me` without this app at all.
 *
 * (A relaunch between answering and confirming used to be a third: it loses
 * the photograph on purpose, and the photograph was required. It is optional
 * since 2026-09-23, so the name and instrument alone now finish onboarding.)
 *
 * All three want the same thing: ask for whatever the account is still
 * missing. `me` supplies the answers it already has, which is why nothing here
 * starts from blank.
 *
 * ## Two requests, one visible action
 *
 * If the upload succeeds and the save fails, the key is kept against the file
 * it came from and the next Continue retries only the save — see
 * `reusableAvatarKey`. That avoids a duplicate upload on an unreliable
 * connection and keeps the button busy until the gate actually lifts.
 *
 * ## It navigates nowhere
 *
 * `RootNavigator` holds this in front of the app while `shouldOnboard(me)`,
 * the way the sign-in and password-reset screens are held. Saving invalidates
 * `me`; `onboarded` becomes true; the gate falls away to the welcome. There is no `navigate`
 * and no `reset` here, so there is no route this screen can be wrong about —
 * which matters, because navigation is the part of this app nothing tests.
 *
 * Everything it can get wrong lives in `lib/onboarding.ts`, where it is
 * tested: what it must have, what it sends, what it says is missing, whether
 * an upload can be reused, and whether it is shown at all.
 */
export function OnboardingScreen() {
  const save = useUpdateProfile();
  const upload = useUploadAvatar();
  /**
   * **What the account already knows, because this screen can be answered
   * twice.** `PATCH /v1/me` stores what it is given and stamps `onboarded_at`
   * only once the resulting row carries both required answers — so someone
   * whose name landed and whose instrument did not arrives here with the name
   * already filled.
   */
  const { data: me } = useMe();
  /** The last successful upload, against the file it came from. */
  const [uploaded, setUploaded] = useState<{ uri: string; key: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  async function finish(answers: OnboardingAnswers) {
    setError(null);

    let key = reusableAvatarKey(answers.photo, uploaded);
    if (!key && answers.photo) {
      try {
        key = await upload.mutateAsync(answers.photo);
        setUploaded({ uri: answers.photo.uri, key });
      } catch (cause) {
        setError(
          cause instanceof Error
            ? `${cause.message} Try Finish again.`
            : 'That profile picture could not be sent. Try Finish again.',
        );
        return;
      }
    }

    // Stood up *before* the save, not after it: the save resolves only once
    // `me` has been refetched, and by then the gate has already fallen — so
    // setting it afterwards would let the tabs render before the welcome.
    // Set early it costs nothing on a failure, because the gate is checked
    // first and stays up until a save lands.
    arrival.onboarded();
    try {
      // The mutation resolves only once `me` has been refetched, so the button
      // stays in its loading state right up to the moment the gate lifts —
      // rather than going idle for a frame under a screen that hasn't moved.
      await save.mutateAsync(
        profileUpdateFor({
          name: answers.name,
          instrument: answers.instrument,
          avatarKey: key,
        }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'That could not be saved. Try again.',
      );
    }
  }

  return (
    <OnboardingFlow
      initial={{
        name: me?.displayName ?? '',
        instrument: me?.instrument ?? null,
        photo: null,
      }}
      storedPhotoUrl={me?.avatarUrl ?? null}
      finishLabel="Finish"
      busy={save.isPending || upload.isPending}
      error={error}
      onFinish={(answers) => void finish(answers)}
    />
  );
}

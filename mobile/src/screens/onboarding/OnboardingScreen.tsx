import { useState } from 'react';

import { useMe } from '../../data/hooks/useMe';
import { useUpdateProfile, useUploadAvatar } from '../../data/hooks/useProfile';
import { profileUpdateFor, reusableAvatarKey } from '../../lib/onboarding';
import { OnboardingForm, type OnboardingFormAnswers } from './OnboardingForm';

/**
 * Onboarding for an account that already exists.
 *
 * The three questions are `OnboardingForm`, shared with the screen that asks
 * them *before* the account does — this one is only what happens to the
 * answers: the photograph goes to the avatars bucket and the key is saved with
 * the rest of the profile.
 *
 * ## It is a fallback now, not the main path
 *
 * Since 2026-09-08 onboarding runs ahead of the sign-up form, and
 * `useApplyOnboardingDraft` lands those answers the moment a session appears.
 * This screen is what is left when that could not happen:
 *
 * - the confirmation link was opened on **another device or browser**, where
 *   the draft never existed;
 * - the app was relaunched between answering and confirming, which loses the
 *   photograph on purpose (see `OnboardingDraft.photo`) — so the name and the
 *   instrument are already on the account and this screen opens with them
 *   filled, asking only for the picture;
 * - somebody reached `PATCH /v1/me` without this app at all.
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
 * `me`; `onboarded` becomes true; the gate falls away. There is no `navigate`
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
   * only once the resulting row carries all three answers — so someone who
   * typed their name, chose a photograph, was interrupted, and came back
   * arrives here with those two already on their account.
   */
  const { data: me } = useMe();
  /** The last successful upload, against the file it came from. */
  const [uploaded, setUploaded] = useState<{ uri: string; key: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  async function finish(answers: OnboardingFormAnswers) {
    setError(null);

    let key = reusableAvatarKey(answers.photo, uploaded);
    if (!key && answers.photo) {
      try {
        key = await upload.mutateAsync(answers.photo);
        setUploaded({ uri: answers.photo.uri, key });
      } catch (cause) {
        setError(
          cause instanceof Error
            ? `${cause.message} Try Continue again.`
            : 'That profile picture could not be sent. Try Continue again.',
        );
        return;
      }
    }

    if (!key && !me?.avatarUrl) {
      // The button is disabled in this state; this guard also protects direct
      // calls and future changes to the form rules. A photograph already on
      // the account counts — the server reads the resulting row, not the body.
      setError('Choose a profile picture before continuing.');
      return;
    }

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
    <OnboardingForm
      initial={{
        name: me?.displayName ?? '',
        instrument: me?.instrument ?? null,
        photo: null,
      }}
      storedPhotoUrl={me?.avatarUrl ?? null}
      busy={save.isPending || upload.isPending}
      note={upload.isPending ? 'Sending your profile picture…' : null}
      error={error}
      onSubmit={(answers) => void finish(answers)}
    />
  );
}

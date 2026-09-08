import { useEffect, useRef, useState } from 'react';

import { onboardingDraft } from '../onboardingDraft';
import type { Musician } from '../types';
import {
  draftIsWorthSending,
  draftUpdateFor,
  shouldOnboard,
} from '../../lib/onboarding';
import { useUpdateProfile, useUploadAvatar } from './useProfile';

/**
 * Puts the answers given before sign-up onto the account, once there is one.
 *
 * Onboarding runs ahead of the sign-up form (2026-09-08), and creating an
 * account usually returns **no session** — Supabase emails a confirmation
 * link. So this is the other end of that gap: the first time `/v1/me` comes
 * back saying the account has not been onboarded, whatever is in the draft is
 * uploaded and saved, and the gate never appears.
 *
 * Returns whether it is working, so the caller can hold a loading screen
 * rather than flash the onboarding form at somebody who has already answered
 * it.
 *
 * ## Once per launch, and the ref is why
 *
 * Saving invalidates `me`, so this effect re-runs on the answer it caused. A
 * partial draft — the photograph is not persisted, so a relaunch between
 * answering and confirming loses it — comes back *still* un-onboarded, which
 * is exactly the shape of an infinite retry. `attempted` bounds it to one try
 * per mount; the draft survives a failure and is tried again next launch.
 *
 * ## What a failure costs, and why the upload is not fatal
 *
 * The photograph is uploaded first and its failure is swallowed on purpose: a
 * storage error must not cost the name and the instrument as well, and those
 * two are what stop the gate asking for everything again. `draftUpdateFor`
 * claims `onboarded` only when all three are actually present, so a partial
 * save is a real save — it lands what it has and leaves the account
 * un-onboarded, and the gate opens pre-filled asking only for the picture.
 *
 * ## Clearing it is a safety rule, not tidiness
 *
 * A draft left on the device is applied to the **next** account signed in on
 * it — somebody else's name and instrument. So it is dropped the moment the
 * account is through onboarding, however it got there: by this hook, by the
 * gate, or by having been onboarded long before this device existed.
 */
export function useApplyOnboardingDraft(me: Musician | undefined): boolean {
  const save = useUpdateProfile();
  const upload = useUploadAvatar();
  const attempted = useRef(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (me?.onboarded) {
      // Through onboarding by any route. Anything still held would belong to
      // this account or to nobody, and it must not reach the next one.
      onboardingDraft.clear();
      return;
    }
    if (attempted.current || !shouldOnboard(me)) {
      return;
    }

    const draft = onboardingDraft.current();
    const answers = {
      name: draft.name,
      instrument: draft.instrument,
      avatarKey: null,
      photoSelected: Boolean(draft.photo),
    };
    if (!draftIsWorthSending(answers)) {
      return;
    }

    attempted.current = true;
    setApplying(true);
    void (async () => {
      let avatarKey: string | null = null;
      if (draft.photo) {
        try {
          avatarKey = await upload.mutateAsync(draft.photo);
        } catch {
          // The picture is the only answer lost; the gate will ask for it.
        }
      }
      try {
        await save.mutateAsync(draftUpdateFor({ ...answers, avatarKey }));
        onboardingDraft.clear();
      } catch {
        // Kept, so the next launch can try again. The gate is in front of the
        // app either way, and it opens with whatever did land already filled.
      }
      setApplying(false);
    })();
  }, [me, save, upload]);

  return applying;
}

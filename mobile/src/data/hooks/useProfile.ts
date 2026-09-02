import { useMutation, useQueryClient } from '@tanstack/react-query';

import { meKeys } from './useMe';
import { updateMe, type UpdateMeInput } from '../api/me';
import { requestAvatarUpload, uploadToSignedUrl } from '../api/upload';
import { IS_LIVE_BACKEND } from '../environment';
import { preferences } from '../preferences';
import type { Instrument } from '../types';

/**
 * Writing the profile a musician owns.
 *
 * Not on `PieceSource` like the reads, and for the reason the other
 * server-only writes are not: a build running on sample data has nothing to
 * write to, and a mutation that silently succeeded against a fixture would
 * teach the screen a lie about what it had saved.
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, UpdateMeInput>({
    mutationFn: async (input) => {
      if (!IS_LIVE_BACKEND) {
        throw new Error(
          'Saving your profile needs the backend. This build is running on sample data.',
        );
      }
      await updateMe(input);
      if (input.instrument) {
        // The device preference follows the account, so the warmup and the
        // recorder — which read it synchronously and cannot await a query —
        // are right on the very next screen rather than after a refetch.
        //
        // The account is the source of truth; this is a cache of it. Writing
        // it here rather than making every reader async is the same trade
        // `preferences` was built for.
        preferences.setInstrument(input.instrument);
      }
    },
    // Returned, not fired and forgotten: react-query awaits a promise from
    // `onSuccess` before `mutateAsync` resolves, so the caller's pending state
    // covers the refetch too. The onboarding gate lifts when `me` says
    // `onboarded`, and a button that goes idle a frame before the screen moves
    // reads as a tap that did nothing.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: meKeys.all }),
  });
}

/**
 * Puts a chosen image in the avatars bucket and returns its object key.
 *
 * Two steps, both of which can fail on their own: ask the API for a signed
 * URL, then PUT the bytes to storage. The key is **not** saved to the account
 * here — that is `useUpdateProfile`'s job — because onboarding lets someone
 * pick a picture and then change their mind before saving, and an upload that
 * wrote straight to the row would leave the account pointing at a picture they
 * had backed out of.
 */
export function useUploadAvatar() {
  return useMutation<string, Error, { uri: string; mimeType: string }>({
    mutationFn: async ({ uri, mimeType }) => {
      if (!IS_LIVE_BACKEND) {
        throw new Error(
          'Uploading a photo needs the backend. This build is running on sample data.',
        );
      }
      const response = await fetch(uri);
      const blob = await response.blob();
      // The extension follows the *type*, never the filename — the lesson the
      // score upload learned, where separate fallbacks let an unrecognised
      // name declare `image/jpeg` and file the object as `page.heif`.
      const { upload_url, object_key } = await requestAvatarUpload(
        `avatar.${extensionFor(mimeType)}`,
      );
      await uploadToSignedUrl(upload_url, blob, mimeType, { subject: 'photo' });
      return object_key;
    },
  });
}

/**
 * The file extension for a picture the server will accept.
 *
 * HEIC is deliberately absent: the server refuses it for an avatar because the
 * picture is handed straight to an `<img>`, and Chrome and Firefox cannot
 * display it. Anything unrecognised is sent as JPEG, which is what
 * `expo-image-picker` produces once a quality is given — including for the
 * HEIC an iPhone shoots by default.
 */
export function extensionFor(mimeType: string): string {
  const known: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  return known[mimeType.toLowerCase()] ?? 'jpg';
}

/**
 * Which instrument the app should act on, given the account and the device.
 *
 * The account wins when it has one, because it is the answer a person gave and
 * it follows them to another device. The device preference is the fallback,
 * and it always has a value — so this never returns null and no caller needs a
 * "no instrument" branch.
 *
 * **Null on the account is not a value to render.** It means nobody has been
 * asked, and what to do about that is the onboarding screen's business, not
 * the warmup's.
 */
export function instrumentInUse(
  fromAccount: Instrument | null,
  fromDevice: Instrument,
): Instrument {
  return fromAccount ?? fromDevice;
}

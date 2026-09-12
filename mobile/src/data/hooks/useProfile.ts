import { useMutation, useQueryClient } from '@tanstack/react-query';

import { meKeys } from './useMe';
import { updateMe, type UpdateMeInput } from '../api/me';
import { requestAvatarUpload, uploadToSignedUrl } from '../api/upload';
import { prepareAvatar } from '../profile/avatarImage';
import { IS_LIVE_BACKEND } from '../environment';
import { preferences } from '../preferences';

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
          'Uploading a profile picture needs the backend. This build is running on sample data.',
        );
      }
      // **Down to avatar size before a byte goes anywhere.** Measured at
      // 3.1 MB an avatar on the live project, for a circle drawn at 76 points
      // — the picker re-encodes an iPhone's HEIC to JPEG and nothing ever
      // touched the resolution. `prepareAvatar` never throws: a picture it
      // cannot shrink is sent as it was, because this is a saving and losing
      // somebody's profile picture to make one is not a trade.
      const prepared = await prepareAvatar(uri, mimeType);
      const response = await fetch(prepared.uri);
      const blob = await response.blob();
      // The extension follows the *type*, never the filename — the lesson the
      // score upload learned, where separate fallbacks let an unrecognised
      // name declare `image/jpeg` and file the object as `page.heif`.
      const { upload_url, object_key } = await requestAvatarUpload(
        `avatar.${extensionFor(prepared.mimeType)}`,
      );
      await uploadToSignedUrl(upload_url, blob, prepared.mimeType, {
        subject: 'photo',
      });
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

export interface ProfilePhotoSelection {
  uri: string;
  mimeType: string;
  /** A successful upload retained while the profile row is retried. */
  avatarKey?: string;
}

export interface ProfilePhotoActions {
  upload: (photo: { uri: string; mimeType: string }) => Promise<string>;
  save: (input: { avatar_key: string }) => Promise<unknown>;
}

/**
 * A failed replacement that carries exactly the work already accepted.
 *
 * Uploading the bytes and saving their object key are separate network calls.
 * If the second one drops, the first must not be repeated: an avatar lives for
 * the account's lifetime, so every abandoned retry would otherwise leave
 * another private object behind.
 */
export class ProfilePhotoSaveError extends Error {
  constructor(
    message: string,
    readonly resume: ProfilePhotoSelection,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ProfilePhotoSaveError';
  }
}

/**
 * Uploads and saves a profile photo, resuming at the profile write when it can.
 */
export async function saveProfilePhoto(
  selection: ProfilePhotoSelection,
  actions: ProfilePhotoActions,
): Promise<ProfilePhotoSelection & { avatarKey: string }> {
  const resume: ProfilePhotoSelection = { ...selection };

  try {
    if (!resume.avatarKey) {
      resume.avatarKey = await actions.upload({
        uri: resume.uri,
        mimeType: resume.mimeType,
      });
    }

    await actions.save({ avatar_key: resume.avatarKey });
    return { ...resume, avatarKey: resume.avatarKey };
  } catch (cause) {
    throw new ProfilePhotoSaveError(
      cause instanceof Error
        ? cause.message
        : 'That profile picture could not be saved. Try again.',
      resume,
      cause,
    );
  }
}

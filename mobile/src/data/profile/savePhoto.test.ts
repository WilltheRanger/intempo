import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ProfilePhotoSaveError,
  saveProfilePhoto,
  type ProfilePhotoSelection,
} from './savePhoto';

const PHOTO: ProfilePhotoSelection = {
  uri: 'file:///portrait.jpg',
  mimeType: 'image/jpeg',
};

describe('saving a profile photo', () => {
  const upload = vi.fn();
  const save = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    upload.mockResolvedValue('user-1/avatar.jpg');
    save.mockResolvedValue(undefined);
  });

  it('uploads the selection and saves its durable key', async () => {
    await expect(saveProfilePhoto(PHOTO, { upload, save })).resolves.toMatchObject({
      avatarKey: 'user-1/avatar.jpg',
    });

    expect(upload).toHaveBeenCalledWith(PHOTO);
    expect(save).toHaveBeenCalledWith({ avatar_key: 'user-1/avatar.jpg' });
  });

  it('retains an accepted upload when saving the account fails', async () => {
    save.mockRejectedValueOnce(new Error('Connection dropped'));

    const failure = await saveProfilePhoto(PHOTO, { upload, save }).catch((error) => error);
    expect(failure).toBeInstanceOf(ProfilePhotoSaveError);
    expect(failure).toMatchObject({
      message: 'Connection dropped',
      resume: { ...PHOTO, avatarKey: 'user-1/avatar.jpg' },
    });

    await saveProfilePhoto(failure.resume, { upload, save });

    expect(upload, 'the same photo was uploaded twice').toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('keeps the local selection when the upload itself fails', async () => {
    upload.mockRejectedValue(new Error('No connection'));

    await expect(saveProfilePhoto(PHOTO, { upload, save })).rejects.toMatchObject({
      message: 'No connection',
      resume: PHOTO,
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('skips upload when retrying a selection that already has a key', async () => {
    await saveProfilePhoto(
      { ...PHOTO, avatarKey: 'user-1/already-uploaded.jpg' },
      { upload, save },
    );

    expect(upload).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith({
      avatar_key: 'user-1/already-uploaded.jpg',
    });
  });
});

import { describe, expect, it, vi } from 'vitest';

import { PAGE_PHOTO_OPTIONS, photographPage, type CameraPicker } from './systemCamera';

function picker(overrides: Partial<CameraPicker> = {}): CameraPicker & {
  launchCameraAsync: ReturnType<typeof vi.fn>;
  requestCameraPermissionsAsync: ReturnType<typeof vi.fn>;
} {
  return {
    launchCameraAsync: vi.fn(async () => ({
      canceled: false,
      assets: [{ uri: 'blob:page', width: 3024, height: 4032 }],
    })),
    requestCameraPermissionsAsync: vi.fn(async () => ({ granted: true, canAskAgain: true })),
    CameraType: { back: 'back' },
    ...overrides,
  } as never;
}

describe('the camera on the web', () => {
  it('opens inside the call, before anything is awaited', () => {
    // A browser opens a file input only during the tap that asked for it, so
    // the camera has to be asked for before this function first yields.
    const camera = picker();

    void photographPage(camera, 'web');

    expect(camera.launchCameraAsync).toHaveBeenCalledTimes(1);
    expect(camera.requestCameraPermissionsAsync).not.toHaveBeenCalled();
  });

  it('keeps the whole photograph, at the camera’s own size', async () => {
    const camera = picker();

    const photo = await photographPage(camera, 'web');

    expect(photo).toEqual({ kind: 'photo', uri: 'blob:page', width: 3024, height: 4032 });
    const [options] = camera.launchCameraAsync.mock.calls[0];
    expect(options).toMatchObject({
      allowsEditing: false,
      cameraType: 'back',
      mediaTypes: ['images'],
    });
  });
});

describe('the camera in the app build', () => {
  it('asks for the permission first, because iOS refuses the camera without it', async () => {
    const camera = picker();

    const photo = await photographPage(camera, 'ios');

    expect(camera.requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(camera.launchCameraAsync).toHaveBeenCalledTimes(1);
    expect(photo.kind).toBe('photo');
  });

  it('says a refusal is a refusal, and whether it can be asked again', async () => {
    const camera = picker({
      requestCameraPermissionsAsync: vi.fn(async () => ({ granted: false, canAskAgain: false })),
    });

    expect(await photographPage(camera, 'ios')).toEqual({ kind: 'refused', canAskAgain: false });
    expect(camera.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('encodes at 0.95, not 1 and not 0.8', () => {
    // 1 is megabytes of nothing a staff line shows; 0.8 smears the lines.
    expect(PAGE_PHOTO_OPTIONS.quality).toBe(0.95);
  });
});

describe('every way the camera can come back', () => {
  it('a closed camera is a cancel', async () => {
    const camera = picker({ launchCameraAsync: vi.fn(async () => ({ canceled: true, assets: null })) });
    expect(await photographPage(camera, 'web')).toEqual({ kind: 'cancelled' });
  });

  it('an answer with no image in it is a failure, not a photograph', async () => {
    const camera = picker({ launchCameraAsync: vi.fn(async () => ({ canceled: false, assets: [] })) });
    expect(await photographPage(camera, 'web')).toEqual({ kind: 'failed' });
  });

  it('never throws, whatever the picker does', async () => {
    const camera = picker({
      launchCameraAsync: vi.fn(async () => {
        throw new Error('MissingCameraPermissionException');
      }),
      requestCameraPermissionsAsync: vi.fn(async () => {
        throw new Error('permissions module not found');
      }),
    });
    expect(await photographPage(camera, 'web')).toEqual({ kind: 'failed' });
    expect(await photographPage(camera, 'ios')).toEqual({ kind: 'failed' });
  });

  it('a size the camera did not report is unknown, not zero', async () => {
    const camera = picker({
      launchCameraAsync: vi.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///page.jpg', width: 0 }] })),
    });
    expect(await photographPage(camera, 'ios')).toEqual({
      kind: 'photo',
      uri: 'file:///page.jpg',
      width: null,
      height: null,
    });
  });
});

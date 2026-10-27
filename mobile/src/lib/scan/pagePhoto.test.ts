import { beforeEach, describe, expect, it } from 'vitest';

import { captureSession } from '../../data/captureSession';
import {
  intentFromParams,
  landPhoto,
  launcherCopy,
  scannerParamsFor,
  type CameraIntent,
} from './pagePhoto';

beforeEach(() => {
  captureSession.reset();
});

describe('where a photograph lands', () => {
  it('a new scan starts from nothing, whatever was left behind', () => {
    captureSession.capture('abandoned.jpg');

    landPhoto(captureSession, { kind: 'new' }, 'page-1.jpg');

    expect(captureSession.current().map((page) => page.source)).toEqual(['page-1.jpg']);
  });

  it('a new scan for a piece remembers the piece', () => {
    landPhoto(captureSession, { kind: 'new', attachToPieceId: 'piece-7' }, 'page-1.jpg');

    expect(captureSession.attachmentPieceId()).toBe('piece-7');
  });

  it('another page joins the scan at the end', () => {
    landPhoto(captureSession, { kind: 'new' }, 'page-1.jpg');
    landPhoto(captureSession, { kind: 'add' }, 'page-2.jpg');

    expect(captureSession.current().map((page) => page.source)).toEqual([
      'page-1.jpg',
      'page-2.jpg',
    ]);
  });

  it('a retake takes the old page’s place, not the end of the list', () => {
    // The upload sends the pages in order, so a retake that moved page 1 to
    // the end would have the reader start on page 2.
    landPhoto(captureSession, { kind: 'new' }, 'page-1.jpg');
    landPhoto(captureSession, { kind: 'add' }, 'page-2.jpg');
    const [first] = captureSession.current();

    const outcome = landPhoto(captureSession, { kind: 'retake', pageId: first.id }, 'page-1-again.jpg');

    expect(outcome).toBe('replaced');
    expect(captureSession.current().map((page) => page.source)).toEqual([
      'page-1-again.jpg',
      'page-2.jpg',
    ]);
  });

  it('a retake of a page deleted meanwhile keeps the photograph', () => {
    landPhoto(captureSession, { kind: 'new' }, 'page-1.jpg');

    landPhoto(captureSession, { kind: 'retake', pageId: 'gone' }, 'page-2.jpg');

    expect(captureSession.current().map((page) => page.source)).toEqual([
      'page-1.jpg',
      'page-2.jpg',
    ]);
  });

  it('nothing is marked for a retake before there is a photograph', () => {
    // So a camera closed without a shot has nothing to undo.
    landPhoto(captureSession, { kind: 'new' }, 'page-1.jpg');

    expect(captureSession.retaking()).toBeNull();
  });
});

describe('the scan screen’s parameters', () => {
  const intents: CameraIntent[] = [
    { kind: 'new' },
    { kind: 'new', attachToPieceId: 'piece-7' },
    { kind: 'add' },
    { kind: 'retake', pageId: 'p3' },
  ];

  it.each(intents)('carry the intent there and back: %o', (intent) => {
    expect(intentFromParams(scannerParamsFor(intent))).toEqual(intent);
  });

  it('read a refreshed address bar’s text the way it was meant', () => {
    expect(intentFromParams({ adding: 'true' })).toEqual({ kind: 'add' });
    expect(intentFromParams({ adding: 'false' })).toEqual({ kind: 'new' });
    expect(intentFromParams(undefined)).toEqual({ kind: 'new' });
  });
});

describe('what the scan screen says', () => {
  it('offers the camera, and photos on the phone, with the advice that matters', () => {
    const copy = launcherCopy(null, 'ios');
    expect(copy.primary).toEqual({ label: 'Open camera', route: 'camera' });
    expect(copy.secondary.route).toBe('import');
    expect(copy.hint).toMatch(/whole page/);
  });

  it('sends a refused app build to Settings, and still offers photos', () => {
    const copy = launcherCopy('refused', 'ios');
    expect(copy.primary.route).toBe('settings');
    expect(copy.secondary.route).toBe('import');
  });

  it('never offers Settings on the web, where no page can open them', () => {
    const copy = launcherCopy('refused', 'web');
    expect(copy.primary.route).toBe('camera');
    expect([copy.primary.route, copy.secondary.route]).not.toContain('settings');
  });

  it('offers the camera again after a photograph that never came back', () => {
    const copy = launcherCopy('failed', 'web');
    expect(copy.primary).toEqual({ label: 'Try again', route: 'camera' });
  });
});

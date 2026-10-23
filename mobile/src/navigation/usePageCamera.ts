import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { captureSession } from '../data/captureSession';
import { impact, ImpactFeedbackStyle } from '../lib/haptics';
import { legibilityOf } from '../lib/scan/legibility';
import { pageSamples } from '../lib/scan/pageSamples';
import {
  landPhoto,
  scannerParamsFor,
  type CameraIntent,
  type CameraProblem,
} from '../lib/scan/pagePhoto';
import { shotVerdict } from '../lib/scan/shotVerdict';
import { photographPage } from '../lib/scan/systemCamera';
import { howToReach } from './returnTo';
import type { RootNavigation } from './types';

/**
 * A second tap this soon after the first is the same tap.
 *
 * Time rather than "until the camera answers", because on the web it may
 * never answer: a browser that does not report a cancelled file input leaves
 * the promise pending, and a guard waiting on it would leave every later tap
 * dead.
 */
const OPENING_MS = 1000;
let openedAt = 0;

export interface PhotographOptions {
  /** Replace the current screen with the review list rather than pushing it. */
  replace?: boolean;
  /**
   * What to do when the camera gives no page: by default the scan screen
   * opens and says why. The scan screen itself passes its own handler.
   */
  onProblem?: (problem: CameraProblem) => void;
}

/**
 * Photograph a page with the phone's camera, from any screen that offers it.
 *
 * **Call it straight from a press handler.** On the web the camera opens only
 * inside the tap that asked for it, so this must not be called after an
 * `await`, a timer or a navigation — see `lib/scan/systemCamera.ts`.
 *
 * A photograph lands in the scan (`landPhoto`), is measured for legibility in
 * the background so the review list can flag a page worth another look, and
 * opens the review list. A cancelled camera changes nothing.
 */
export function usePageCamera() {
  const navigation = useNavigation<RootNavigation>();

  function openReview(replace: boolean) {
    if (replace) {
      navigation.replace('CapturedPages');
      return;
    }
    // Back to the list when it is underneath — "Add page" and "Retake" both
    // start there — rather than stacking a second one on top of it.
    if (howToReach(navigation.getState()?.routes, 'CapturedPages') === 'pop') {
      navigation.popTo('CapturedPages', undefined, { merge: true });
    } else {
      navigation.navigate('CapturedPages');
    }
  }

  return function photograph(intent: CameraIntent, options: PhotographOptions = {}): void {
    const now = Date.now();
    if (now - openedAt < OPENING_MS) {
      return;
    }
    openedAt = now;

    // Synchronously, with nothing before it: on the web this is the tap.
    void photographPage(ImagePicker, Platform.OS).then((photo) => {
      if (photo.kind === 'cancelled') {
        return;
      }
      if (photo.kind !== 'photo') {
        const problem: CameraProblem = photo.kind === 'refused' ? 'refused' : 'failed';
        if (options.onProblem) {
          options.onProblem(problem);
        } else {
          navigation.navigate('Scanner', { ...scannerParamsFor(intent), problem });
        }
        return;
      }

      const outcome = landPhoto(captureSession, intent, photo.uri);
      impact(ImpactFeedbackStyle.Medium);
      if (outcome !== 'full') {
        const taken = captureSession.current().find((page) => page.source === photo.uri);
        if (taken) {
          void checkItReads(taken.id, photo.uri);
        }
      }
      openReview(options.replace === true);
    });
  };
}

/**
 * Whether the page just taken has enough detail on it to be read.
 *
 * The server's answer is the one that decides anything, but it arrives after
 * the upload and the queue. This is advisory and costs nothing to wait for: it
 * runs after the review list has opened, and a page it doubts gets a note there
 * (`pageQueue.pageNote`) with Retake beside it. No pixel count is passed —
 * nothing here cropped the photograph, so its size is the camera's own and the
 * only advice worth giving a small page is to move in.
 */
async function checkItReads(id: string, uri: string) {
  try {
    captureSession.noteReading(id, shotVerdict(legibilityOf(await pageSamples(uri))));
  } catch {
    // A page that could not be measured is a page with nothing said about it.
  }
}

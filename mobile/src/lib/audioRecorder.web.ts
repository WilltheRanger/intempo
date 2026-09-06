import {
  EmptyRecordingError,
  maxTakeSamples,
  MicrophoneUnavailableError,
  takeFilename,
  type Recorder,
  type Recording,
} from './audio/types';
import { capturedNothing, createPeakMeter } from './audio/level';
import {
  microphoneFailure,
  shouldRetryUnconstrained,
} from './audio/microphoneFailure';
import { durationOf, encodeWav } from './audio/wav';

/**
 * Audio capture for a practice take, in a browser.
 *
 * An `AudioWorklet` over raw PCM rather than `MediaRecorder`. MediaRecorder is
 * the obvious choice and the wrong one: every format it offers is lossy —
 * Opus in WebM on Chrome, AAC in MP4 on Safari — and both smear the note
 * attacks the analysis measures. The worklet sees the same float samples the
 * hardware produced, before any codec.
 *
 * The three constraints below are the point of doing it this way. Auto gain in
 * particular reshapes attack envelopes, which is precisely the shape being
 * measured; echo cancellation and noise suppression are built to remove
 * everything that isn't speech, and a violin is not speech.
 *
 * The graph's real sample rate goes into the WAV header, so the file is
 * correct whether the browser gives 48 kHz or 44.1.
 */

const CHANNELS = 1;

/**
 * The worklet, copied verbatim into the build from `public/`.
 *
 * Named here and asserted by `audioRecorder.web.test.ts`, so renaming the file
 * without renaming this fails a test rather than a musician's recording.
 */
export const WORKLET_FILE = 'pcm-recorder.worklet.js';

/**
 * Quanta buffered in the worklet before it posts.
 *
 * `process` runs every 128 frames — 2.7 ms at 48 kHz, which is 375 messages a
 * second across the port if each one is sent. 32 quanta is 4096 frames, about
 * 85 ms, which is a message every twelfth of a second instead.
 */
const QUANTA_PER_MESSAGE = 32;

/**
 * The worklet, as source.
 *
 * Loaded from a blob URL rather than a file in `public/`: a worklet fetched by
 * path breaks the moment the app is served from a sub-path, and this keeps the
 * processor beside the code that registers it.
 */


export async function startRecording(): Promise<Recorder> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new MicrophoneUnavailableError(
      'This browser has no microphone API. A secure origin is required.',
    );
  }

  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextCtor) {
    throw new MicrophoneUnavailableError('This browser has no Web Audio.');
  }

  // Create and unlock while the Record tap still owns the user gesture, not
  // after the permission prompt and worklet download have finished.
  let context: AudioContext;
  try {
    context = new AudioContextCtor();
  } catch {
    throw new MicrophoneUnavailableError(
      'Audio could not start. Close other audio apps, return here, and try Record again.',
    );
  }
  let resume: Promise<void> = Promise.resolve();
  try {
    if (context.state !== 'running') {
      // Handle rejection immediately, while permission may still be pending.
      resume = context.resume();
      void resume.catch(() => {});
    }
  } catch {
    void context.close().catch(() => {});
    throw new MicrophoneUnavailableError(
      'Audio could not start. Try Record again.',
    );
  }
  let media: MediaStream | undefined;
  try {
    // Raw and unprocessed, because the analysis measures attacks as played and
    // every one of these processors moves them. A **preference**, not a
    // requirement — see the retry below.
    const PREFERRED: MediaStreamConstraints = {
      audio: {
        channelCount: CHANNELS,
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: false,
      },
    };

    try {
      media = await navigator.mediaDevices.getUserMedia(PREFERRED);
    } catch (error) {
      if (shouldRetryUnconstrained(error)) {
        // A device that cannot give us raw audio should still get to record: a
        // take with echo cancellation on beats no take at all.
        try {
          media = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (retryError) {
          throw microphoneFailure(retryError);
        }
      } else {
        // Every failure that was not a refusal used to become "No microphone is
        // available on this device.", on phones that plainly have one.
        // `microphoneFailure` names what actually happened.
        throw microphoneFailure(error);
      }
    }

    const chunks: Int16Array[] = [];
    const level = createPeakMeter();
    let truncated = false;
    let samples = 0;
    let finished = false;

    const stopTracks = () =>
      media?.getTracks().forEach((track) => track.stop());

    if (!context.audioWorklet) {
      throw new MicrophoneUnavailableError(
        'This browser has no AudioWorklet, which is needed to record losslessly.',
      );
    }

    // **A real file on this origin, not a `blob:` URL.**
    //
    // It was a blob, and that is why recording failed on the deployed site
    // while working everywhere it was tested. `public/_headers` pins
    // `script-src` to `'self'` plus the boot script's hash — deliberately, so
    // an injected `<script src>` cannot run — and `'self'` does not cover
    // `blob:`. `addModule` was refused with `AbortError: Unable to load a
    // worklet's module.`, which is what the sentence below reported.
    //
    // Measured in this repository's own Chromium against the built bundle:
    // refused under the production CSP, loaded without it. Nothing local ever
    // saw it because `npx serve` ignores `_headers` — see
    // `tools/serve-with-headers.mjs`, which is now what the walk runs against.
    //
    // Relative, and left for `addModule` to resolve. It resolves against the
    // document's base URL, which is what a build served from a sub-path needs
    // — and doing it here would mean reaching for `document`, which the
    // recorder otherwise never touches.
    try {
      await context.audioWorklet.addModule(WORKLET_FILE);
    } catch {
      throw new MicrophoneUnavailableError(
        'The recording worklet could not be loaded.',
      );
    }

    const sampleRate = context.sampleRate;
    const maxSamples = maxTakeSamples(sampleRate, CHANNELS);

    const source = context.createMediaStreamSource(media);
    const node = new AudioWorkletNode(context, 'pcm-recorder', {
      numberOfInputs: 1,
      // No outputs: nothing downstream wants this audio, and routing it to the
      // destination would play the musician back to themselves through their own
      // speakers while they record.
      numberOfOutputs: 0,
      channelCount: CHANNELS,
      channelCountMode: 'explicit',
      // The worklet is a separate file now and cannot interpolate a constant,
      // so it is handed one. `processorOptions` is what that option is for.
      //
      // The worklet defaults to the same number if this is missing, which is
      // how the first draft of this change shipped without it and behaved
      // identically — a silent fallback over a missing wire. The test asserts
      // the wire, not the behaviour, for exactly that reason.
      processorOptions: { quantaPerMessage: QUANTA_PER_MESSAGE },
    });

    let onFlushed: (() => void) | null = null;

    node.port.onmessage = (event: MessageEvent) => {
      if (event.data === 'flushed') {
        onFlushed?.();
        return;
      }
      if (samples >= maxSamples) {
        truncated = true;
        return;
      }
      const chunk = new Int16Array(event.data as ArrayBuffer);
      level.observe(chunk);
      chunks.push(chunk);
      samples += chunk.length;
    };

    source.connect(node);

    // Opening the microphone can suspend/interupt the context after its first
    // unlock. That earlier promise may already be resolved; resume the current
    // state as well, under the same bounded startup deadline.
    if (context.state !== 'running') {
      resume = Promise.all([resume, context.resume()]).then(() => {});
      void resume.catch(() => {});
    }

    // Autoplay policy can hand back a suspended context even from a tap; without
    // this the graph never pulls and the take is silence.
    let resumeDeadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        resume,
        new Promise<never>((_, reject) => {
          resumeDeadline = setTimeout(
            () =>
              reject(
                new MicrophoneUnavailableError(
                  'Audio did not start. Return to this screen and try Record again.',
                ),
              ),
            5000,
          );
        }),
      ]);
    } finally {
      clearTimeout(resumeDeadline);
    }
    if (context.state !== 'running') {
      throw new MicrophoneUnavailableError(
        'Audio was interrupted. Return to this screen and try Record again.',
      );
    }

    const startedAt = new Date();

    async function teardown() {
      if (finished) {
        return;
      }
      finished = true;
      // Ask for the tail before disconnecting. The worklet holds up to 85 ms it
      // hasn't posted, which is the end of the last note played.
      try {
        await flush();
      } finally {
        node.port.onmessage = null;
        stopTracks();
        // A browser may have already shut down the graph on interruption.
        // Cleanup must not discard captured audio or leave an unhandled
        // rejection when cancel() is called during navigation.
        try { source.disconnect(); } catch { /* Already disconnected. */ }
        try { node.disconnect(); } catch { /* Already disconnected. */ }
        try { await context.close(); } catch { /* Already closed. */ }
      }
    }

    function flush(): Promise<void> {
      return new Promise((resolve) => {
        // A worklet that has already gone away would never answer, and a take
        // must not hang on its own teardown.
        const timer = setTimeout(finish, 250);
        function finish() {
          clearTimeout(timer);
          onFlushed = null;
          resolve();
        }
        onFlushed = finish;
        try {
          node.port.postMessage('flush');
        } catch {
          finish();
        }
      });
    }

    return {
      inputPeak: () => level.peak(),
      async stop(): Promise<Recording> {
        await teardown();

        const seconds = durationOf(chunks, sampleRate, CHANNELS);
        if (seconds === 0 || capturedNothing(level.peak())) {
          // **Two ways a take can hold nothing, and only one of them used to be
          // caught.** No samples at all means the graph never pulled. Samples
          // that are every one of them zero is a *muted* input — which is what
          // this error's own description has always claimed to cover, and did
          // not: `durationOf` counts them, so the take sailed through, uploaded,
          // waited, and came back `no_onsets` having spent one of three free
          // analyses for the month.
          throw new EmptyRecordingError();
        }

        return {
          audio: encodeWav({ chunks, sampleRate, channels: CHANNELS }),
          filename: takeFilename(startedAt),
          sampleRate,
          seconds,
          truncated,
        };
      },
      discardCapturedSoFar() {
        chunks.length = 0;
        level.reset();
        samples = 0;
        truncated = false;
      },
      cancel() {
        void teardown();
        chunks.length = 0;
        level.reset();
      },
    };
  } catch (error) {
    // Every setup failure must release the mic, including InvalidStateError
    // from graph creation. Otherwise the next attempt inherits a busy device.
    media?.getTracks().forEach((track) => track.stop());
    await context.close().catch(() => {});
    if (error instanceof DOMException && error.name === 'InvalidStateError') {
      throw new MicrophoneUnavailableError(
        'Audio was interrupted before recording could start. Return to this screen and try Record again.',
      );
    }
    throw error;
  }
}

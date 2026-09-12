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
import { audioContext } from './audio/context.web';
import { durationOf, encodeWav } from './audio/wav';
import { resolveWorkletUrl, WORKLET_FILE as WORKLET } from './audio/workletUrl';

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
 * Re-exported rather than declared: the name and the rule for resolving it now
 * live together in `audio/workletUrl.ts`, because getting the *name* right was
 * never the part that broke.
 */
export { WORKLET_FILE } from './audio/workletUrl';

/**
 * Quanta buffered in the worklet before it posts.
 *
 * `process` runs every 128 frames — 2.7 ms at 48 kHz, which is 375 messages a
 * second across the port if each one is sent. 32 quanta is 4096 frames, about
 * 85 ms, which is a message every twelfth of a second instead.
 */
const QUANTA_PER_MESSAGE = 32;

/**
 * Contexts that already have the recorder's processor registered.
 *
 * A `WeakSet` rather than a flag, because `audioContext()` replaces a context
 * that has somehow been closed — and the replacement has no processor. A flag
 * would say it did.
 */
const withWorklet = new WeakSet<BaseAudioContext>();

export async function startRecording(): Promise<Recorder> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new MicrophoneUnavailableError(
      'This browser has no microphone API. A secure origin is required.',
    );
  }


  /**
   * **The microphone first, the audio graph second — and that order is the
   * whole reason this function was rewritten.**
   *
   * It used to construct the `AudioContext` and `resume()` it before asking
   * for the microphone, to unlock audio while the Record tap still owned the
   * user gesture. On Chromium that is harmless and on WebKit it is fatal:
   * resuming a context claims a *playback* audio session, and the capture
   * request that follows has to take the session category away from it.
   * WebKit rejects that `getUserMedia` with `InvalidStateError`.
   *
   * **Reported from a real iPhone on 2026-09-12 and narrowed by elimination**,
   * because the first reading of it was wrong. The error says the document is
   * not fully active, so the screen advised a reload; reloading changed
   * nothing, which it could not, since the conflict is rebuilt on every tap.
   * It failed in Safari as well as in the home-screen app, so the standalone
   * context was not it either. It worked in Chromium on a desktop, and — the
   * measurement that settled it — the stock WebRTC `getUserMedia` sample
   * worked in Safari **on the same phone**. Plain capture is fine there. What
   * is not fine is capture behind a running `AudioContext`, which is ours.
   *
   * The gesture argument the old order rested on does not apply once the
   * microphone is granted: a successful `getUserMedia` is itself what unlocks
   * audio on iOS, so a context created after it starts unlocked rather than
   * needing the tap. The cost is that a refusal now happens before any graph
   * exists, which is also the honest shape — there is nothing to tear down.
   */
  let media: MediaStream;
  {
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
  }

  /** Release the device. Every failure past this point owes the mic back. */
  const releaseMicrophone = () =>
    media.getTracks().forEach((track) => track.stop());

  /**
   * **The app's one context, not a second one of our own.**
   *
   * `lib/audio/context.web.ts` opens by calling itself "the one `AudioContext`
   * this app ever creates in a browser", and explains why: iOS caps how many a
   * page may hold and `close()` does not reliably give the slot back, so the
   * next context is born suspended or never arrives — "the button works, the
   * schedule is built, every oscillator is created, and nothing comes out."
   *
   * That sentence was false. This function built its own with `new
   * AudioContext()`, so a musician who pressed Listen and then Record had two,
   * and the recorder was the thing that module was written to prevent. Its own
   * comment even lists "the microphone opening for a take" as something that
   * interrupts the shared one.
   *
   * It is also the other half of the `InvalidStateError` this file was fixed
   * for once already: a running playback context is what WebKit will not
   * reassign the audio session away from, and taking the microphone first only
   * helps when the running context is *ours*. Listen leaves the shared one
   * running, and nothing here could see it.
   */
  const context = audioContext();
  if (!context) {
    // The microphone is open by now, which it never was in the old order.
    // Leaving it open would light the recording indicator with nothing
    // recording, and leave the next attempt a busy device.
    releaseMicrophone();
    throw new MicrophoneUnavailableError(
      'Audio could not start. Close other audio apps, return here, and try Record again.',
    );
  }
  let resume: Promise<void> = Promise.resolve();
  try {
    if (context.state !== 'running') {
      // Handle rejection immediately, while the graph is still being built.
      resume = context.resume();
      void resume.catch(() => {});
    }
  } catch {
    releaseMicrophone();
    // Not closed: it is the app's one context and Listen needs it after this.
    throw new MicrophoneUnavailableError(
      'Audio could not start. Try Record again.',
    );
  }

  try {
    const chunks: Int16Array[] = [];
    const level = createPeakMeter();
    let truncated = false;
    let samples = 0;
    let finished = false;

    // `releaseMicrophone` above, named for where it is now needed first.
    const stopTracks = releaseMicrophone;

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
    // **Resolved from the app's root, never from the route.**
    //
    // This was the bare filename, left for `addModule` to resolve, on the
    // reasoning that a relative path is what a build served from a sub-path
    // needs. A relative URL resolves against the *document's* base, and this is
    // a single page app: on `/pieces/<id>/record` that is `/pieces/<id>/`. The
    // browser fetched `/pieces/<id>/pcm-recorder.worklet.js`, the server
    // answered with `index.html` as a single page app must, and `addModule` was
    // handed a page of HTML to parse as a module.
    //
    // It failed with a **200**, so there was no failed request and no console
    // error — only the sentence below, on the one screen whose job is to
    // record. The record screen is always nested under a piece, so this was
    // every take. See `audio/workletUrl.ts` for the measurements.
    // **Once per context, and the context now outlives the take.**
    //
    // `addModule` evaluates the module, and the module calls
    // `registerProcessor('pcm-recorder', ...)`. A second registration of the
    // same name throws `NotSupportedError`. That was unreachable while every
    // take built its own context and threw it away; sharing the app's one
    // context makes the *second* recording the failing one, which is the worst
    // shape a bug can have — the first take of a session works.
    try {
      if (!withWorklet.has(context)) {
        await context.audioWorklet.addModule(resolveWorkletUrl());
        withWorklet.add(context);
      }
    } catch {
      throw new MicrophoneUnavailableError(
        `The recording worklet (${WORKLET}) could not be loaded.`,
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
        // **The context is not closed.** It is shared with Listen and the
        // metronome, and closing it is the bug `lib/audio/context.web.ts`
        // exists to prevent — on iOS the slot does not reliably come back.
        // Disconnecting the two nodes above is what ends this take; a context
        // with nothing connected to its destination is silent and costs
        // nothing.
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
    releaseMicrophone();
    // Not closed — shared. See the teardown above.
    if (error instanceof DOMException && error.name === 'InvalidStateError') {
      throw new MicrophoneUnavailableError(
        'Audio was interrupted before recording could start. Return to this screen and try Record again.',
      );
    }
    throw error;
  }
}

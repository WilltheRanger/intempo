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
import { audioContext, releaseAudioSession } from './audio/context.web';
import { resumeToRunning } from './audio/running';
import { prepareForCapture, prepareForPlayback } from './audio/session.web';
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
   * **The microphone first, the audio graph second.**
   *
   * This order was arrived at as a fix for the `InvalidStateError` below and
   * **it was not the cause** — see the note on `prepareForCapture` further
   * down, and `audio/session.web.ts` for what was. It is kept because it is
   * the better shape on its own merits: a refusal now happens before any graph
   * exists, so there is nothing to tear down, and a successful `getUserMedia`
   * is itself what unlocks audio on iOS, so a context created after it starts
   * unlocked rather than needing the tap.
   *
   * **The paragraph that used to sit here claimed WebKit rejects capture made
   * behind a running `AudioContext`.** It does not, and no measurement ever
   * supported it: it was inferred from the error's name and shipped three
   * times. `MediaDevices::getUserMedia` reads a process-level *audio session
   * category*, which no `AudioContext` operation writes.
   */
  // **Suspend the shared context before capture.**
  //
  // Also not the cause — the sentence that stood here, that WebKit will not
  // take the session category away from a running playback context, was the
  // third wrong reading of this bug. It is kept because suspending a playback
  // graph the musician is not listening to, for the length of a take, costs
  // nothing and is tidy.
  //
  // Suspended, not closed: `close()` on iOS does not reliably return the
  // slot, which is `lib/audio/context.web.ts`'s founding argument. The resume
  // below brings it back once the microphone is in hand.
  //
  // **Despite its name it does not touch `navigator.audioSession`**, and that
  // gap is exactly how the fix before this one read as "handing the audio
  // session back" while leaving the category that was refusing capture set.
  await releaseAudioSession();

  // **Tell WebKit this page is about to record, because at boot it was told
  // the opposite.**
  //
  // `App.tsx` declares `navigator.audioSession.type = 'playback'` so the app
  // is audible on a phone whose ring switch is off, and WebKit honours that
  // literally: `getUserMedia` rejects every audio request with
  // `InvalidStateError` while a category override other than `PlayAndRecord`
  // is in force, before it reads a single constraint. That is the whole bug,
  // and `audio/session.web.ts` carries the guard's source and the reasoning.
  //
  // Ahead of both asks below, because the guard is what refuses them. The take
  // hands the category back in `teardown` — and every path that makes a sound
  // re-asserts `playback` before it plays anyway, which `session.reach.test.ts`
  // enforces, so a take that dies before `teardown` exists cannot leave the
  // page quiet.
  await prepareForCapture();

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
          // No take is starting, so the capture category has nothing to do:
          // give the page back the one it is audible under.
          void prepareForPlayback();
          throw microphoneFailure(retryError);
        }
      } else {
        // Every failure that was not a refusal used to become "No microphone is
        // available on this device.", on phones that plainly have one.
        // `microphoneFailure` names what actually happened.
        void prepareForPlayback();
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
  // Ask early so the context has the whole of the graph build to come back,
  // and never await it: `audio/running.ts` explains why the promise is a hint
  // and the state is the answer. Failures are swallowed for the same reason.
  try {
    if (context.state !== 'running') {
      void context.resume().catch(() => {});
    }
  } catch {
    // A synchronous throw here is not fatal on its own. The context may still
    // reach `running`, and the wait below is what decides. Throwing now would
    // refuse a take that was about to work, which is this file's old bug.
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

    // **Wait for the context to be running, not for `resume()` to say it is.**
    //
    // This raced the resume promise against a five second deadline, and that
    // is why takes failed on an iPhone with "Audio did not start" while the
    // microphone was open and the context was running: on iOS WebKit the
    // promise from `resume()` frequently never settles on a context that
    // reaches `running` anyway, so the deadline always won. Reproduced against
    // the old code with a context that behaves that way — it threw, with
    // `context.state === 'running'` at the moment it threw.
    //
    // The take cannot avoid this by resuming inside the gesture the way
    // playback does: `releaseAudioSession()` above suspends the context on
    // purpose before asking for the microphone, because WebKit will not
    // reassign the audio session away from a running one. See
    // `audio/running.ts`.
    if (!(await resumeToRunning(context))) {
      throw new MicrophoneUnavailableError(
        'Audio could not start. Close other audio apps, then try Record again.',
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
        // The take is over, so the recording category is too. `play-and-record`
        // costs output volume — the one true half of the comment that caused
        // this bug — and Listen on the verdict screen is usually the very next
        // sound this page makes.
        void prepareForPlayback();
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

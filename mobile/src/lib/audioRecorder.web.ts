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
import { audioContext, resumeAudio } from './audio/context.web';
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
const PROCESSOR_SOURCE = `
class PcmRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.port.onmessage = (event) => {
      if (event.data === 'flush') {
        this.flush();
        this.port.postMessage('flushed');
      }
    };
  }

  flush() {
    if (this.buffer.length === 0) {
      return;
    }
    let length = 0;
    for (const part of this.buffer) {
      length += part.length;
    }
    const out = new Int16Array(length);
    let offset = 0;
    for (const part of this.buffer) {
      out.set(part, offset);
      offset += part.length;
    }
    this.buffer = [];
    // Transferred, not copied — the main thread owns it after this.
    this.port.postMessage(out.buffer, [out.buffer]);
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) {
      // No input connected yet. Staying alive rather than returning false,
      // which would retire the processor for the rest of the take.
      return true;
    }
    const pcm = new Int16Array(channel.length);
    for (let i = 0; i < channel.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, channel[i]));
      pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    this.buffer.push(pcm);
    if (this.buffer.length >= ${QUANTA_PER_MESSAGE}) {
      this.flush();
    }
    return true;
  }
}

registerProcessor('pcm-recorder', PcmRecorder);
`;

/** Release a stream. Needed before `stopTracks` is in scope. */
function stopTracksOf(media: MediaStream): void {
  media.getTracks().forEach((track) => track.stop());
}

export async function startRecording(): Promise<Recorder> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new MicrophoneUnavailableError(
      'This browser has no microphone API. A secure origin is required.',
    );
  }


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

  let media: MediaStream;
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

  // **The page's one context, not a new one per take.**
  //
  // `lib/audio/context.web.ts` exists because a context per use is the
  // commonest "audio works once on iPhone" bug there is: Safari on iOS caps
  // how many a page may hold and `close()` does not reliably give the slot
  // back. Both *players* were moved onto the shared one; the recorder was
  // missed, so every take spent a slot that the players are also drawing from
  // — and the page runs out for all of them together.
  //
  // Resumed here because a context can be suspended by the autoplay policy and
  // *interrupted* by anything the operating system decides matters more — a
  // call, another app, the microphone opening, which is precisely what is
  // about to happen.
  const context = audioContext();
  if (!context) {
    stopTracksOf(media);
    throw new MicrophoneUnavailableError('This browser has no Web Audio.');
  }
  resumeAudio(context);

  const chunks: Int16Array[] = [];
  const level = createPeakMeter();
  let truncated = false;
  let samples = 0;
  let finished = false;

  const stopTracks = () => media.getTracks().forEach((track) => track.stop());

  if (!context.audioWorklet) {
    stopTracks();
    throw new MicrophoneUnavailableError(
      'This browser has no AudioWorklet, which is needed to record losslessly.',
    );
  }

  const moduleUrl = URL.createObjectURL(
    new Blob([PROCESSOR_SOURCE], { type: 'application/javascript' }),
  );
  try {
    await context.audioWorklet.addModule(moduleUrl);
  } catch {
    stopTracks();
    throw new MicrophoneUnavailableError(
      'The recording worklet could not be loaded.',
    );
  } finally {
    URL.revokeObjectURL(moduleUrl);
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

  // Autoplay policy can hand back a suspended context even from a tap; without
  // this the graph never pulls and the take is silence.
  if (context.state === 'suspended') {
    await context.resume();
  }

  const startedAt = new Date();

  async function teardown() {
    if (finished) {
      return;
    }
    finished = true;
    // Ask for the tail before disconnecting. The worklet holds up to 85 ms it
    // hasn't posted, which is the end of the last note played.
    await flush();
    source.disconnect();
    node.port.onmessage = null;
    node.disconnect();
    stopTracks();
    // **The context is not closed.** It is the page's, shared with both
    // players, and outlives every take — see `lib/audio/context.web.ts`.
    // Disconnecting the two nodes above is what ends this recording; closing
    // the mixer would end the next Listen too, and on iOS would not give the
    // slot back anyway.
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
      node.port.postMessage('flush');
    });
  }

  return {
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
}

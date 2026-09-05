import { AudioModule } from 'expo-audio';

import {
  EmptyRecordingError,
  maxTakeSamples,
  MicrophonePermissionError,
  takeFilename,
  type Recorder,
  type Recording,
} from './audio/types';
import { capturedNothing, createPeakMeter } from './audio/level';
import { durationOf, encodeWav } from './audio/wav';

/**
 * Audio capture for a practice take, on iOS and Android.
 *
 * Raw PCM off `expo-audio`'s `AudioStream`, not its `AudioRecorder`. The
 * recorder wraps `AVAudioRecorder` and `MediaRecorder`, and on Android that
 * means AAC — a codec that smears the note attacks this whole pipeline exists
 * to measure. The stream hands over untouched buffers on both platforms, so
 * both write the same WAV and neither is the compromised one.
 *
 * We ask for 16-bit at 48 kHz mono and then believe whatever the hardware
 * reports back: `stream.sampleRate` goes into the WAV header, so a device that
 * insists on 44.1 produces a correct file rather than one that plays 9% sharp.
 *
 * **Voice processing is off on both platforms**, which matters because auto
 * gain reshapes attack envelopes — the shape this app measures. iOS gets it
 * from `expo-audio` itself: `AudioStream.start()` sets the session to
 * `.record` with mode `.measurement`, which is precisely the mode that asks
 * for no system processing. Android does not: upstream opens `AudioRecord` on
 * `AudioSource.MIC`, which runs through the OEM's input chain. That one line
 * is patched — see `patches/expo-audio+57.0.3.patch` and `DECISIONS.md`.
 *
 * The session is `AudioStream`'s to configure, so nothing here calls
 * `setAudioModeAsync`: `start()` sets the category and mode itself and `stop()`
 * deactivates it, and a second opinion from this file would only race it.
 */

const REQUESTED_SAMPLE_RATE = 48000;
const CHANNELS = 1;

/** `AudioStream`'s buffer event. Not re-exported by the package's index. */
const AUDIO_STREAM_BUFFER = 'audioStreamBuffer';

interface StreamBuffer {
  data: ArrayBuffer;
  sampleRate: number;
  channels: number;
}

export async function startRecording(): Promise<Recorder> {
  const permission = await AudioModule.requestRecordingPermissionsAsync();
  if (!permission.granted) {
    throw new MicrophonePermissionError();
  }

  const stream = new AudioModule.AudioStream({
    sampleRate: REQUESTED_SAMPLE_RATE,
    channels: CHANNELS,
    encoding: 'int16',
  });

  const chunks: Int16Array[] = [];
  const level = createPeakMeter();
  let truncated = false;
  let maxSamples = maxTakeSamples(REQUESTED_SAMPLE_RATE, CHANNELS);
  let samples = 0;

  const subscription = stream.addListener(
    AUDIO_STREAM_BUFFER,
    (buffer: StreamBuffer) => {
      if (samples >= maxSamples) {
        truncated = true;
        return;
      }
      // Copy: the native side is free to reuse its buffer for the next quantum,
      // and a view over it would rewrite audio we have already banked.
      const chunk = new Int16Array(buffer.data.slice(0));
      level.observe(chunk);
      chunks.push(chunk);
      samples += chunk.length;
    },
  );

  const startedAt = new Date();
  try {
    await stream.start();
  } catch (error) {
    subscription.remove();
    throw error;
  }

  // Now that the hardware has answered, the cap is in its units rather than
  // the ones we asked for.
  const sampleRate = stream.sampleRate || REQUESTED_SAMPLE_RATE;
  const channels = stream.channels || CHANNELS;
  maxSamples = maxTakeSamples(sampleRate, channels);

  let finished = false;

  function teardown() {
    if (finished) {
      return;
    }
    finished = true;
    subscription.remove();
    // Releases the microphone and, on iOS, deactivates the audio session with
    // `notifyOthersOnDeactivation` — so whatever was playing before the take
    // gets its session back.
    stream.stop();
  }

  return {
    inputPeak: () => level.peak(),
    async stop(): Promise<Recording> {
      teardown();

      const seconds = durationOf(chunks, sampleRate, channels);
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
        audio: encodeWav({ chunks, sampleRate, channels }),
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
      teardown();
      chunks.length = 0;
      level.reset();
    },
  };
}

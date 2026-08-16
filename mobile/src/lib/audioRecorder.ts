import { AudioModule } from 'expo-audio';

import {
  EmptyRecordingError,
  MAX_TAKE_SECONDS,
  MicrophonePermissionError,
  takeFilename,
  type Recorder,
  type Recording,
} from './audio/types';
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
 * **Known gap.** The brief calls for the system's voice processing off —
 * echo cancellation, auto gain, noise suppression — because auto gain in
 * particular reshapes attack envelopes. On web that is three constraints on
 * `getUserMedia`. On native it needs `AVAudioSession` in `.measurement` mode,
 * which `expo-audio` does not expose; reaching it means a config plugin or a
 * patched module. Documented in `DECISIONS.md` rather than silently accepted.
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

  // iOS routes recording through the audio session, and it will not hand over
  // input at all unless the category allows it. `doNotMix` because a take with
  // another app's audio in it is not a take.
  await AudioModule.setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
    interruptionMode: 'doNotMix',
  });

  const stream = new AudioModule.AudioStream({
    sampleRate: REQUESTED_SAMPLE_RATE,
    channels: CHANNELS,
    encoding: 'int16',
  });

  const chunks: Int16Array[] = [];
  let truncated = false;
  let maxSamples = REQUESTED_SAMPLE_RATE * CHANNELS * MAX_TAKE_SECONDS;
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
  maxSamples = sampleRate * channels * MAX_TAKE_SECONDS;

  let finished = false;

  function teardown() {
    if (finished) {
      return;
    }
    finished = true;
    subscription.remove();
    stream.stop();
    // Hand the session back, so the next sound the phone makes isn't routed
    // through a recording category.
    void AudioModule.setAudioModeAsync({ allowsRecording: false });
  }

  return {
    async stop(): Promise<Recording> {
      teardown();

      const seconds = durationOf(chunks, sampleRate, channels);
      if (seconds === 0) {
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
    cancel() {
      teardown();
      chunks.length = 0;
    },
  };
}

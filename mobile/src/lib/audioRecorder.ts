/**
 * Audio capture for a practice take.
 *
 * **Not implemented, and deliberately not faked.** Everything either side of
 * it is real — the recording screen's state machine and timer, and
 * `submitTake`'s upload-then-enqueue against live endpoints. This is the one
 * gap, and it is a dependency decision rather than a design one:
 *
 *  - **Native** needs `expo-audio`. Record to WAV, not the platform default:
 *    AAC and Opus smear the transients the onset detector reads.
 *  - **Web** needs an `AudioWorklet` capturing raw Float32 PCM, written to WAV
 *    in the client. `MediaRecorder` is the obvious choice and the wrong one,
 *    for the same reason.
 *
 * On both, request the stream with the browser's voice processing off —
 * `echoCancellation`, `autoGainControl` and `noiseSuppression` all false. Auto
 * gain in particular reshapes attack envelopes, which is precisely what the
 * analysis measures.
 *
 * Constant input latency does not matter here: the pipeline compares onsets
 * within the recording against a tempo grid from the score, so a fixed delay
 * shifts everything equally and cancels. Jitter and dropped buffers do matter.
 */
export class AudioCaptureUnavailableError extends Error {
  constructor() {
    super('Recording needs an audio module that is not installed yet.');
    this.name = 'AudioCaptureUnavailableError';
  }
}

export interface Recorder {
  stop(): Promise<{ audio: Blob; filename: string }>;
}

export async function startRecording(): Promise<Recorder> {
  throw new AudioCaptureUnavailableError();
}

/** Whether a take can actually be captured on this build. */
export const CAN_RECORD = false;

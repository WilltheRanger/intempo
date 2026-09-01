import { createAnalysis, getAnalysis } from '../api/analyses';
import { requestAudioUpload, uploadToSignedUrl } from '../api/upload';
import { preferences } from '../preferences';
import type { AnalysisResponse, MetronomeMode } from '../types';

export interface TakeSubmissionState {
  /** Recording bytes already accepted by storage. */
  audioKey?: string;
  /** Analysis row already accepted by the API. */
  analysisId?: string;
}

/**
 * A failure that knows how far a take got.
 *
 * The recording screen keeps this state beside the WAV. Retrying after the
 * upload therefore reuses the object, and retrying after enqueue only resumes
 * polling the same analysis instead of creating a second one.
 */
export class TakeSubmissionError extends Error {
  constructor(
    message: string,
    readonly resume: TakeSubmissionState,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'TakeSubmissionError';
  }
}

export interface SubmitTakeInput {
  scoreId: string;
  targetBpm: number;
  metronomeMode: MetronomeMode;
  /** The recording. WAV keeps the transients the onset detector reads. */
  audio: Blob;
  filename: string;
  /**
   * Progress from an earlier attempt. Both fields are server-issued and may be
   * reused safely; absence means start that step.
   */
  resume?: TakeSubmissionState;
  /**
   * The take was played with runs of rest shortened, so the analysis has to
   * shorten the score the same way before it builds the timeline.
   *
   * **Not a display preference.** Measured on an otherwise perfect take,
   * skipping a rest the timeline still contains takes alignment quality from
   * 1.000 to 0.000 — `alignment_failed`, "check you're on the right piece" —
   * and that is as true of a two-bar rest as a twenty-bar one.
   */
  skipLongRests?: boolean;
}

export interface SubmittedTakeState extends TakeSubmissionState {
  analysisId: string;
}

/**
 * Uploads a take and enqueues its analysis, resuming completed steps.
 *
 * The upload permission is used only for PUT. The durable object key is sent
 * to the API and retained if enqueue fails, so a weak connection never makes
 * "Send it again" upload the whole WAV twice.
 */
export async function submitTake({
  scoreId,
  targetBpm,
  metronomeMode,
  audio,
  filename,
  resume = {},
  skipLongRests = false,
}: SubmitTakeInput): Promise<SubmittedTakeState> {
  const state: TakeSubmissionState = { ...resume };

  try {
    if (state.analysisId) {
      return { ...state, analysisId: state.analysisId };
    }

    if (!state.audioKey) {
      const upload = await requestAudioUpload(filename);
      await uploadToSignedUrl(upload.upload_url, audio, 'audio/wav');
      state.audioKey = upload.object_key;
    }

    const { analysis_id } = await createAnalysis({
      score_id: scoreId,
      audio_key: state.audioKey,
      target_bpm: targetBpm,
      // The recording screen sets the tempo directly. `calibration_clip` is
      // for the flow where a short clip infers it instead.
      bpm_source: 'manual',
      metronome_mode: metronomeMode,
      // Read here rather than threaded down from the recording screen: it is a
      // fact about the musician, not about this take.
      instrument: preferences.current().instrument,
      skip_long_rests: skipLongRests,
    });
    state.analysisId = analysis_id;
    return { ...state, analysisId: analysis_id };
  } catch (cause) {
    const message =
      cause instanceof Error
        ? cause.message
        : 'Your recording could not be sent. Check your connection and try again.';
    throw new TakeSubmissionError(message, state, cause);
  }
}

/** How often to ask whether the analysis has finished. */
const POLL_INTERVAL_MS = 1500;
/** Roughly a minute. The pipeline takes seconds; this is the give-up point. */
const MAX_POLLS = 40;

const FINISHED = new Set(['done', 'failed', 'failed_recoverable']);

/**
 * Waits for an analysis to finish.
 *
 * Polls rather than subscribes: the run is seconds long, and a websocket for
 * one short wait is infrastructure the app would otherwise not need.
 */
export async function waitForAnalysis(
  analysisId: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<AnalysisResponse> {
  for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
    if (signal?.aborted) {
      throw new Error('Cancelled');
    }
    const analysis = await getAnalysis(analysisId);
    if (FINISHED.has(analysis.status)) {
      return analysis;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error('The analysis is taking longer than expected.');
}

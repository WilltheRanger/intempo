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
  /**
   * Which bar the take started on, when it was not the first.
   *
   * **The same rule as `skipLongRests`**: the take was played against a
   * different score than the one on file, so the analysis has to judge it
   * against that one. Practising a passage is most of what practice is, and
   * until this existed a musician working on bar 40 had to play the preceding
   * thirty-nine to be told anything about it.
   */
  fromMeasure?: number | null;
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
  fromMeasure = null,
}: SubmitTakeInput): Promise<SubmittedTakeState> {
  const state: TakeSubmissionState = { ...resume };

  try {
    if (state.analysisId) {
      return { ...state, analysisId: state.analysisId };
    }

    if (!state.audioKey) {
      const upload = await requestAudioUpload(filename);
      await uploadToSignedUrl(upload.upload_url, audio, 'audio/wav', {
        subject: 'recording',
      });
      state.audioKey = upload.object_key;
    }

    const { analysis_id } = await createAnalysis({
      score_id: scoreId,
      audio_key: state.audioKey,
      target_bpm: targetBpm,
      // Always `manual`: the recording screen is the only place a tempo is
      // set, and it is typed. `calibration_clip` is the other value the column
      // accepts, for `POST /v1/calibration` — an endpoint that is built and
      // tested and that **no client calls**, so nothing has ever written that
      // value. This comment used to describe that flow in the present tense.
      // See `backend/app/tests/test_client_reachability.py`, which now fails
      // if a third such endpoint appears.
      bpm_source: 'manual',
      metronome_mode: metronomeMode,
      // Read here rather than threaded down from the recording screen: it is a
      // fact about the musician, not about this take.
      instrument: preferences.current().instrument,
      skip_long_rests: skipLongRests,
      // Omitted rather than sent as 1: a take from the top and a take that
      // happens to start at bar 1 are the same performance, and the column
      // is nullable so the row can say "from the beginning" rather than
      // claim a choice nobody made.
      ...(fromMeasure && fromMeasure > 1 ? { from_measure: fromMeasure } : {}),
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

/** How often to ask, while the answer is still likely to be seconds away. */
const POLL_INTERVAL_MS = 1500;

/**
 * And after that.
 *
 * **A take can now wait behind another one.** The backend runs
 * `ANALYSIS_MAX_CONCURRENT` analyses at a time — one, because `analyze()`
 * peaks near 460 MB on a 512 MB instance — so a second musician finishing a
 * take while the first is being judged is queued rather than run, which is the
 * whole point of the bound. The old flat 1.5s for forty attempts gave up after
 * **sixty seconds**, and a queue two deep can exceed that while the server is
 * working perfectly.
 *
 * Easing off rather than simply raising the count, because the two costs pull
 * opposite ways: a musician wants the verdict the moment it exists, and every
 * waiting client is asking this API 40 times a minute. Quick while the answer
 * is plausibly imminent, patient afterwards.
 */
const SLOW_POLL_INTERVAL_MS = 4000;

/** How many quick ones before easing off. Fifteen seconds of them. */
const FAST_POLLS = 10;

/**
 * The give-up point: **just under three minutes** (10x1.5s + 41x4s = 179s),
 * against sixty seconds before, for eleven more requests rather than the
 * hundred and nineteen a flat 1.5s would have cost to wait as long.
 *
 * Giving up is not losing the take. The row and the audio are durable, the id
 * is remembered by `rememberPendingAnalysis`, and "Send it again" resumes this
 * poll instead of uploading the recording twice — see `apiPracticeSource`.
 */
const MAX_POLLS = 51;

/** Quick while the answer is plausibly imminent, patient afterwards. */
function pollDelayMs(attempt: number): number {
  return attempt < FAST_POLLS ? POLL_INTERVAL_MS : SLOW_POLL_INTERVAL_MS;
}

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
    await new Promise((resolve) => setTimeout(resolve, pollDelayMs(attempt)));
  }
  throw new Error('The analysis is taking longer than expected.');
}

import { createAnalysis, getAnalysis } from '../api/analyses';
import { requestAudioUpload, uploadToSignedUrl } from '../api/upload';
import { preferences } from '../preferences';
import type { AnalysisResponse, MetronomeMode } from '../types';

export interface SubmitTakeInput {
  scoreId: string;
  targetBpm: number;
  metronomeMode: MetronomeMode;
  /** The recording. WAV keeps the transients the onset detector reads. */
  audio: Blob;
  filename: string;
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

/**
 * Uploads a take and enqueues its analysis.
 *
 * Three real calls: a presigned URL, a PUT straight to storage, then the row.
 * Audio never streams through the API — the backend checks the URL is under
 * this user's prefix and refuses anything else, so the worker can trust the
 * address it stored.
 */
export async function submitTake({
  scoreId,
  targetBpm,
  metronomeMode,
  audio,
  filename,
  skipLongRests = false,
  fromMeasure = null,
}: SubmitTakeInput): Promise<string> {
  const upload = await requestAudioUpload(filename);
  await uploadToSignedUrl(upload.upload_url, audio, 'audio/wav');

  const { analysis_id } = await createAnalysis({
    score_id: scoreId,
    audio_url: upload.upload_url,
    target_bpm: targetBpm,
    // The recording screen sets the tempo directly. `calibration_clip` is for
    // the flow where a short clip infers it instead.
    bpm_source: 'manual',
    metronome_mode: metronomeMode,
    // Read here rather than threaded down from the recording screen: it is a
    // fact about the musician, not about this take, and every caller would
    // otherwise have to remember to pass it.
    //
    // Always sent, including when nobody has changed it. The default is violin
    // and Profile displays it as the musician's instrument, so sending it is
    // reporting what the app already says about them rather than guessing on
    // their behalf.
    instrument: preferences.current().instrument,
    skip_long_rests: skipLongRests,
    // Omitted rather than sent as 1: a take from the top and a take that
    // happens to start at bar 1 are the same performance, and the column is
    // nullable so the row can say "from the beginning" rather than claim a
    // choice nobody made.
    ...(fromMeasure && fromMeasure > 1 ? { from_measure: fromMeasure } : {}),
  });
  return analysis_id;
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

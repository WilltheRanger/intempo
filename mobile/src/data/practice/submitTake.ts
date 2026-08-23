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

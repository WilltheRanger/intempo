import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createAnalysis, getAnalysis, requestAudioUpload, uploadToSignedUrl, current } =
  vi.hoisted(() => ({
    createAnalysis: vi.fn(),
    getAnalysis: vi.fn(),
    requestAudioUpload: vi.fn(),
    uploadToSignedUrl: vi.fn(),
    current: vi.fn(),
  }));

vi.mock('../api/analyses', () => ({ createAnalysis, getAnalysis }));
vi.mock('../api/upload', () => ({ requestAudioUpload, uploadToSignedUrl }));
vi.mock('../preferences', () => ({ preferences: { current } }));

import { submitTake, waitForAnalysis } from './submitTake';

/**
 * Sending a take, and waiting for the answer.
 *
 * Three real calls and a poll. The part worth pinning is the **instrument**:
 * it is read here rather than threaded down from the recording screen, and it
 * decides how the pipeline looks for onsets. A double bass needs a lower
 * threshold, because the note swells in rather than snapping in. If it stopped
 * being sent, every bassist would be analysed as a violinist and the only
 * symptom would be worse verdicts.
 */

const TAKE = {
  scoreId: 'score-1',
  targetBpm: 88,
  metronomeMode: 'off' as const,
  audio: new Blob(['pretend wav']),
  filename: 'take-2026-05-17.wav',
};

beforeEach(() => {
  vi.clearAllMocks();
  current.mockReturnValue({ instrument: 'double_bass' });
  requestAudioUpload.mockResolvedValue({ upload_url: 'https://storage.example/put?t=1' });
  uploadToSignedUrl.mockResolvedValue(undefined);
  createAnalysis.mockResolvedValue({ analysis_id: 'analysis-9' });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('submitTake', () => {
  it('sends the instrument the musician plays', async () => {
    await submitTake(TAKE);

    expect(createAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ instrument: 'double_bass' }),
    );
  });

  it('sends it even when nobody has changed it from the default', async () => {
    // "The default is violin and Profile displays it as the musician's
    // instrument, so sending it is reporting what the app already says about
    // them rather than guessing on their behalf."
    current.mockReturnValue({ instrument: 'violin' });

    await submitTake(TAKE);

    expect(createAnalysis.mock.calls[0][0].instrument).toBe('violin');
  });

  it('uploads to storage and points the row at the same URL', async () => {
    // Audio never streams through the API. The backend checks the URL is under
    // this user's prefix, so the worker can trust the address it stored.
    await submitTake(TAKE);

    expect(requestAudioUpload).toHaveBeenCalledWith('take-2026-05-17.wav');
    expect(uploadToSignedUrl).toHaveBeenCalledWith(
      'https://storage.example/put?t=1',
      TAKE.audio,
      'audio/wav',
    );
    expect(createAnalysis.mock.calls[0][0].audio_url).toBe('https://storage.example/put?t=1');
  });

  it('says the tempo came from the musician, not from a clip', async () => {
    await submitTake(TAKE);

    expect(createAnalysis.mock.calls[0][0]).toMatchObject({
      score_id: 'score-1',
      target_bpm: 88,
      bpm_source: 'manual',
      metronome_mode: 'off',
    });
  });

  it('does not create a row when the upload failed', async () => {
    // A row pointing at audio that was never stored is a take that fails in
    // the worker minutes later, reported as `audio_unavailable`.
    uploadToSignedUrl.mockRejectedValue(new Error('Storage refused the page (500). Try again.'));

    await expect(submitTake(TAKE)).rejects.toThrow(/storage refused/i);
    expect(createAnalysis).not.toHaveBeenCalled();
  });

  it('returns the id to poll', async () => {
    await expect(submitTake(TAKE)).resolves.toBe('analysis-9');
  });
});

describe('waitForAnalysis', () => {
  it('returns as soon as the run has finished', async () => {
    getAnalysis.mockResolvedValue({ id: 'a', status: 'done' });

    await expect(waitForAnalysis('a')).resolves.toMatchObject({ status: 'done' });
    expect(getAnalysis).toHaveBeenCalledTimes(1);
  });

  it.each(['failed', 'failed_recoverable'])('stops on %s rather than waiting it out', async (status) => {
    getAnalysis.mockResolvedValue({ id: 'a', status });

    await expect(waitForAnalysis('a')).resolves.toMatchObject({ status });
    expect(getAnalysis).toHaveBeenCalledTimes(1);
  });

  it('keeps asking while the run is still going', async () => {
    vi.useFakeTimers();
    getAnalysis
      .mockResolvedValueOnce({ id: 'a', status: 'queued' })
      .mockResolvedValueOnce({ id: 'a', status: 'processing' })
      .mockResolvedValue({ id: 'a', status: 'done' });

    const promise = waitForAnalysis('a');
    await vi.advanceTimersByTimeAsync(1500 * 3);

    await expect(promise).resolves.toMatchObject({ status: 'done' });
    expect(getAnalysis).toHaveBeenCalledTimes(3);
  });

  it('gives up rather than polling forever', async () => {
    vi.useFakeTimers();
    getAnalysis.mockResolvedValue({ id: 'a', status: 'processing' });

    const promise = waitForAnalysis('a');
    const settled = expect(promise).rejects.toThrow(/longer than expected/i);
    await vi.advanceTimersByTimeAsync(1500 * 45);

    await settled;
    expect(getAnalysis).toHaveBeenCalledTimes(40);
  });

  it('stops when the caller has walked away', async () => {
    const controller = new AbortController();
    controller.abort();
    getAnalysis.mockResolvedValue({ id: 'a', status: 'processing' });

    await expect(waitForAnalysis('a', { signal: controller.signal })).rejects.toThrow(
      /cancelled/i,
    );
    expect(getAnalysis).not.toHaveBeenCalled();
  });
});

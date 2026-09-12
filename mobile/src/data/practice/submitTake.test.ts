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
  requestAudioUpload.mockResolvedValue({
    upload_url: 'https://storage.example/put?t=1',
    object_key: 'user-1/take.wav',
  });
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

  it('uses the upload URL only for PUT and sends the durable key', async () => {
    // The five-minute upload permission is not a download URL and must never
    // be what the analysis row depends on.
    await submitTake(TAKE);

    expect(requestAudioUpload).toHaveBeenCalledWith('take-2026-05-17.wav');
    expect(uploadToSignedUrl).toHaveBeenCalledWith(
      'https://storage.example/put?t=1',
      TAKE.audio,
      'audio/wav',
      { subject: 'recording' },
    );
    expect(createAnalysis.mock.calls[0][0].audio_key).toBe('user-1/take.wav');
    expect(createAnalysis.mock.calls[0][0]).not.toHaveProperty('audio_url');
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

  it('returns the durable progress needed to resume', async () => {
    await expect(submitTake(TAKE)).resolves.toEqual({
      audioKey: 'user-1/take.wav',
      analysisId: 'analysis-9',
    });
  });

  it('does not upload the WAV again after storage already accepted it', async () => {
    await submitTake({
      ...TAKE,
      resume: { audioKey: 'user-1/already-there.wav' },
    });

    expect(requestAudioUpload).not.toHaveBeenCalled();
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
    expect(createAnalysis.mock.calls[0][0].audio_key).toBe(
      'user-1/already-there.wav',
    );
  });

  it('does not enqueue again when the analysis id is already known', async () => {
    await expect(
      submitTake({
        ...TAKE,
        resume: {
          audioKey: 'user-1/already-there.wav',
          analysisId: 'analysis-existing',
        },
      }),
    ).resolves.toEqual({
      audioKey: 'user-1/already-there.wav',
      analysisId: 'analysis-existing',
    });

    expect(requestAudioUpload).not.toHaveBeenCalled();
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
    expect(createAnalysis).not.toHaveBeenCalled();
  });

  it('carries the accepted object key when enqueue fails', async () => {
    createAnalysis.mockRejectedValue(new Error('Connection dropped'));

    const failure = submitTake(TAKE);
    await expect(failure).rejects.toMatchObject({
      message: 'Connection dropped',
      resume: { audioKey: 'user-1/take.wav' },
    });
  });
});

/**
 * The rejection, as a value.
 *
 * `expect(promise).rejects` is left hanging while fake timers are advanced,
 * and vitest warns that a future major will fail on it. Attaching the handler
 * at creation keeps the promise handled from the first tick.
 */
function _rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('it resolved; it was supposed to give up');
    },
    (cause: unknown) => cause,
  );
}

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
    // Past the whole budget: 10 quick polls, then 41 slow ones.
    await vi.advanceTimersByTimeAsync(200_000);

    await settled;
    expect(getAnalysis).toHaveBeenCalledTimes(51);
  });

  it('waits nearly three minutes, because a take can be queued behind another', async () => {
    // **The bound on the server is what this number answers to.** Analyses run
    // one at a time in-process (`ANALYSIS_MAX_CONCURRENT`), so a second
    // musician finishing a take while the first is being judged waits for it.
    // At the old flat sixty seconds a queue two deep timed out while the
    // server was working perfectly — and giving up looks the same to a
    // musician whether or not the row eventually completes.
    vi.useFakeTimers();
    getAnalysis.mockResolvedValue({ id: 'a', status: 'queued' });

    const settled = _rejection(waitForAnalysis('a'));

    // Well past the old sixty-second ceiling, and still asking.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(getAnalysis).toHaveBeenCalledTimes(37);

    await vi.advanceTimersByTimeAsync(80_000);
    expect(String(await settled)).toMatch(/longer than expected/i);
    expect(getAnalysis).toHaveBeenCalledTimes(51);
  });

  it('eases off rather than asking every 1.5s for three minutes', async () => {
    // Every waiting client is load on one API. Flat-1.5s patience of this
    // length would be 119 requests a take; this is 51.
    vi.useFakeTimers();
    getAnalysis.mockResolvedValue({ id: 'a', status: 'processing' });

    const settled = _rejection(waitForAnalysis('a'));

    // Ten quick gaps after the first ask, so eleven asks inside fifteen
    // seconds — the window where a musician is still looking at the screen.
    await vi.advanceTimersByTimeAsync(1500 * 10);
    expect(getAnalysis).toHaveBeenCalledTimes(11);

    // The twelfth is 4s away, not 1.5s.
    await vi.advanceTimersByTimeAsync(1500);
    expect(getAnalysis).toHaveBeenCalledTimes(11);
    await vi.advanceTimersByTimeAsync(2500);
    expect(getAnalysis).toHaveBeenCalledTimes(12);

    await vi.advanceTimersByTimeAsync(200_000);
    expect(String(await settled)).toMatch(/longer than expected/i);
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

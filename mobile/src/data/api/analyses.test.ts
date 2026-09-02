import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('./client', () => ({ apiFetch }));

import { getAnalysisRecording } from './analyses';

describe('saved take playback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks for a fresh private URL instead of retaining the upload URL', async () => {
    apiFetch.mockResolvedValue({
      url: 'https://storage.test/take.wav?token=fresh',
      expires_in: 3600,
    });

    await expect(getAnalysisRecording('take-123')).resolves.toEqual({
      url: 'https://storage.test/take.wav?token=fresh',
      expires_in: 3600,
    });
    expect(apiFetch).toHaveBeenCalledWith(
      '/v1/analyses/take-123/recording',
    );
  });
});

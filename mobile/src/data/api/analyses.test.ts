import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('./client', () => ({ apiFetch }));

import { getAnalysisRecording, listAnalyses } from './analyses';

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

describe('asking for the takes without the analysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiFetch.mockResolvedValue([]);
  });

  it('says nothing when the analysis is wanted, so an older server is unchanged', async () => {
    // The parameter defaults to true on the server. Sending `true` explicitly
    // would be harmless there and is still the wrong instinct: a deployment
    // that has never heard of the name is what this has to keep working, and
    // the way to do that is not to mention it.
    await listAnalyses({ limit: 5 });

    const [path] = apiFetch.mock.calls[0];
    expect(path).not.toContain('include_result');
  });

  it('asks the server not to send it, rather than throwing it away here', async () => {
    // The saving is the database read and the transfer, not the parse. A
    // client that fetched 10 MB and kept two fields would have saved nothing
    // that is billed.
    await listAnalyses({ limit: 200, includeResult: false });

    const [path] = apiFetch.mock.calls[0];
    expect(path).toContain('include_result=false');
    expect(path).toContain('limit=200');
  });
});

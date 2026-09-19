import { describe, expect, it, vi } from 'vitest';

const { getAnalysis } = vi.hoisted(() => ({ getAnalysis: vi.fn() }));

vi.mock('../api/analyses', () => ({ getAnalysis }));
vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(readonly status: number) {
      super(`Request failed (${status})`);
    }
  },
}));

import { ApiError } from '../api/client';
import { readPendingAnalysisStatus } from './pendingAnalysisStatus';

describe('pending analysis status', () => {
  it.each(['queued', 'processing'])(
    'treats %s as work still in progress',
    async (status) => {
      getAnalysis.mockResolvedValueOnce({ status });
      await expect(readPendingAnalysisStatus('analysis-1')).resolves.toBe('working');
    },
  );

  it.each(['done', 'failed', 'failed_recoverable'])(
    'makes a %s result available to open',
    async (status) => {
      getAnalysis.mockResolvedValueOnce({ status });
      await expect(readPendingAnalysisStatus('analysis-1')).resolves.toBe('ready');
    },
  );

  it('recognises a hand-off that no longer exists', async () => {
    getAnalysis.mockRejectedValueOnce(new ApiError(404, '/v1/analyses/old', 'Missing'));
    await expect(readPendingAnalysisStatus('analysis-old')).resolves.toBe('missing');
  });

  it('does not disguise a connection failure as a missing result', async () => {
    const failure = new Error('No connection');
    getAnalysis.mockRejectedValueOnce(failure);
    await expect(readPendingAnalysisStatus('analysis-1')).rejects.toBe(failure);
  });
});

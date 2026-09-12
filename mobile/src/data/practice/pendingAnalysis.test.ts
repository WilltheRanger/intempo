import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: async (key: string) => {
      store.delete(key);
    },
  },
}));

import {
  forgetPendingAnalysis,
  hydratePendingAnalysis,
  pendingAnalysis,
  rememberPendingAnalysis,
} from './pendingAnalysis';

const KEY = 'intempo.pending-analysis.v1';
const TAKE = {
  analysisId: 'analysis-9',
  scoreId: 'score-3',
  createdAt: 1_788_300_000_000,
};

beforeEach(async () => {
  store.clear();
  await hydratePendingAnalysis();
});

describe('pending analysis recovery', () => {
  it('survives a complete app reload', async () => {
    await rememberPendingAnalysis(TAKE);
    expect(store.get(KEY)).toBe(JSON.stringify(TAKE));

    await hydratePendingAnalysis();

    expect(pendingAnalysis.current()).toEqual(TAKE);
  });

  it('does not trust a corrupt or partial stored hand-off', async () => {
    store.set(KEY, JSON.stringify({ analysisId: 'analysis-9' }));

    await hydratePendingAnalysis();

    expect(pendingAnalysis.current()).toBeNull();
    await vi.waitFor(() => expect(store.has(KEY)).toBe(false));
  });

  it('clears the result after the musician opens it', async () => {
    await rememberPendingAnalysis(TAKE);

    await forgetPendingAnalysis(TAKE.analysisId);

    expect(pendingAnalysis.current()).toBeNull();
    expect(store.has(KEY)).toBe(false);
  });

  it('cannot let an older request erase a newer take', async () => {
    await rememberPendingAnalysis(TAKE);
    await rememberPendingAnalysis({
      ...TAKE,
      analysisId: 'analysis-new',
      createdAt: TAKE.createdAt + 1,
    });

    await forgetPendingAnalysis(TAKE.analysisId);

    expect(pendingAnalysis.current()?.analysisId).toBe('analysis-new');
    expect(store.get(KEY)).toContain('analysis-new');
  });
});

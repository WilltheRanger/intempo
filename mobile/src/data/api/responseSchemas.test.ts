import { describe, expect, it } from 'vitest';

import { parseAnalysis, parseMe } from './responseSchemas';

const accountId = '550e8400-e29b-41d4-a716-446655440000';

describe('critical API responses', () => {
  it('rejects a malformed account tier before the UI treats it as an entitlement', () => {
    expect(() => parseMe({ id: accountId, tier: 'unlimited' }))
      .toThrow('unexpected account response');
  });

  it('accepts a complete account response', () => {
    const response = {
      id: accountId, email: 'player@example.com', tier: 'free', role: 'student',
      studio_id: null, analyses: { used: 1, limit: 3, remaining: 2, resets_at: '2026-10-01T00:00:00Z' },
      instrument: 'violin', display_name: null, avatar_url: null,
      onboarded_at: null, training_consent: false,
    };
    expect(parseMe(response).tier).toBe('free');
  });

  it('rejects an unknown analysis status instead of polling forever', () => {
    expect(() => parseAnalysis({ id: accountId, status: 'mystery' }))
      .toThrow('unexpected analysis response');
  });
});

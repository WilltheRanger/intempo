import { describe, expect, it } from 'vitest';

import type { MeResponse } from '../types';
import { toMusician } from './api';

function account(training_consent: boolean): MeResponse {
  return {
    id: 'musician-1',
    email: 'alex@example.com',
    tier: 'free',
    role: 'student',
    studio_id: null,
    analyses: null,
    instrument: 'double_bass',
    display_name: 'Alex',
    avatar_url: null,
    onboarded_at: '2026-09-01T00:00:00Z',
    training_consent,
  };
}

describe('account training consent', () => {
  it('maps explicit consent into the profile view model', () => {
    expect(toMusician(account(true), null).trainingConsent).toBe(true);
  });

  it('keeps declined or withdrawn consent off', () => {
    expect(toMusician(account(false), null).trainingConsent).toBe(false);
  });
});

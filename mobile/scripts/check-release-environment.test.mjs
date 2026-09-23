import { test } from 'vitest';
import assert from 'node:assert/strict';
import { releaseProblems } from './check-release-environment.mjs';
const env = { EAS_BUILD_PROFILE: 'production', EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  EXPO_PUBLIC_API_BASE_URL: 'https://api.example.org', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_test',
  EXPO_PUBLIC_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
  SENTRY_AUTH_TOKEN: 'token-for-test-only', SENTRY_ORG: 'intempo', SENTRY_PROJECT: 'mobile' };
test('permits local previews but blocks missing store settings', () => {
  assert.deepEqual(releaseProblems({}), []);
  assert.ok(releaseProblems({ EAS_BUILD_PROFILE: 'production' }).length >= 3);
  assert.ok(releaseProblems({ EAS_BUILD_PROFILE: 'testflight' }).length >= 3);
});
test('accepts configured release and rejects secrets, fixtures and insecure URLs', () => {
  assert.deepEqual(releaseProblems(env), []);
  for (const change of [{ EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_do-not-log' },
    { EXPO_PUBLIC_API_BASE_URL: 'http://localhost:8000' }, { EXPO_PUBLIC_FIXTURES: 'empty' },
    { EXPO_PUBLIC_SENTRY_DSN: 'http://localhost/1' }, { SENTRY_AUTH_TOKEN: '' }]) {
    assert.ok(releaseProblems({ ...env, ...change }).length > 0);
  }
});

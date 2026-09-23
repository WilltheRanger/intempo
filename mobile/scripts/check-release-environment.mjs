import { pathToFileURL } from 'node:url';

export function releaseProblems(env) {
  if (!['production', 'testflight'].includes(env.EAS_BUILD_PROFILE)) return [];
  const problems = [];
  for (const name of ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_API_BASE_URL']) {
    try {
      const url = new URL(env[name]);
      if (url.protocol !== 'https:' || url.username || url.password
        || url.hostname === 'localhost' || url.hostname === '127.0.0.1') throw new Error();
    } catch { problems.push(`${name} must be a real HTTPS service URL.`); }
  }
  const key = env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!key) problems.push('EXPO_PUBLIC_SUPABASE_ANON_KEY is required.');
  else if (key.startsWith('sb_secret_')) problems.push('Use a public Supabase key, never a secret key.');
  else if (!key.startsWith('sb_publishable_')) {
    try {
      const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
      if (claims.role !== 'anon') throw new Error();
    } catch { problems.push('The Supabase key must be a publishable key or anon JWT.'); }
  }
  if (env.EXPO_PUBLIC_FIXTURES) problems.push('Remove EXPO_PUBLIC_FIXTURES from store builds.');
  try {
    const dsn = new URL(env.EXPO_PUBLIC_SENTRY_DSN);
    if (dsn.protocol !== 'https:' || !dsn.hostname || !dsn.username) throw new Error();
  } catch { problems.push('EXPO_PUBLIC_SENTRY_DSN must be a valid HTTPS Sentry DSN.'); }
  if (!env.SENTRY_AUTH_TOKEN?.trim()) {
    problems.push('SENTRY_AUTH_TOKEN is required for release source maps.');
  }
  if (!env.SENTRY_ORG?.trim() || !env.SENTRY_PROJECT?.trim()) {
    problems.push('SENTRY_ORG and SENTRY_PROJECT are required for release source maps.');
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = releaseProblems(process.env);
  for (const problem of problems) console.error(problem); // Never print values.
  if (problems.length) process.exitCode = 1;
}

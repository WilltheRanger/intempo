import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The switch that decides whether this build reads real data or sample data.
 *
 * It replaced a hardcoded `USE_FIXTURES = true`, which the module calls "a
 * loaded gun": flipping it and pushing would have shipped the live site
 * pointed at `http://127.0.0.1:8000`. Getting this wrong is silent in the
 * worst direction — a production build serving seeded pieces looks like a
 * working app.
 *
 * Read at module load, so every case imports it fresh.
 */

const VARS = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'EXPO_PUBLIC_API_BASE_URL',
] as const;

const saved: Record<string, string | undefined> = {};

async function load(env: Partial<Record<(typeof VARS)[number], string>>) {
  vi.resetModules();
  for (const name of VARS) {
    if (name in env) {
      process.env[name] = env[name];
    } else {
      delete process.env[name];
    }
  }
  return import('./environment');
}

beforeEach(() => {
  for (const name of VARS) {
    saved[name] = process.env[name];
  }
});

afterEach(() => {
  for (const name of VARS) {
    if (saved[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = saved[name];
    }
  }
  vi.resetModules();
});

const ALL = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://p.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  EXPO_PUBLIC_API_BASE_URL: 'https://api.example.test',
};

describe('IS_LIVE_BACKEND', () => {
  it('is true only when all three are given', async () => {
    expect((await load(ALL)).IS_LIVE_BACKEND).toBe(true);
  });

  it('is false when any one of them is missing', async () => {
    // Each for its own reason: without the Supabase pair there is no session
    // and so no bearer token; without the API host `api/client.ts` falls back
    // to localhost, which exists only on a developer's laptop.
    for (const name of VARS) {
      const partial = { ...ALL };
      delete (partial as Record<string, string>)[name];

      expect((await load(partial)).IS_LIVE_BACKEND, `without ${name}`).toBe(false);
    }
  });

  it('treats an empty string as not given', async () => {
    // **The docstring used to claim this was "explicit presence, not
    // truthiness".** It is truthiness, and truthiness is the safer of the
    // two: an explicit-presence rule would read `EXPO_PUBLIC_API_BASE_URL=""`
    // as a backend having been named and send a production build at the
    // localhost fallback. This pins the behaviour the code actually has.
    expect(
      (await load({ ...ALL, EXPO_PUBLIC_API_BASE_URL: '' })).IS_LIVE_BACKEND,
    ).toBe(false);
  });
});

describe('describeFixtureReason', () => {
  it('says nothing when the build is live', async () => {
    expect((await load(ALL)).describeFixtureReason()).toBeNull();
  });

  it('names the one variable that is missing, in the singular', async () => {
    // "it silently fell back" is the failure this module exists to prevent,
    // so the sentence has to name the var rather than leave it to be guessed.
    const partial = { ...ALL };
    delete (partial as Record<string, string>).EXPO_PUBLIC_API_BASE_URL;

    const said = (await load(partial)).describeFixtureReason();

    expect(said).toContain('EXPO_PUBLIC_API_BASE_URL');
    expect(said).toContain(' is not set.');
    expect(said).not.toContain('EXPO_PUBLIC_SUPABASE_URL');
  });

  it('names all of them, in the plural, when nothing is configured', async () => {
    const said = (await load({})).describeFixtureReason();

    for (const name of VARS) {
      expect(said).toContain(name);
    }
    expect(said).toContain(' are not set.');
  });
});

describe('how the variables are read', () => {
  it('spells each one out in full, and never destructures process.env', async () => {
    // **The rule with the worst failure mode in this file**, and nothing
    // enforced it. Expo substitutes `process.env.EXPO_PUBLIC_…` textually at
    // build time, so `const { EXPO_PUBLIC_API_BASE_URL } = process.env` reads
    // an empty object in the bundle — and a correctly-configured production
    // build silently serves sample data. Every screen would look fine.
    //
    // A source check because the failure only exists in a real Expo bundle:
    // under vitest, `process.env` is a live object and a destructured read
    // works, so no behavioural test here can see it.
    const source: string = (
      await import('./environment?raw')
    ).default as unknown as string;

    for (const name of VARS) {
      expect(source, `${name} must be read as a full literal`).toContain(
        `process.env.${name}`,
      );
    }
    expect(source).not.toMatch(/(const|let|var)\s*\{[^}]*\}\s*=\s*process\.env/);
  });
});

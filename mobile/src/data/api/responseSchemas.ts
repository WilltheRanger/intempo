import type { AnalysisResponse, MeResponse } from '../types';

/**
 * The two responses the app acts on before a musician sees anything — an
 * analysis's status, and an account's tier — checked before they are trusted.
 *
 * **Written out rather than declared with a schema library.** This file was
 * first built on `zod`, and Metro, which bundles the web app, does not drop
 * unused code: the whole library shipped, 805 KB of source, to check three
 * shapes, and put the page every musician loads 78 KB over its budget. The
 * rules are the ones those schemas held — `zod`'s own UUID and email patterns
 * included — and were compared against them input for input when this was
 * written.
 *
 * A failure never names the value, because the response may be account data
 * and the message reaches the screen.
 */

type Check = (value: unknown) => boolean;

/** `zod` 4's UUID pattern: any RFC 9562 version, plus the nil and max UUIDs. */
const UUID =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;

/** `zod` 4's default email pattern (a trailing `-` in a class is literal). */
const EMAIL =
  /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

const isString: Check = (value) => typeof value === 'string';
const isBoolean: Check = (value) => typeof value === 'boolean';
/** Finite: a tempo of `Infinity` is not a tempo. */
const isNumber: Check = (value) =>
  typeof value === 'number' && Number.isFinite(value);
const isCount: Check = (value) =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const isUuid: Check = (value) => isString(value) && UUID.test(value as string);
const isEmail: Check = (value) => isString(value) && EMAIL.test(value as string);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const nullable =
  (check: Check): Check =>
  (value) =>
    value === null || check(value);

const oneOf =
  (...allowed: string[]): Check =>
  (value) =>
    typeof value === 'string' && allowed.includes(value);

/** Every named field present and valid. Fields not named pass through. */
const shape =
  (fields: Record<string, Check>): Check =>
  (value) =>
    isObject(value) &&
    Object.entries(fields).every(([key, check]) => check(value[key]));

const instrument = oneOf('violin', 'viola', 'cello', 'double_bass');

const analysis = shape({
  id: isUuid,
  user_id: isUuid,
  score_id: isUuid,
  status: oneOf('queued', 'processing', 'done', 'failed', 'failed_recoverable'),
  target_bpm: isNumber,
  bpm_source: isString,
  metronome_mode: oneOf('off', 'visual', 'haptic', 'audio_with_headphones'),
  instrument: nullable(instrument),
  result_json: nullable(isObject),
  failure_reason: nullable(isString),
  alignment_quality: nullable(isNumber),
  created_at: isString,
  updated_at: isString,
  finished_at: nullable(isString),
  // Added after the rest (migration 025), so a server predating it may omit
  // it; absent reads as "no stage to show".
  stage: (value) => value === undefined || value === null || isString(value),
});

const usage = shape({
  used: isCount,
  limit: nullable(isCount),
  remaining: nullable(isCount),
  resets_at: isString,
});

const me = shape({
  id: isUuid,
  email: isEmail,
  tier: oneOf('free', 'pro', 'teacher', 'student_via_teacher'),
  role: oneOf('student', 'teacher'),
  studio_id: nullable(isUuid),
  analyses: nullable(usage),
  instrument: nullable(instrument),
  display_name: nullable(isString),
  avatar_url: nullable(isString),
  onboarded_at: nullable(isString),
  training_consent: isBoolean,
});

function unexpected(name: string): Error {
  return new Error(`The server sent an unexpected ${name} response. Try again.`);
}

function readAnalysis(value: unknown): AnalysisResponse {
  if (!analysis(value)) {
    throw unexpected('analysis');
  }
  const row = value as Record<string, unknown>;
  return { ...row, stage: row.stage ?? null } as unknown as AnalysisResponse;
}

export const parseAnalysis = (value: unknown): AnalysisResponse =>
  readAnalysis(value);

export const parseAnalyses = (value: unknown): AnalysisResponse[] => {
  if (!Array.isArray(value)) {
    throw unexpected('analyses');
  }
  try {
    return value.map(readAnalysis);
  } catch {
    throw unexpected('analyses');
  }
};

export const parseMe = (value: unknown): MeResponse => {
  if (!me(value)) {
    throw unexpected('account');
  }
  return { ...(value as Record<string, unknown>) } as unknown as MeResponse;
};

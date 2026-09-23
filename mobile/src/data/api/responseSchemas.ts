import { z } from 'zod';

import type { AnalysisResponse, MeResponse } from '../types';

const instrument = z.enum(['violin', 'viola', 'cello', 'double_bass']);

const analysis = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  score_id: z.string().uuid(),
  status: z.enum(['queued', 'processing', 'done', 'failed', 'failed_recoverable']),
  target_bpm: z.number().finite(),
  bpm_source: z.string(),
  metronome_mode: z.enum(['off', 'visual', 'haptic', 'audio_with_headphones']),
  instrument: instrument.nullable(),
  result_json: z.record(z.string(), z.unknown()).nullable(),
  failure_reason: z.string().nullable(),
  alignment_quality: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  finished_at: z.string().nullable(),
  // Added after this schema was written (migration 025). Defaulted rather
  // than required, so a server predating it reads as "no stage to show".
  stage: z.string().nullable().default(null),
}).passthrough();

const usage = z.object({
  used: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative().nullable(),
  remaining: z.number().int().nonnegative().nullable(),
  resets_at: z.string(),
}).passthrough();

const me = z.object({
  id: z.string().uuid(),
  email: z.email(),
  tier: z.enum(['free', 'pro', 'teacher', 'student_via_teacher']),
  role: z.enum(['student', 'teacher']),
  studio_id: z.string().uuid().nullable(),
  analyses: usage.nullable(),
  instrument: instrument.nullable(),
  display_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  onboarded_at: z.string().nullable(),
  training_consent: z.boolean(),
}).passthrough();

function checked<T>(schema: z.ZodType<T>, value: unknown, name: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    // The response may contain account data; do not put it into UI errors.
    throw new Error(`The server sent an unexpected ${name} response. Try again.`);
  }
  return result.data;
}

export const parseAnalysis = (value: unknown): AnalysisResponse =>
  checked(analysis, value, 'analysis');

export const parseAnalyses = (value: unknown): AnalysisResponse[] =>
  checked(z.array(analysis), value, 'analyses');

export const parseMe = (value: unknown): MeResponse =>
  checked(me, value, 'account');

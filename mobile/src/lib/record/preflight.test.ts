import { describe, expect, it } from 'vitest';

import {
  bowedAttack,
  hasWarning,
  microphone,
  preflight,
  speakerBleed,
  startBar,
  type PreflightCheck,
  type PreflightInput,
} from './preflight';

const BASE: PreflightInput = {
  metronomeMode: 'visual',
  instrument: 'violin',
  startFrom: 1,
  firstSoundingBar: 1,
  lastTakeHeardSound: null,
};

describe('speakerBleed', () => {
  /**
   * The mode is called "audio with headphones" and the app cannot tell whether
   * headphones are plugged in. Trusting the name would mean the one mode that
   * can ruin a take is the one mode that never warns.
   */
  it('warns about audio, because the headphones are a promise and not a fact', () => {
    const check = speakerBleed('audio_with_headphones');
    expect(check.tone).toBe('warn');
    expect(check.action?.to).toBe('metronome');
  });

  it.each(['visual', 'haptic', 'off'] as const)('clears %s', (mode) => {
    expect(speakerBleed(mode).tone).toBe('ok');
  });

  /** Off and silent are both quiet, and they are quiet for different reasons. */
  it('says why it is quiet, which differs between off and silent', () => {
    expect(speakerBleed('off').detail).toContain('off');
    expect(speakerBleed('haptic').detail).toContain('silent');
  });
});

describe('startBar', () => {
  /**
   * The commonest silent waste of one of three monthly analyses: a part whose
   * first bars are rest, recorded from bar 1.
   */
  it('warns when the take would open on bars of rest', () => {
    const check = startBar({ startFrom: 1, firstSoundingBar: 7 });
    expect(check.tone).toBe('warn');
    expect(check.title).toContain('6 bars');
    expect(check.action?.label).toBe('Start at bar 7');
  });

  it('counts one bar in the singular', () => {
    const check = startBar({ startFrom: 1, firstSoundingBar: 2 });
    expect(check.title).toContain('1 bar before');
    expect(check.title).not.toContain('bars');
  });

  it('clears a take that starts where the notes do', () => {
    expect(startBar({ startFrom: 7, firstSoundingBar: 7 }).tone).toBe('ok');
  });

  /**
   * A musician who has deliberately chosen a bar *after* the first note is
   * practising a passage, which is the whole point of the entry bar. Warning
   * them would be the app second-guessing a choice it asked them to make.
   */
  it('says nothing about starting later than the first note', () => {
    expect(startBar({ startFrom: 40, firstSoundingBar: 1 }).tone).toBe('ok');
  });
});

describe('microphone', () => {
  it('reports nothing at all on a device that has not recorded', () => {
    expect(microphone(null)).toBeNull();
  });

  it('warns when the last take was silent', () => {
    expect(microphone(false)?.tone).toBe('warn');
  });

  it('clears when the last take had sound', () => {
    expect(microphone(true)?.tone).toBe('ok');
  });
});

describe('bowedAttack', () => {
  it('says nothing to the three instruments it does not change', () => {
    for (const instrument of ['violin', 'viola', 'cello'] as const) {
      expect(bowedAttack(instrument)).toBeNull();
    }
  });

  /**
   * This was two lines of prose in the middle of the record screen's controls,
   * drawn for every double-bass take of every piece. It is real information —
   * `test_bowed_attacks.py` is the measurement behind it — so it moved here
   * rather than going.
   */
  it('tells a bassist what is different, and what to do about it', () => {
    const check = bowedAttack('double_bass');

    expect(check?.title).toMatch(/double.bass/i);
    expect(check?.detail).toMatch(/attack/i);
  });

  /**
   * `ok`, never `warn`. Nothing is wrong, and tone is what `hasWarning` reads
   * to decide whether a musician is stopped before playing — a bassist meets
   * this when they open the checks, not instead of recording.
   */
  it('never stops a bassist to tell them the pipeline is working', () => {
    expect(bowedAttack('double_bass')?.tone).toBe('ok');
    expect(hasWarning([bowedAttack('double_bass')!])).toBe(false);
  });
});

describe('preflight', () => {
  it('says nothing about the microphone before the first take', () => {
    const checks = preflight(BASE);
    expect(checks.map((check) => check.id)).toEqual(['start', 'bleed']);
  });

  it('carries the instrument reading for the one instrument that has one', () => {
    const bass = preflight({ ...BASE, instrument: 'double_bass' });

    expect(bass.map((check) => check.id)).toContain('attack');
    expect(preflight(BASE).map((check) => check.id)).not.toContain('attack');
  });

  /** A musician reads the top of a list. What is wrong belongs there. */
  it('puts warnings above the things that are fine', () => {
    const checks = preflight({
      ...BASE,
      metronomeMode: 'audio_with_headphones',
      startFrom: 1,
      firstSoundingBar: 7,
      lastTakeHeardSound: true,
    });
    expect(checks.map((check) => check.tone)).toEqual(['warn', 'warn', 'ok']);
    expect(checks.map((check) => check.id)).toEqual(['start', 'bleed', 'microphone']);
  });

  it('knows when there is nothing worth stopping for', () => {
    expect(hasWarning(preflight({ ...BASE, lastTakeHeardSound: true }))).toBe(false);
    expect(hasWarning(preflight({ ...BASE, metronomeMode: 'audio_with_headphones' }))).toBe(true);
  });
});

describe('hasWarning, as the gate on the pre-flight screen', () => {
  const ok = (id: PreflightCheck['id']): PreflightCheck => ({
    id,
    tone: 'ok',
    title: 'Fine',
    detail: 'Nothing to do.',
  });
  const warn = (id: PreflightCheck['id']): PreflightCheck => ({
    id,
    tone: 'warn',
    title: 'Not fine',
    detail: 'Something to do.',
  });

  it('does not stop a musician to tell them everything is fine', () => {
    // The state this replaces: two rows of ✓ and a paragraph, between someone
    // holding an instrument and the record button. Both items are already on
    // the screen behind it — the entry bar and the metronome each have a row.
    expect(hasWarning([ok('bleed'), ok('start')])).toBe(false);
    expect(hasWarning([])).toBe(false);
  });

  it('stops for anything a musician can fix before playing', () => {
    expect(hasWarning([ok('bleed'), warn('start')])).toBe(true);
    expect(hasWarning([warn('bleed')])).toBe(true);
  });

  it('stops when only one of several is wrong', () => {
    // The screen sorts warnings first, so one among many is still the reason
    // it opened and still the first thing read.
    expect(hasWarning([ok('microphone'), ok('start'), warn('bleed')])).toBe(true);
  });
});

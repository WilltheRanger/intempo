import { describe, expect, it } from 'vitest';

import { MIN_PAGE_ROWS } from './legibility';
import { shotVerdict, viewfinderGuide } from './shotVerdict';

/**
 * The verdict a musician sees while still standing at the stand.
 *
 * Every case here is one where saying the wrong thing costs a page: a good
 * photograph called bad sends someone back for no reason, and a bad one called
 * good surfaces as a failed transcription minutes later with the music already
 * put away.
 */
describe('shotVerdict', () => {
  it('clears a page with enough detail', () => {
    const v = shotVerdict({ verdict: 'ok', spacing: 12 });
    expect(v.tone).toBe('good');
    expect(v.keepLabel).toBe('Keep it');
  });

  it('sends a distant page back, and says how far to come in', () => {
    const v = shotVerdict({ verdict: 'tooSmall', spacing: 3 }, MIN_PAGE_ROWS * 4);
    expect(v.tone).toBe('doubtful');
    expect(v.retake).toBe('retake');
    expect(v.body).toContain('fills the frame');
  });

  /**
   * The distinction `adviceFor` exists to draw: a page that already fills the
   * frame and still has too few pixels cannot be fixed by moving in, and
   * telling someone to move in would send them round the same loop.
   */
  it('sends a capped camera to the camera app rather than back a step', () => {
    const v = shotVerdict({ verdict: 'tooSmall', spacing: 3 }, MIN_PAGE_ROWS - 1);
    expect(v.retake).toBe('cameraApp');
    expect(v.headline).toContain('cannot see');
  });

  /**
   * `legibility.ts` is explicit that an unmeasurable page means the
   * measurement failed and not the photograph, and that it must say nothing
   * rather than warn. Turning that silence into a warning here would undo a
   * decision made deliberately one module down.
   */
  it('never warns about a page it could not measure', () => {
    const v = shotVerdict({ verdict: 'unknown', spacing: null });
    expect(v.tone).toBe('good');
    expect(v.body).not.toMatch(/too|bad|wrong|again/i);
  });

  /**
   * A musician keeping a page the app has just said it cannot read is making a
   * choice, and the label should say so. "Keep it" reads as agreement.
   */
  it('names the cost when the page is being kept against advice', () => {
    expect(shotVerdict({ verdict: 'tooSmall', spacing: 3 }, 9999).keepLabel).toBe(
      'Use it anyway',
    );
  });

  /**
   * Which control is filled, decided here rather than on the screen.
   *
   * The pair flips: on a page that reads, the retake is the escape hatch; on
   * one that does not, it is the advice. A screen that filled `keepLabel`
   * unconditionally would put its weight behind "Use it anyway" on the one
   * page the app has just said it cannot read.
   */
  it('steers towards keeping a page that reads', () => {
    expect(shotVerdict({ verdict: 'ok', spacing: 12 }).primary).toBe('keep');
  });

  it('steers towards the retake on a page that does not', () => {
    expect(shotVerdict({ verdict: 'tooSmall', spacing: 3 }, 9999).primary).toBe('retake');
  });

  it('never steers away from an unmeasured page', () => {
    // The `unknown` rule again, on the control rather than the copy: a page
    // the measurement could not read is not a page that failed, so the filled
    // control must not be "take it again".
    expect(shotVerdict({ verdict: 'unknown', spacing: null }).primary).toBe('keep');
  });

  /**
   * The retake label names its destination. Sending someone to the camera app
   * under a button that says "Take this page again" is the app leaving the
   * screen without saying so.
   */
  it('labels the retake for where it actually goes', () => {
    expect(
      shotVerdict({ verdict: 'tooSmall', spacing: 3 }, MIN_PAGE_ROWS - 1).retakeLabel,
    ).toBe('Open the camera app');
    expect(
      shotVerdict({ verdict: 'tooSmall', spacing: 3 }, MIN_PAGE_ROWS * 4).retakeLabel,
    ).toBe('Take this page again');
    expect(shotVerdict({ verdict: 'ok', spacing: 12 }).retakeLabel).toBe('Take it again');
  });
});

describe('viewfinderGuide', () => {
  it('gives the general advice before anything has been measured', () => {
    expect(viewfinderGuide(null)).toContain('Fill the frame');
  });

  it('stops repeating it once a page has read well', () => {
    const guide = viewfinderGuide(shotVerdict({ verdict: 'ok', spacing: 12 }));
    expect(guide).toContain('read well');
    expect(guide).not.toContain('Fill the frame');
  });

  it('says what to change when the last page was too far', () => {
    const guide = viewfinderGuide(
      shotVerdict({ verdict: 'tooSmall', spacing: 3 }, MIN_PAGE_ROWS * 4),
    );
    expect(guide).toContain('move in');
  });

  it('does not say "move in" when moving in cannot help', () => {
    const guide = viewfinderGuide(
      shotVerdict({ verdict: 'tooSmall', spacing: 3 }, MIN_PAGE_ROWS - 1),
    );
    expect(guide).not.toContain('move in');
    expect(guide).toContain('camera app');
  });
});

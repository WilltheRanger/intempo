import { describe, expect, it } from 'vitest';

import {
  leavingRecord,
  shouldGuardBrowserExit,
  type RecordPhase,
} from './leaving';
import recordScreenSource from '../../screens/record/RecordScreen?raw';

/**
 * The two mistakes this replaces, as tests.
 *
 * 1. Back during a take discarded it with no warning.
 * 2. Back during the count-in was a second Cancel wearing a back chevron, and
 *    announced the same label as the button below it.
 */

const nothing = { unsentTake: false, pieceTitle: 'Sonata in G' };

describe('leaving the record screen', () => {
  it('just leaves when there is nothing to lose', () => {
    expect(leavingRecord({ phase: 'ready', ...nothing })).toEqual({ kind: 'leave' });
  });

  it('leaves during the count-in rather than becoming a second Cancel', () => {
    // **Back means back, in every phase.** It used to mean "return to ready"
    // here and "go to the piece" one state earlier — one glyph, two outcomes,
    // nothing on screen distinguishing them.
    expect(leavingRecord({ phase: 'counting_in', ...nothing })).toEqual({
      kind: 'leave',
    });
  });

  it('asks before throwing away a take in progress', () => {
    const answer = leavingRecord({ phase: 'recording', ...nothing });

    expect(answer.kind).toBe('confirm');
    if (answer.kind !== 'confirm') return;
    expect(answer.message).toContain('Sonata in G');
    // The button that keeps the recording says so. "Cancel" beside "Discard"
    // is a coin toss on a screen where cancelling is also a thing you can do
    // to the take itself.
    expect(answer.cancelLabel).toBe('Keep recording');
  });

  it('still asks when the piece has no title to name', () => {
    const answer = leavingRecord({ phase: 'recording', unsentTake: false });

    expect(answer.kind).toBe('confirm');
    if (answer.kind !== 'confirm') return;
    expect(answer.message).toContain('still recording');
    expect(answer.message).not.toContain('undefined');
  });

  it('asks about a finished take that never reached the server', () => {
    // The screen is showing "Send it again" at this point. Leaving is the end
    // of that offer, and the take only exists in memory.
    const answer = leavingRecord({ phase: 'ready', unsentTake: true });

    expect(answer.kind).toBe('confirm');
    if (answer.kind !== 'confirm') return;
    expect(answer.message).toContain('sent');
  });

  it('does not ask twice about the same audio', () => {
    // `start()` clears the held take, so recording and unsent cannot both be
    // true in the app. If they ever are, the live recording is the one being
    // lost right now and its wording is the one that must show.
    const answer = leavingRecord({ phase: 'recording', unsentTake: true });

    expect(answer.kind).toBe('confirm');
    if (answer.kind !== 'confirm') return;
    expect(answer.message).toContain('still recording');
  });

  it('never asks about a phase that holds no audio', () => {
    // `analysing` has already handed the blob to the uploader and renders no
    // back control at all — but the rule must not depend on that, because the
    // rule is about audio and the header is a layout decision.
    const phases: RecordPhase[] = ['ready', 'counting_in', 'analysing'];
    for (const phase of phases) {
      expect(leavingRecord({ phase, unsentTake: false }).kind, phase).toBe('leave');
    }
  });

  it('guards a browser refresh while audio is live or waiting to be sent', () => {
    expect(
      shouldGuardBrowserExit({ phase: 'recording', unsentTake: false }),
    ).toBe(true);
    expect(
      shouldGuardBrowserExit({ phase: 'analysing', unsentTake: true }),
    ).toBe(true);
    expect(
      shouldGuardBrowserExit({ phase: 'ready', unsentTake: true }),
    ).toBe(true);
  });

  it('does not interrupt a harmless browser exit', () => {
    expect(
      shouldGuardBrowserExit({ phase: 'ready', unsentTake: false }),
    ).toBe(false);
    expect(
      shouldGuardBrowserExit({ phase: 'counting_in', unsentTake: false }),
    ).toBe(false);
    expect(
      shouldGuardBrowserExit({ phase: 'analysing', unsentTake: false }),
    ).toBe(false);
  });

  it('holds the finished bytes before the upload can yield', () => {
    const held = recordScreenSource.indexOf('unsent.current = recording;');
    const submitted = recordScreenSource.indexOf(
      'await takeSubmissionSource.submit',
    );

    expect(held).toBeGreaterThan(-1);
    expect(submitted).toBeGreaterThan(held);
    expect(recordScreenSource).toContain(
      "window.addEventListener('beforeunload', guardBrowserExit)",
    );
  });
});

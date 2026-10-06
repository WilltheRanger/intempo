import { describe, expect, it, vi } from 'vitest';

import { holdTake, isTakeHeld, markTakeSent, onTakeReleased } from './heldTakes';

describe('a take a screen holds', () => {
  it('is held until the screen lets go', () => {
    const release = holdTake('take-a.wav');
    expect(isTakeHeld('take-a.wav')).toBe(true);
    release();
    expect(isTakeHeld('take-a.wav')).toBe(false);
  });

  it('stays held while a second hold of it remains', () => {
    // A remount racing an unmount holds the same take twice.
    const first = holdTake('take-b.wav');
    const second = holdTake('take-b.wav');
    first();
    expect(isTakeHeld('take-b.wav')).toBe(true);
    second();
    expect(isTakeHeld('take-b.wav')).toBe(false);
  });

  it('lets go once, however many times release is called', () => {
    const first = holdTake('take-c.wav');
    const second = holdTake('take-c.wav');
    first();
    first();
    expect(isTakeHeld('take-c.wav')).toBe(true);
    second();
  });

  it('tells the drainer when a take is let go, so one left behind still goes', () => {
    const heard = vi.fn();
    const stop = onTakeReleased(heard);
    const release = holdTake('take-d.wav');

    release();
    expect(heard).toHaveBeenCalledTimes(1);

    stop();
    holdTake('take-d.wav')();
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe('a take the server has accepted', () => {
  it('is never handed to the drain again, even after the screen lets go', () => {
    // The screen releases the take as it sends it, which wakes the drainer,
    // while the queue copy is still being removed.
    const release = holdTake('take-e.wav');
    markTakeSent('take-e.wav');
    release();

    expect(isTakeHeld('take-e.wav')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';

import { canTapOnBeat, tapsCarrySwitch } from './hapticsSupport';

const iPhoneSafari = { switchInput: true, coarsePointer: true, vibrate: false };
const androidChrome = { switchInput: false, coarsePointer: true, vibrate: true };
const desktopSafari = { switchInput: true, coarsePointer: false, vibrate: false };
const desktopChrome = { switchInput: false, coarsePointer: false, vibrate: false };

describe('a hidden switch under the finger', () => {
  it('is how an iPhone browser taps', () => {
    expect(tapsCarrySwitch(iPhoneSafari)).toBe(true);
  });

  it('is not needed where the browser can vibrate', () => {
    expect(tapsCarrySwitch(androidChrome)).toBe(false);
  });

  it('is not drawn for a mouse', () => {
    expect(tapsCarrySwitch(desktopSafari)).toBe(false);
    expect(tapsCarrySwitch(desktopChrome)).toBe(false);
  });
});

describe('a tap on the beat', () => {
  it('is possible in the phone app and where a browser can vibrate', () => {
    expect(canTapOnBeat(null)).toBe(true);
    expect(canTapOnBeat(androidChrome)).toBe(true);
  });

  it('is impossible in a browser on iPhone, where only a finger can make the phone tap', () => {
    expect(canTapOnBeat(iPhoneSafari)).toBe(false);
    expect(canTapOnBeat(desktopChrome)).toBe(false);
  });
});

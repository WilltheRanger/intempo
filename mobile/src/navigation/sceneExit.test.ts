import { describe, expect, it } from 'vitest';

import {
  EXIT_DRAWN_WINDOW_MS,
  exitDrawnWithin,
  noteStackLength,
  onUnderRequest,
  requestUnder,
  settledStackLength,
} from './sceneExit';

describe('an exit drawn ahead of its pop', () => {
  it('counts for the render the pop causes', () => {
    expect(exitDrawnWithin(1000, 1000)).toBe(true);
    expect(exitDrawnWithin(1000 + EXIT_DRAWN_WINDOW_MS - 1, 1000)).toBe(true);
  });

  it('does not count for a later navigation', () => {
    expect(exitDrawnWithin(1000 + EXIT_DRAWN_WINDOW_MS, 1000)).toBe(false);
  });

  it('does not count before it happened', () => {
    expect(exitDrawnWithin(999, 1000)).toBe(false);
  });
});

describe('the scene underneath', () => {
  it('hears requests for every place, and answers only its own', () => {
    const heard: string[] = [];
    const stop = onUnderRequest((own, request) => heard.push(`${own}:${request}`));
    requestUnder(1, 'reveal');
    requestUnder(0, 'cover');
    stop();
    requestUnder(2, 'reveal');
    expect(heard).toEqual(['1:reveal', '0:cover']);
  });
});

describe('the settled stack', () => {
  it('remembers the length it last settled at', () => {
    noteStackLength(3);
    expect(settledStackLength()).toBe(3);
  });
});

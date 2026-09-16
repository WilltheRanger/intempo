import { describe, expect, it } from 'vitest';

import { listenFailure, startTimeout } from './listenFailure';

/**
 * The rule that turns the next Listen report into something worth having.
 *
 * Written after a real iPhone reported Listen failing always, on the deployed
 * build, while it played correctly in Chromium — and the screenshot could not
 * say which of three stages had failed, because all three had fixed sentences.
 */

describe('what a musician is told', () => {
  it('leads with the advice, not the diagnosis', () => {
    const message = listenFailure('loading', new TypeError('Failed to fetch'));

    expect(message.startsWith('Couldn’t load the instrument sound')).toBe(true);
  });

  it('says something different for each stage', () => {
    const error = new Error('boom');
    const messages = new Set([
      listenFailure('loading', error),
      listenFailure('rendering', error),
      listenFailure('starting', error),
    ]);

    // Otherwise the stage is carried by nothing a screenshot can show, which
    // is the defect this module exists to remove.
    expect(messages.size).toBe(3);
  });

  it('still says the advice when the browser offers no cause at all', () => {
    expect(listenFailure('starting', undefined)).toBe(
      'Audio couldn’t start. Tap Listen to retry.',
    );
    expect(listenFailure('starting', {})).not.toContain('(');
  });
});

describe('what a bug report gets', () => {
  it('names the error, which is the whole point', () => {
    const message = listenFailure(
      'rendering',
      new RangeError('Array buffer allocation failed'),
    );

    expect(message).toContain('RangeError');
    expect(message).toContain('Array buffer allocation failed');
  });

  it('names a DOMException by its name', () => {
    const message = listenFailure(
      'starting',
      new DOMException('cannot decode', 'NotSupportedError'),
    );

    expect(message).toContain('NotSupportedError');
  });

  it('does not append a cause to advice that is already complete', () => {
    // `renderSoundfont` throws these two deliberately and they say what to do.
    // A `RangeError:` bolted onto "choose a shorter passage" is noise.
    for (const thrown of [
      'Choose a passage shorter than ten minutes to listen.',
      'There are no playable notes in this passage.',
    ]) {
      expect(listenFailure('rendering', new Error(thrown))).toBe(thrown);
    }
  });

  it('keeps a long message short enough to read on a phone', () => {
    const message = listenFailure('rendering', new Error('x'.repeat(400)));

    // The cause is for a screenshot, and a screenshot of four hundred
    // characters of stack is not one.
    expect(message.length).toBeLessThan(200);
  });
});

/**
 * The timeout half, which is the half a real report arrived from.
 *
 * On 2026-09-16 an iPhone showed "Audio couldn't start. Tap Listen to try
 * again." — a sentence typed into the player rather than taken from here, so
 * `listenFailure` never saw it and no cause was appended. The screenshot
 * narrowed the cause to nothing at all, which is the exact outcome the header
 * of the module under test predicts.
 */
describe('startTimeout', () => {
  it('names the state the clock was stuck in', () => {
    const message = listenFailure('starting', startTimeout('suspended', 2000));

    // The advice a musician acts on comes first and is the shared sentence,
    // not a second copy of it.
    expect(message).toContain('Audio couldn’t start. Tap Listen to retry.');
    // And the half that separates a refused resume from an iOS interruption,
    // which look identical on a screen and have different fixes.
    expect(message).toContain('suspended');
  });

  it('separates the three states that look identical on a screen', () => {
    const said = ['suspended', 'interrupted', 'running'].map((state) =>
      listenFailure('starting', startTimeout(state, 2000)),
    );

    expect(new Set(said).size).toBe(3);
  });

  it('says so rather than going quiet when the state is unreadable', () => {
    // A player with no context to ask still failed, and "unknown" is a fact
    // about the report. An empty cause would read as no cause at all.
    expect(listenFailure('starting', startTimeout(undefined, 2000))).toContain(
      'unknown',
    );
  });

  it('reports how long it waited, rounded and never negative', () => {
    expect(startTimeout('suspended', 2000.4).message).toContain('2000ms');
    // Clocks that go backwards are a thing on a phone that slept; a negative
    // wait in a bug report is worse than no number.
    expect(startTimeout('suspended', -5).message).toContain('0ms');
  });

  it('is a timeout, not something the engine objected to', () => {
    // `causeOf` keeps the name, and the name is what tells the next reader
    // that nothing threw — the clock simply never moved.
    expect(startTimeout('suspended', 2000).name).toBe('AudioStartTimeout');
  });

  it('stays short enough to read on a phone', () => {
    expect(
      listenFailure('starting', startTimeout('interrupted', 2000)).length,
    ).toBeLessThan(200);
  });
});

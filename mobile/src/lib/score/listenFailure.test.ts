import { describe, expect, it } from 'vitest';

import { listenFailure } from './listenFailure';

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


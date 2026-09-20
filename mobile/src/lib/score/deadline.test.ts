import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LOAD_DEADLINE_MS,
  RENDER_DEADLINE_MS,
  TookTooLong,
  within,
} from './deadline';

afterEach(() => {
  vi.useRealTimers();
});

describe('within', () => {
  it('passes a value straight through when the work finishes first', async () => {
    await expect(within(Promise.resolve('bank'), 1000)).resolves.toBe('bank');
  });

  it('passes the work’s own rejection through, rather than masking it', async () => {
    /** A real network error must survive: `listenFailure` appends the cause,
     * and replacing it with a timeout would throw that away. */
    const failed = Promise.reject(new TypeError('Failed to fetch'));

    await expect(within(failed, 1000)).rejects.toThrow('Failed to fetch');
  });

  /**
   * **The bug.** A stalled fetch does not reject, so the load stage awaited
   * forever and the Listen spinner spun forever. `listenFailure` already had
   * the right sentence for this and could never be reached.
   */
  it('rejects with TookTooLong when the work never settles', async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => {});

    const raced = within(never, 5_000);
    const assertion = expect(raced).rejects.toBeInstanceOf(TookTooLong);
    await vi.advanceTimersByTimeAsync(5_001);

    await assertion;
  });

  it('names how long it waited, so a report says which stage stalled', async () => {
    vi.useFakeTimers();

    const raced = within(new Promise<string>(() => {}), 30_000);
    const assertion = expect(raced).rejects.toThrow(/30s/);
    await vi.advanceTimersByTimeAsync(30_001);

    await assertion;
  });

  it('does not fire once the work has finished', async () => {
    vi.useFakeTimers();

    await expect(within(Promise.resolve('done'), 1_000)).resolves.toBe('done');
    // Well past the deadline. Nothing should be pending to reject into.
    await vi.advanceTimersByTimeAsync(10_000);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits rather than refusing early, which is the whole tuning', () => {
    // Both generous on purpose: the failure being removed is an infinite wait,
    // not a long one, and refusing a musician who would have had sound is
    // worse than making them wait. Pinned so a later "tidy up" has to argue.
    expect(LOAD_DEADLINE_MS).toBe(30_000);
    expect(RENDER_DEADLINE_MS).toBe(30_000);
  });
});

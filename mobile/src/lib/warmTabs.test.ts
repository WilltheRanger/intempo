import { describe, expect, it } from 'vitest';

import {
  BETWEEN_WARMS_MS,
  FIRST_WARM_DELAY_MS,
  WARM_ORDER,
  shouldWarmTabs,
  warmTabs,
  type Schedule,
} from './warmTabs';

/** A clock the test moves by hand. */
function fakeClock() {
  let now = 0;
  const timers: { at: number; run: () => void; live: boolean }[] = [];
  const schedule: Schedule = (run, afterMs) => {
    const timer = { at: now + afterMs, run, live: true };
    timers.push(timer);
    return () => {
      timer.live = false;
    };
  };
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const next = timers
        .filter((t) => t.live && t.at <= until)
        .sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      next.live = false;
      now = next.at;
      next.run();
    }
    now = until;
  };
  return { schedule, advance };
}

describe('warmTabs', () => {
  it('builds every other tab, lightest first and Library last', () => {
    const clock = fakeClock();
    const built: string[] = [];
    warmTabs((tab) => built.push(tab), clock.schedule);
    clock.advance(10_000);
    expect(built).toEqual(['Profile', 'Insights', 'Library']);
    expect(WARM_ORDER).not.toContain('Today');
  });

  it('waits for Today, then leaves room between builds for a tap', () => {
    const clock = fakeClock();
    const built: string[] = [];
    warmTabs((tab) => built.push(tab), clock.schedule);

    clock.advance(FIRST_WARM_DELAY_MS - 1);
    expect(built).toEqual([]);
    clock.advance(1);
    expect(built).toEqual(['Profile']);
    clock.advance(BETWEEN_WARMS_MS - 1);
    expect(built).toEqual(['Profile']);
    clock.advance(1);
    expect(built).toEqual(['Profile', 'Insights']);
  });

  it('stops when cancelled, even between builds', () => {
    const clock = fakeClock();
    const built: string[] = [];
    const cancel = warmTabs((tab) => built.push(tab), clock.schedule);
    clock.advance(FIRST_WARM_DELAY_MS);
    cancel();
    clock.advance(10_000);
    expect(built).toEqual(['Profile']);
  });
});

describe('shouldWarmTabs', () => {
  it('warms unless the browser asked to save data', () => {
    expect(shouldWarmTabs(undefined)).toBe(true);
    expect(shouldWarmTabs({})).toBe(true);
    expect(shouldWarmTabs({ saveData: false })).toBe(true);
    expect(shouldWarmTabs({ saveData: true })).toBe(false);
  });
});

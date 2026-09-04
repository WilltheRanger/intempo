import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: vi.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

import { MIN_PAGE_ROWS, SERVER_FLOOR } from './legibility';
import { MIN_LONG_EDGE, SHRINK_LADDER, shrinkToFit, widthFor } from './shrink';

const MB = 1024 * 1024;
const LIMIT = 10 * MB;

/** The page the shrink ladder was written against: 24 MP, portrait. */
const PROVOKING_PAGE = { width: 4284, height: 5712 };

interface Attempt {
  quality: number;
  /** The width asked for, or null when the rung left the size alone. */
  asked: number | null;
  /** The long edge of what came back. */
  longEdge: number;
}

/**
 * A manipulator that models the image, not just the call.
 *
 * **The old stub returned `width: 0, height: 0`**, which is why nothing in
 * this tree could see what `resize` was doing: `expo-image-manipulator`
 * documents its resize values as *"the result image dimensions"*, deriving the
 * other axis from the ratio and enlarging as readily as shrinking, and a stub
 * with no dimensions models neither half of that. Every case below was about
 * the ladder's constants and none was about the page.
 */
function manipulator(
  page: { width: number; height: number },
  sizeFor: (attempt: Attempt) => number,
  { reportsSize = true }: { reportsSize?: boolean } = {},
) {
  const calls: Attempt[] = [];
  const fn = vi.fn(async (uri: string, actions: any[], options: any) => {
    const asked: number | null = actions[0]?.resize?.width ?? null;
    const width = asked ?? page.width;
    const height =
      asked === null ? page.height : Math.round((page.height * asked) / page.width);
    calls.push({ quality: options.compress, asked, longEdge: Math.max(width, height) });
    return {
      uri: `${uri}#q${options.compress}w${asked}`,
      width: reportsSize ? width : 0,
      height: reportsSize ? height : 0,
    };
  });
  return {
    fn: fn as any,
    calls,
    measure: async (_uri: string) => sizeFor(calls[calls.length - 1]),
  };
}

/** The long edges of the attempts that actually asked for a resize. */
const resizedEdges = (calls: Attempt[]) =>
  calls.filter((call) => call.asked !== null).map((call) => call.longEdge);

describe('a page that already fits', () => {
  it('is handed back untouched, not re-encoded', async () => {
    // A lossy round trip is not free just because the file got no bigger.
    const m = manipulator(PROVOKING_PAGE, () => 1 * MB);

    const result = await shrinkToFit('page.jpg', 2 * MB, LIMIT, m.measure, m.fn);

    expect(result).toEqual({ uri: 'page.jpg', size: 2 * MB, changed: false });
    expect(m.fn).not.toHaveBeenCalled();
  });
});

describe('a page that is too large', () => {
  it('stops at the first rung that fits', async () => {
    // 14.8 MB, the size that provoked this. Quality alone is usually enough.
    const m = manipulator(PROVOKING_PAGE, ({ quality }) =>
      quality >= 0.9 ? 11 * MB : 4 * MB,
    );

    const result = await shrinkToFit('page.jpg', 14.8 * MB, LIMIT, m.measure, m.fn);

    expect(result.changed).toBe(true);
    expect(result.size).toBe(4 * MB);
    expect(m.calls).toHaveLength(2);
  });

  it('spends quality before it spends pixels', async () => {
    // Resolution is what the reader needs — the server refuses a page whose
    // staff lines are under eight pixels apart — so every quality step is
    // tried at full size first.
    const m = manipulator(PROVOKING_PAGE, () => 20 * MB); // never fits

    await shrinkToFit('page.jpg', 30 * MB, LIMIT, m.measure, m.fn);

    const firstResize = m.calls.findIndex((c) => c.asked !== null);
    const lastFullSize = m.calls.map((c) => c.asked).lastIndexOf(null);
    expect(firstResize).toBeGreaterThan(lastFullSize);
  });

  it('never reduces a page below the readable floor', async () => {
    // Past this the server's own legibility check starts refusing pages, and
    // shrinking further would trade a send for an unreadable scan.
    const m = manipulator(PROVOKING_PAGE, () => 20 * MB);

    await shrinkToFit('page.jpg', 30 * MB, LIMIT, m.measure, m.fn);

    expect(Math.min(...resizedEdges(m.calls))).toBe(MIN_LONG_EDGE);
    expect(MIN_LONG_EDGE).toBeGreaterThanOrEqual(2400);
  });

  it('hands back the smallest attempt when nothing fits', async () => {
    // So the message names the size that is actually the problem, rather than
    // the original the musician has already been told about.
    const m = manipulator(PROVOKING_PAGE, ({ longEdge }) =>
      longEdge === MIN_LONG_EDGE ? 12 * MB : 25 * MB,
    );

    const result = await shrinkToFit('page.jpg', 30 * MB, LIMIT, m.measure, m.fn);

    expect(result.size).toBe(12 * MB);
    expect(result.changed).toBe(true);
  });

  it('always re-encodes as JPEG', async () => {
    // A 14 MB PNG screenshot of a page is the other way to arrive here, and
    // re-encoding it as PNG would save almost nothing.
    const m = manipulator(PROVOKING_PAGE, () => 1 * MB);

    await shrinkToFit('page.png', 14 * MB, LIMIT, m.measure, m.fn);

    expect(m.fn.mock.calls[0][2].format).toBe('jpeg');
  });
});

describe('which edge the rung bounds', () => {
  it('bounds the long edge of a portrait page, not its width', async () => {
    // **The bug this describes.** Sheet music is photographed portrait, and
    // the rung used to go straight into `resize: { width }` — so a page asked
    // for 2400 came back 2400x3200 and the bound named in `MIN_LONG_EDGE` was
    // never the thing being bounded. The docstring's own worked example (25 px
    // of staff spacing at 5712, "about 10.5" at 2400) computes from the long
    // edge, so the arithmetic was right and the code was not.
    const m = manipulator(PROVOKING_PAGE, () => 20 * MB);

    await shrinkToFit('page.jpg', 30 * MB, LIMIT, m.measure, m.fn);

    expect(resizedEdges(m.calls)).toEqual([4000, 3000, 2400]);
    // The width asked for is the *derived* number, and it is smaller.
    expect(m.calls.filter((c) => c.asked !== null).map((c) => c.asked)).toEqual([
      3000, 2250, 1800,
    ]);
  });

  it('bounds the long edge of a landscape page too', async () => {
    // The same code, and until now the same code did something else here:
    // on a landscape page the width *is* the long edge, so the bound applied
    // as written. Orientation decided how hard a page was shrunk and nothing
    // said so.
    const m = manipulator({ width: 6000, height: 3000 }, () => 20 * MB);

    await shrinkToFit('page.jpg', 30 * MB, LIMIT, m.measure, m.fn);

    expect(resizedEdges(m.calls)).toEqual([4000, 3000, 2400]);
  });

  it('never enlarges a page to reach a rung', async () => {
    // A4 at 300 dpi — the shape a flatbed scan arrives in. Its long edge is
    // already inside the 4000 rung, and `resize` sets the dimension it is
    // given rather than capping it, so that rung used to come back *bigger*
    // than the page went in: a full re-encode spent moving away from fitting.
    const m = manipulator({ width: 2480, height: 3508 }, () => 20 * MB);

    await shrinkToFit('page.jpg', 30 * MB, LIMIT, m.measure, m.fn);

    expect(resizedEdges(m.calls)).toEqual([3000, 2400]);
    for (const call of m.calls) {
      expect(call.longEdge).toBeLessThanOrEqual(3508);
    }
  });

  it('resizes nothing when the manipulator reports no dimensions', async () => {
    // Without them there is no way to tell which edge is long. Skipping the
    // pixel rungs costs a page that could have been shrunk; guessing costs a
    // bound that depends on which way up the page was held, which is the bug
    // above.
    const m = manipulator(PROVOKING_PAGE, () => 20 * MB, { reportsSize: false });

    await shrinkToFit('page.jpg', 30 * MB, LIMIT, m.measure, m.fn);

    expect(m.calls.every((call) => call.asked === null)).toBe(true);
  });
});

describe('widthFor', () => {
  it('scales the width so the long edge lands on the rung', () => {
    expect(widthFor({ width: 4284, height: 5712 }, 2400)).toBe(1800);
    expect(widthFor({ width: 6000, height: 3000 }, 2400)).toBe(2400);
  });

  it('refuses a page that is already inside the rung', () => {
    expect(widthFor({ width: 2480, height: 3508 }, 4000)).toBeNull();
    // Exactly on the rung is a no-op re-encode, which costs detail for nothing.
    expect(widthFor({ width: 1800, height: 2400 }, 2400)).toBeNull();
  });

  it('refuses a page it has no dimensions for', () => {
    expect(widthFor(null, 2400)).toBeNull();
    expect(widthFor({ width: 0, height: 0 }, 2400)).toBeNull();
  });
});

describe('the ladder itself', () => {
  it('only ever gets smaller', () => {
    // A rung that undid a previous one would waste a round trip and could
    // hand back something larger than the attempt before it.
    const edges = SHRINK_LADDER.map((a) => a.maxEdge ?? Infinity);
    expect([...edges]).toEqual([...edges].sort((a, b) => b - a));
  });

  it('never shrinks a page past what the server will read', () => {
    /*
     * **The floor's reason, held rather than argued.** `MIN_LONG_EDGE`'s
     * docstring makes the case in prose — 25 px of staff spacing at 5712 is
     * about 10.5 at 2400, clear of the server's floor of 8 — and prose is not
     * a check. Lower this rung and every large page would upload, save, and
     * then be refused at the reading step for a size the app itself chose,
     * which is the same failure `test_the_app_shrinks_a_page_to_something_
     * the_worker_will_read` guards for **bytes** and nothing guarded for
     * **pixels**.
     *
     * `MIN_PAGE_ROWS` is the shortest whole-page photograph that could clear
     * that floor, derived in `legibility.ts` from `SERVER_FLOOR` — which
     * `test_client_enums.py` in turn ties to the server's real
     * `_MIN_STAFF_SPACE_PX`. So the chain reaches the number the server
     * actually refuses at, and a change at either end goes red somewhere.
     *
     * Every rung, not just the last: the ladder's ordering is a separate
     * assertion, and a rung inserted below the floor should fail on its own
     * terms rather than depend on that one.
     *
     * **The arithmetic is a portrait page's**, as both constants are:
     * `SPACING_PER_PAGE_ROW` was measured from captures of a page filling the
     * frame the tall way. A landscape frame with the same long edge holds
     * fewer rows, so this bound is the right one for how sheet music is
     * actually photographed and is not a general claim about every image.
     */
    expect(MIN_PAGE_ROWS).toBeLessThanOrEqual(MIN_LONG_EDGE);
    for (const rung of SHRINK_LADDER) {
      if (rung.maxEdge === null) continue;
      expect(
        rung.maxEdge,
        `a page shrunk to ${rung.maxEdge} px could fall under the server's ` +
          `floor of ${SERVER_FLOOR} px between staff lines`,
      ).toBeGreaterThanOrEqual(MIN_PAGE_ROWS);
    }
  });

  it('starts by trying quality at full resolution', () => {
    // Load-bearing beyond its own comment: the page's dimensions are learned
    // from a full-size attempt, so a ladder that opened with a pixel rung
    // would have nothing to scale from and would skip it.
    expect(SHRINK_LADDER[0].maxEdge).toBeNull();
    expect(SHRINK_LADDER[0].quality).toBeLessThan(1);
  });
});

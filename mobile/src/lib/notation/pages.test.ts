import { describe, expect, it } from 'vitest';

import { pageAtOffset, pageOffsets, pageOfSystem, paginateSystems } from './pages';

/** Systems of a uniform height, spaced by a gap, the way the engraver stacks them. */
function stack(count: number, height = 100, gap = 20) {
  return Array.from({ length: count }, (_unused, index) => ({
    top: index * (height + gap),
    bottom: index * (height + gap) + height,
  }));
}

describe('paginateSystems', () => {
  it('has no pages for no music', () => {
    expect(paginateSystems([], 500)).toEqual([]);
  });

  it('fits as many whole systems as the viewport holds', () => {
    // 100 tall, 20 apart: three systems reach 340, four reach 460.
    const pages = paginateSystems(stack(9), 400);

    expect(pages.map((page) => [page.from, page.to])).toEqual([
      [0, 3],
      [3, 6],
      [6, 9],
    ]);
  });

  it('never lets a page reach past the viewport', () => {
    const systems = stack(9);
    for (const page of paginateSystems(systems, 400)) {
      expect(page.height).toBeLessThanOrEqual(400);
    }
  });

  it('partitions the systems in order, leaving none out and repeating none', () => {
    const pages = paginateSystems(stack(11), 380);

    expect(pages[0].from).toBe(0);
    expect(pages[pages.length - 1].to).toBe(11);
    for (let index = 1; index < pages.length; index += 1) {
      expect(pages[index].from).toBe(pages[index - 1].to);
    }
  });

  it('starts each page at its own first system', () => {
    const systems = stack(9);
    for (const page of paginateSystems(systems, 400)) {
      expect(page.top).toBe(systems[page.from].top);
    }
  });

  it('reserves the gutter above each page out of the same viewport', () => {
    const systems = stack(9);
    const pages = paginateSystems(systems, 400, 12);

    // The first page's top is clamped at the drawing's own edge; every later
    // page opens a gutter above its first system.
    expect(pages[0].top).toBe(0);
    expect(pages[1].top).toBe(systems[pages[1].from].top - 12);
    for (const page of pages) {
      expect(page.height).toBeLessThanOrEqual(400);
    }
  });

  it('gives a system taller than the viewport a page of its own, uncut', () => {
    const systems = [
      { top: 0, bottom: 80 },
      { top: 100, bottom: 700 },
      { top: 720, bottom: 800 },
    ];
    const pages = paginateSystems(systems, 400);

    expect(pages.map((page) => [page.from, page.to])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(pages[1].overflows).toBe(true);
    expect(pages[0].overflows).toBe(false);
  });

  it('holds everything on one page until something has been measured', () => {
    const pages = paginateSystems(stack(5), 0);

    expect(pages).toHaveLength(1);
    expect(pages[0].to).toBe(5);
  });
});

describe('pageOfSystem', () => {
  const pages = paginateSystems(stack(9), 400);

  it('finds the page a system is on', () => {
    expect(pageOfSystem(pages, 0)).toBe(0);
    expect(pageOfSystem(pages, 4)).toBe(1);
    expect(pageOfSystem(pages, 8)).toBe(2);
  });

  it('says so rather than guessing when the system is not paginated', () => {
    expect(pageOfSystem(pages, 99)).toBe(-1);
    expect(pageOfSystem([], 0)).toBe(-1);
  });
});

describe('pageOffsets', () => {
  const pages = paginateSystems(stack(9), 400);

  it('stacks the pages a viewport apart', () => {
    expect(pageOffsets(pages, 400)).toEqual([0, 400, 800]);
  });

  it('gives an overflowing page the room its music needs', () => {
    const tall = paginateSystems(
      [
        { top: 0, bottom: 80 },
        { top: 100, bottom: 700 },
        { top: 720, bottom: 800 },
      ],
      400,
    );

    expect(pageOffsets(tall, 400)).toEqual([0, 400, 1000]);
  });
});

describe('pageAtOffset', () => {
  const offsets = [0, 400, 800];

  it('names the page a snapped scroll rests on', () => {
    expect(pageAtOffset(offsets, 0)).toBe(0);
    expect(pageAtOffset(offsets, 400)).toBe(1);
    expect(pageAtOffset(offsets, 800)).toBe(2);
  });

  it('still names that page a fraction of a point short of it', () => {
    expect(pageAtOffset(offsets, 399.5)).toBe(1);
  });

  it('counts a scroll part-way down a page as reading that page', () => {
    expect(pageAtOffset(offsets, 430)).toBe(1);
  });

  it('never goes below the first page', () => {
    expect(pageAtOffset(offsets, -80)).toBe(0);
  });
});

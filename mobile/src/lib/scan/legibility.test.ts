import { describe, expect, it } from 'vitest';

import {
  CLIENT_FLOOR,
  MIN_PAGE_ROWS,
  SERVER_FLOOR,
  adviceFor,
  legibilityOf,
  staffSpacing,
  type PageSamples,
} from './legibility';

/**
 * A page of ruled staves at an exact, known line spacing.
 *
 * Synthesised rather than a photograph so the answer is known: the whole
 * question is whether the measurement recovers the number it was given.
 */
function ruledPage({
  width = 400,
  height = 600,
  spacing,
  systems = 6,
  scale = 1,
  ink = 30,
  paper = 235,
}: {
  width?: number;
  height?: number;
  spacing: number;
  systems?: number;
  scale?: number;
  ink?: number;
  paper?: number;
}): PageSamples {
  const gray = new Uint8Array(width * height).fill(paper);
  const per = height / (systems + 1);
  for (let s = 0; s < systems; s += 1) {
    const top = Math.round(per * (s + 0.5));
    for (let line = 0; line < 5; line += 1) {
      const y = Math.round(top + line * spacing);
      if (y < 0 || y >= height) continue;
      for (let x = Math.round(width * 0.08); x < width * 0.92; x += 1) {
        gray[y * width + x] = ink;
      }
    }
  }
  return { gray, width, height, scale };
}

describe('staffSpacing', () => {
  it.each([8, 10, 12, 16, 20])('recovers a spacing of %i rows', (spacing) => {
    const measured = staffSpacing(ruledPage({ spacing }));
    expect(measured).not.toBeNull();
    expect(measured!).toBeGreaterThanOrEqual(spacing - 1);
    expect(measured!).toBeLessThanOrEqual(spacing + 1);
  });

  it('reports the spacing in source pixels, not in the samples it measured', () => {
    // The samples are a downscaled copy of the photograph. Reporting the
    // measured number as-is would understate every page by the scale factor and
    // have the app warning about photographs that are perfectly good.
    const atOne = staffSpacing(ruledPage({ spacing: 10, scale: 1 }));
    const atFour = staffSpacing(ruledPage({ spacing: 10, scale: 4 }));

    expect(atOne).toBeCloseTo(10, 0);
    expect(atFour).toBeCloseTo(40, 0);
  });

  it('reports the line spacing, not the distance between systems', () => {
    // Autocorrelation peaks at every multiple of the true period, and the
    // taller peak is often the gap between systems. Answering with that
    // flatters the page instead of warning about it.
    const measured = staffSpacing(ruledPage({ spacing: 9, systems: 5, height: 600 }));
    expect(measured!).toBeLessThan(20);
  });

  it('finds the staff under a system pitch that peaks higher than it does', () => {
    // **The case the test above did not actually cover**, and the one that got
    // through: with five systems on 600 rows the system pitch is 100, past
    // `MAX_PERIOD`, so it was never a candidate and the assertion could not
    // fail. Measured on a real capture instead — a page at 4 px between staff
    // lines — the system pitch at lag 28 scored 0.929 against the staff's own
    // 0.662, and the answer came back as 28: seven times too generous, on
    // exactly the kind of page this exists to warn about.
    //
    // Packed tightly enough here that the system pitch is inside the search
    // range, so a rule that prefers the tallest peak fails this.
    const spacing = 4;
    const systems = 24;
    const measured = staffSpacing(
      ruledPage({ spacing, systems, height: 720, width: 1280 }),
    );

    expect(measured).not.toBeNull();
    expect(measured!).toBeLessThanOrEqual(spacing + 1);
  });

  it('says nothing about a blank page', () => {
    const blank: PageSamples = {
      gray: new Uint8Array(400 * 600).fill(240),
      width: 400,
      height: 600,
      scale: 1,
    };
    expect(staffSpacing(blank)).toBeNull();
  });

  it('never warns about noise, whatever it thinks it sees in it', () => {
    // **The assertion this replaces was stricter than the contract.** It
    // demanded `null` for white noise, and the detector returns a spurious
    // *long* period instead — 26 rows on the first seed tried. That is not the
    // failure it looked like: a long period means "plenty of detail", so the
    // verdict is `ok` and the app says nothing, which is the harmless
    // direction. Demanding null was asking for a robustness this does not
    // claim and does not need; a photograph is never white noise.
    //
    // What must hold is that noise cannot make the app talk a musician out of
    // a photograph. Across seeds, because a single seed proves very little
    // about a statistical claim.
    for (let start = 1; start <= 40; start += 1) {
      const gray = new Uint8Array(400 * 600);
      let seed = start * 7919;
      for (let i = 0; i < gray.length; i += 1) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        gray[i] = (seed >>> 16) % 256;
      }
      const verdict = legibilityOf({ gray, width: 400, height: 600, scale: 1 });
      expect(verdict.verdict, `seed ${start}`).not.toBe('tooSmall');
    }
  });

  it('says nothing rather than guessing at an image too small to hold a staff', () => {
    expect(staffSpacing(ruledPage({ spacing: 10, width: 4, height: 4 }))).toBeNull();
  });

  it('reads a grey staff on a lit page, not just a black one', () => {
    // A photographed page is never black on white, and an absolute threshold
    // misses the lines entirely. The rows are measured against their own paper.
    const measured = staffSpacing(ruledPage({ spacing: 12, ink: 150, paper: 205 }));
    expect(measured).not.toBeNull();
    expect(measured!).toBeGreaterThanOrEqual(11);
  });
});

describe('the verdict', () => {
  it('never speaks about a page the server would accept', () => {
    // **The rule this module exists under.** A page it warns about and the
    // server would have read is a regression; a page it stays quiet about and
    // the server then refuses is what happens today. So the floor it speaks
    // below must sit under the server's.
    expect(CLIENT_FLOOR).toBeLessThan(SERVER_FLOOR);

    for (let spacing = SERVER_FLOOR; spacing <= 40; spacing += 1) {
      const verdict = legibilityOf(ruledPage({ spacing, height: 900, systems: 5 }));
      expect(verdict.verdict, `${spacing}px must not be warned about`).not.toBe(
        'tooSmall',
      );
    }
  });

  it('warns about a page that is plainly too far away', () => {
    const verdict = legibilityOf(ruledPage({ spacing: 4, height: 600, systems: 8 }));
    expect(verdict.verdict).toBe('tooSmall');
    expect(adviceFor(verdict)?.body).toContain('fills the frame');
    expect(adviceFor(verdict)?.route).toBe('retake');
  });

  it('stays silent when it could not measure anything', () => {
    expect(legibilityOf(null)).toEqual({ verdict: 'unknown', spacing: null });
    expect(adviceFor({ verdict: 'unknown', spacing: null })).toBeNull();
  });

  it('gives no advice about a page it is happy with', () => {
    expect(adviceFor({ verdict: 'ok', spacing: 20 })).toBeNull();
  });

  describe('which of the two problems it is', () => {
    const tooSmall = { verdict: 'tooSmall', spacing: 4 } as const;

    it('blames the camera when no framing could have cleared the floor', () => {
      // A 1920x1080 stream cropped to the viewfinder is 799x1080 — the whole
      // page, filling the frame, at four pixels between staff lines. "Move in"
      // is advice that has already been followed.
      const advice = adviceFor(tooSmall, 1080);
      expect(advice?.route).toBe('cameraApp');
      expect(advice?.body).toContain('camera app');
      expect(advice?.body).not.toContain('fills the frame');
      // The finding and the remedy are two strings and neither may repeat the
      // other: the screen draws them one above the other.
      expect(advice?.body).not.toContain(advice!.headline);
    });

    it('blames the distance when the photograph was big enough to work', () => {
      // A page this tall has the pixels; if the staves are still four apart,
      // the page is small inside them.
      const advice = adviceFor(tooSmall, MIN_PAGE_ROWS * 2);
      expect(advice?.route).toBe('retake');
    });

    it('falls back to "move in" when the size is not known', () => {
      // The gentler of the two and the only one that is always true: a closer
      // page is easier to read whatever the camera did.
      expect(adviceFor(tooSmall)?.route).toBe('retake');
      expect(adviceFor(tooSmall, 0)?.route).toBe('retake');
    });

    it('sets the floor from the page, not from one photograph', () => {
      // Both measurements of the real page agree to within 5%: 25px of staff
      // spacing at 5712 rows, 4px at 960. The floor has to sit between the
      // heights those imply for the server's 8px, or it is fitted to a camera.
      expect(MIN_PAGE_ROWS).toBeGreaterThan(SERVER_FLOOR / (25 / 5712) - 5);
      expect(MIN_PAGE_ROWS).toBeLessThan(SERVER_FLOOR / (4 / 960) + 5);
      // And a 4K capture cropped to the viewfinder — 1598x2160 — must clear it,
      // or the app would send someone to the camera app from its best case.
      expect(MIN_PAGE_ROWS).toBeLessThanOrEqual(2160);
    });
  });
});

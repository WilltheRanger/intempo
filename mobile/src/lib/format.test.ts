import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  daysSincePracticed,
  formatLastPracticed,
  formatLastPracticedShort,
  formatRole,
  formatTier,
  joinMetadata,
  pageCountLabel,
  sessionLabel,
} from './format';

/**
 * How long ago something was, said in words.
 *
 * The two labels share `daysSincePracticed` so the Library's grouping and its
 * row labels cannot disagree about which week something falls in — "5 days"
 * under a heading that says "Earlier this month" is the kind of thing nobody
 * notices in review and everybody notices in use. These check that they still
 * agree, and that the day count survives the two days a year it could not.
 */

afterEach(() => {
  vi.useRealTimers();
});

/** Runs `body` with the clock and the timezone both pinned. */
function at(zone: string, when: Date, body: () => void): void {
  const original = process.env.TZ;
  process.env.TZ = zone;
  try {
    expect(
      new Date().getTimezoneOffset(),
      `the runner ignored TZ=${zone}; this test would prove nothing`,
    ).not.toBe(0);
    vi.useFakeTimers();
    vi.setSystemTime(when);
    body();
  } finally {
    vi.useRealTimers();
    process.env.TZ = original;
  }
}

describe('daysSincePracticed', () => {
  it('counts calendar days, not elapsed hours', () => {
    // 23:50 last night and 00:10 this morning is twenty minutes, and one day.
    const lastNight = new Date(2026, 4, 17, 23, 50);
    const thisMorning = new Date(2026, 4, 18, 0, 10);

    expect(daysSincePracticed(lastNight.toISOString(), thisMorning)).toBe(1);
  });

  it('is null for a piece never practiced, and for nonsense', () => {
    expect(daysSincePracticed(null)).toBeNull();
    expect(daysSincePracticed('not a date')).toBeNull();
  });

  it('survives the clock going forward', () => {
    // The reason `calendarDaysBetween` rounds rather than flooring.
    //
    // The dates matter and I got them wrong first time. US DST starts at 02:00
    // on 8 March 2026, so local midnight on the *7th* and on the *8th* are
    // both still PST — 24 hours apart, and `Math.floor` passes. The short day
    // is between midnight on the **8th** and midnight on the **9th**: 23
    // hours, which floors to **0** — "Practiced today" for something practised
    // yesterday, one day a year, only for the people it happens to. In UTC,
    // where these tests otherwise run, nothing catches it at all.
    at('America/Los_Angeles', new Date(2026, 2, 9, 20), () => {
      const dayBefore = new Date(2026, 2, 8, 20);

      expect(daysSincePracticed(dayBefore.toISOString(), new Date(2026, 2, 9, 20))).toBe(1);
    });
  });

  it('survives the clock going back', () => {
    // The mirror: 25 hours between midnight on 1 November and midnight on the
    // 2nd, which a floor also gets right and a truncating division would not.
    at('America/Los_Angeles', new Date(2026, 10, 2, 20), () => {
      const dayBefore = new Date(2026, 10, 1, 20);

      expect(daysSincePracticed(dayBefore.toISOString(), new Date(2026, 10, 2, 20))).toBe(1);
    });
  });

  it('reads a timestamp from the future as today rather than negative', () => {
    // Clock skew on a phone is common enough, and "Practiced -2 days ago" is
    // worse than being slightly generous.
    //
    // The clock has to be pinned for this: `formatLastPracticed` takes no
    // `now`, so without a fake timer "later" was compared against the real
    // date and was in the *past*. The test passed and proved nothing — a
    // mutation narrowing `days <= 0` to `days === 0` survived it.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 17, 12));
    const later = new Date(2026, 4, 19, 12);

    expect(daysSincePracticed(later.toISOString(), new Date(2026, 4, 17, 12))).toBeLessThan(0);
    expect(formatLastPracticed(later.toISOString())).toBe('Practiced today');
    expect(formatLastPracticedShort(later.toISOString())).toBe('Today');
  });
});

describe('the two labels agree', () => {
  const cases: [number, string, string][] = [
    [0, 'Practiced today', 'Today'],
    [1, 'Practiced yesterday', 'Yesterday'],
    [3, 'Practiced 3 days ago', '3 days'],
    [6, 'Practiced 6 days ago', '6 days'],
    [7, 'Practiced last week', 'Last week'],
    [14, 'Practiced 2 weeks ago', '2 weeks'],
    [27, 'Practiced 4 weeks ago', '4 weeks'],
    [30, 'Practiced last month', 'Last month'],
    [90, 'Practiced 3 months ago', '3 months'],
  ];

  it.each(cases)('at %i days: %s / %s', (days, long, short) => {
    const now = new Date(2026, 4, 17, 12);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const then = new Date(2026, 4, 17 - days, 12);

    expect(formatLastPracticed(then.toISOString())).toBe(long);
    expect(formatLastPracticedShort(then.toISOString())).toBe(short);
  });

  it('never says "1 days"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 17, 12));

    for (let days = 0; days <= 400; days += 1) {
      const then = new Date(2026, 4, 17 - days, 12);
      const long = formatLastPracticed(then.toISOString());
      const short = formatLastPracticedShort(then.toISOString());

      expect(long, `${days} days`).not.toMatch(/\b1 (days|weeks|months)\b/);
      expect(short, `${days} days`).not.toMatch(/\b1 (days|weeks|months)\b/);
    }
  });

  it('omits the line entirely when nothing is known', () => {
    // Null rather than a placeholder, so the caller drops the row instead of
    // rendering "Never practiced" next to a piece added five minutes ago.
    expect(formatLastPracticed(null)).toBeNull();
    expect(formatLastPracticedShort(null)).toBeNull();
  });
});

describe('labels', () => {
  it('names the tiers and roles a person recognises', () => {
    expect(formatTier('student_via_teacher')).toBe('Student, via teacher');
    expect(formatRole('teacher')).toBe('Teacher');
  });

  it('shows an unknown value rather than guessing at one', () => {
    // "If the backend adds a tier these will show `enterprise` until it's
    // given a label here, which is visible, where silently printing 'Free'
    // would not be."
    expect(formatTier('enterprise' as never)).toBe('enterprise');
    expect(formatRole('administrator' as never)).toBe('administrator');
  });
});

describe('joinMetadata', () => {
  it('drops the fragments that had no value', () => {
    expect(joinMetadata(['Bach', null, 'Suite No. 1', undefined, ''])).toBe(
      'Bach  ·  Suite No. 1',
    );
  });

  it('adds no separator to a single fragment', () => {
    expect(joinMetadata([null, 'Bach'])).toBe('Bach');
    expect(joinMetadata([null, undefined])).toBe('');
  });
});


/**
 * Two counts that used to be four functions.
 *
 * `pageCountLabel` lived in `ScannerScreen` and `CapturedPagesScreen` with
 * **different** behaviour at zero; `sessionLabel` lived in
 * `lib/insights/tendency.ts` and `PieceInsightRow.tsx`, byte-identical, with
 * only the module's copy tested. Neither divergence was visible: the captured-
 * pages screen returns its empty state before its label is reached, so its
 * zero case was unreachable.
 *
 * The zero case is here because it is the one that differed, and because a
 * mutation found nothing testing it — dropping the branch entirely left all
 * 1,751 tests passing.
 */
describe('counting pages', () => {
  it('says what an empty scan is, rather than counting to zero', () => {
    // "0 pages" is arithmetic; "No pages yet" is the sentence a person would
    // say, and it is the reason this branch is the one both screens now use.
    expect(pageCountLabel(0)).toBe('No pages yet');
  });

  it('does not pluralise a single page', () => {
    expect(pageCountLabel(1)).toBe('1 page');
  });

  it('counts the rest', () => {
    expect(pageCountLabel(2)).toBe('2 pages');
    expect(pageCountLabel(30)).toBe('30 pages');
  });
});

describe('counting sessions', () => {
  it('does not pluralise a single session', () => {
    expect(sessionLabel(1)).toBe('1 session');
  });

  it('counts the rest, including none', () => {
    // Zero is a real reading here and not an empty state: a window with no
    // sessions is what a musician who has not practised this month sees.
    expect(sessionLabel(0)).toBe('0 sessions');
    expect(sessionLabel(12)).toBe('12 sessions');
  });
});

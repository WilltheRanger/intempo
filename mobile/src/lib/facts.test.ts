import { describe, expect, it } from 'vitest';

import { factFor } from './facts';

/**
 * The one thing on Today that is not about you.
 *
 * The module states an editorial rule and records that it was broken at scale
 * before anyone applied it:
 *
 * > A lead must add something the sentence does not already say. **Nine of
 * > these echoed their own sentence — five were its opening words verbatim**
 * > — so the block stated the same thing twice, six points apart, and read as
 * > a stutter.
 *
 * That was fixed by hand and nothing keeps it. A rule enforced once is a rule
 * that lasts until the next entry, and entries are the thing this file exists
 * to accumulate.
 *
 * **Factual accuracy is out of reach here, and it is the more expensive half**
 * — "a wrong fact about Bach in an app for classical musicians is expensive",
 * as the module puts it. What a test can hold is the shape.
 */

/** Every fact in the set, by rotating well past its length. */
function allFacts() {
  const seen = new Map<string, { lead: string; text: string }>();
  const start = new Date('2026-01-01T12:00:00Z');
  for (let day = 0; day < 400; day += 1) {
    const fact = factFor(new Date(start.getTime() + day * 86_400_000));
    seen.set(`${fact.lead} ${fact.text}`, fact);
  }
  return [...seen.values()];
}

/** Lower-cased words, with punctuation and curly quotes stripped. */
function words(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

describe('the daily fact', () => {
  const facts = allFacts();

  it('rotates through a set worth having', () => {
    // The module says the set is about 24 entries, "roughly a month", which is
    // why it is a footnote rather than a feature. Were it ever to collect one
    // fact, every rule below would pass vacuously.
    expect(facts.length).toBeGreaterThanOrEqual(20);
  });

  it('gives the same fact all day, and a different one tomorrow', () => {
    const morning = factFor(new Date('2026-03-04T07:00:00Z'));
    const evening = factFor(new Date('2026-03-04T21:00:00Z'));
    const tomorrow = factFor(new Date('2026-03-05T09:00:00Z'));

    expect(evening).toEqual(morning);
    expect(tomorrow).not.toEqual(morning);
  });

  it('never opens the sentence with the lead own words', () => {
    // The exact failure the module records: five leads were the opening words
    // of their own sentence, so the block said one thing twice.
    const stutters = facts.filter((fact) => {
      const lead = words(fact.lead);
      const opening = words(fact.text).slice(0, lead.length);
      return lead.length > 0 && lead.join(' ') === opening.join(' ');
    });

    expect(stutters.map((f) => f.lead)).toEqual([]);
  });

  /*
    Leads that appear **verbatim** inside their own sentence.

    Listed rather than fixed: the rule is the module's, but the wording is the
    owner's, and rewriting displayed copy on my own judgement is the one thing
    §2 reserves. Naming them here keeps the guard on every *new* entry while
    leaving these two visible and outstanding. Delete an entry when its lead is
    reworded — the test below fails if you leave a stale one.
  */
  const KNOWN_ECHOES = ['All in the bow arm', 'Il Cannone', 'Patented in 1815'];

  it('never says the lead over again inside the sentence', () => {
    // "A lead must add something the sentence does not already say." A first
    // version of this test looked for any three consecutive lead words in the
    // sentence, which flagged "It used to be a choice" — whose lead appears
    // nowhere in its text — because `to be a` is ordinary prose. A heuristic
    // that is wrong one time in three is not a rule; the verbatim reading is.
    // It is also the stricter of the two: it caught `Il Cannone`, which three
    // consecutive words could never see because the lead has only two.
    const echoes = facts
      .filter((fact) => fact.text.toLowerCase().includes(fact.lead.toLowerCase()))
      .map((fact) => fact.lead);

    expect(echoes.sort()).toEqual([...KNOWN_ECHOES].sort());
  });

  it('keeps every lead short enough to be a label', () => {
    // "Not a headline and not a hook — it names the subject." A lead that runs
    // long stops being a label and becomes a second sentence above the first.
    for (const fact of facts) {
      expect(fact.lead.length, fact.lead).toBeLessThanOrEqual(32);
      expect(fact.lead, fact.lead).not.toMatch(/[.!?]$/);
    }
  });

  it('states each fact as a finished sentence', () => {
    for (const fact of facts) {
      expect(fact.text.length, fact.text).toBeGreaterThan(40);
      expect(fact.text, fact.text).toMatch(/[.!?]$/);
    }
  });

  it('hedges nothing', () => {
    // "Anything that needed a 'probably' was left out rather than hedged,
    // because a wrong fact about Bach in an app for classical musicians is
    // expensive." A hedge is the tell that the entry should not be here at
    // all — this cannot check whether a fact is true, only that it does not
    // announce its own doubt.
    for (const fact of facts) {
      expect(fact.text, fact.text).not.toMatch(
        /\b(probably|possibly|perhaps|may have|might have|allegedly|it is said)\b/i,
      );
    }
  });
});

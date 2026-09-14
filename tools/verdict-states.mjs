/**
 * The four ways a take can come back without a verdict, and the sentence each
 * one says — in one place, because two checks read it.
 *
 * **Written after the duplication cost a CI run.** `walk-app.mjs` asserts the
 * sentence a musician reads; `audit-a11y.mjs` uses it to confirm a route
 * actually reached the state it is listed for before auditing it. Both carried
 * their own copy of "matching your recording to the score", and when the
 * pipeline's wording changed on 2026-09-14 the walk was updated and the audit
 * was not — so the walk went green and the audit failed with `WRONG STATE`,
 * one push later. The same lesson `analysis.prepare_for_alignment` is named
 * for: two implementations of one fact cannot be kept in step by reading them.
 *
 * `says` is a regex because the walk matches a line of rendered text and the
 * counts in one of these sentences are fixture data. `audit-a11y` needs a
 * substring, so it gets `source`-free `needle` alongside.
 *
 * The sentences are the pipeline's own, read off `analyze()` rather than
 * written here — a check that invented its wording would be checking the
 * screen against something the product never sends.
 */
export const VERDICT_STATES = [
  {
    id: 'fixture-take-failed',
    what: 'a failure worth retrying',
    label: 'Verdict — failed, recoverable',
    says: /on our side, not with your playing/i,
    needle: 'on our side, not with your playing',
    offers: /^Try again$/i,
  },
  {
    id: 'fixture-take-unrecoverable',
    what: 'a failure that will not come back',
    label: 'Verdict — failed for good',
    says: /couldn.t process this recording/i,
    needle: "We couldn't process this recording",
    offers: /^Record again$/i,
  },
  {
    id: 'fixture-take-silent',
    what: 'a silent recording',
    label: 'Verdict — nothing heard',
    // `diagnostics.py` distinguishes a silent take from a page with no notes
    // read off it, and the screen must not paraphrase either into the other.
    says: /completely silent/i,
    needle: 'completely silent',
    offers: /^Record again$/i,
  },
  {
    id: 'fixture-take-unmatched',
    what: 'a take the pipeline could not find enough of',
    label: 'Verdict — too little of the page heard',
    // Changed 2026-09-14. This read "matching your recording to the score —
    // check you're on the right piece", which is what every early take was
    // told while being the right piece. The counts are the point of the new
    // sentence, so the needle keeps them while staying off the exact figures.
    says: /only picked out \d+ notes/i,
    needle: 'only picked out',
    offers: /^Record again$/i,
  },
];

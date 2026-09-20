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
    // Changed 2026-09-16 with the headings. The body used to open by
    // restating the heading, so what it matches on now is the part that only
    // this state says: whether trying again is worth the time.
    says: /Recording it again usually works/i,
    needle: 'Recording it again usually works',
    offers: /^Try again$/i,
  },
  {
    id: 'fixture-take-unrecoverable',
    what: 'a failure that will not come back',
    label: 'Verdict — failed for good',
    says: /Record it again when you have a moment/i,
    needle: 'Record it again when you have a moment',
    offers: /^Record again$/i,
  },
  {
    id: 'fixture-take-silent',
    what: 'a silent recording',
    label: 'Verdict — nothing heard',
    // `diagnostics.py` distinguishes a silent take from a page with no notes
    // read off it, and the screen must not paraphrase either into the other.
    // Shortened 2026-09-20: the sentence was three clauses of advice under a
    // headline, and the home hero renders it verbatim. The needle follows the
    // copy, and the distinction it guards is unchanged — a silent take says
    // the microphone heard nothing, a page with no notes says the piece has
    // none to compare against.
    says: /no sound reached the microphone/i,
    needle: 'No sound reached the microphone',
    offers: /^Record again$/i,
  },
  {
    id: 'fixture-take-unmatched',
    what: 'a take the pipeline could not find enough of',
    label: 'Verdict — too little of the page heard',
    // Changed 2026-09-14. This read "matching your recording to the score —
    // check you're on the right piece", which is what every early take was
    // told while being the right piece. The counts are the point of the
    // sentence, so the needle keeps them while staying off the exact figures.
    //
    // Shortened again 2026-09-20 to "Only 18 of 76 notes came through." The
    // counts survived the edit, which is what this marker is really pinning:
    // a version of this screen that stops naming them would fail here.
    says: /only \d+ of \d+ notes/i,
    needle: 'notes came through',
    offers: /^Record again$/i,
  },
];

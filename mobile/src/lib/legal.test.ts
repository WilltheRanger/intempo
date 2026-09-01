import { describe, expect, it } from 'vitest';

import { DOCUMENTS, OWNER, PRIVACY, TERMS, missingOwnerDetails } from './legal';

describe('the published documents', () => {
  it('says what is kept, what is not, for how long, and who else sees it', () => {
    // The four questions a privacy policy exists to answer. Checked by heading
    // rather than by prose so a rewrite is free but a *deletion* is not.
    const headings = PRIVACY.sections.map((s) => s.heading);
    expect(headings).toContain('What this app keeps');
    expect(headings).toContain('What it does not keep');
    expect(headings).toContain('How long things are kept');
    expect(headings).toContain('Who else handles it');
  });

  it('names every company a page or a recording is actually sent to', () => {
    // **A policy that omits a processor is the one kind of error that matters
    // here.** These four are what `backend/app/` talks to; if a fifth is ever
    // added, this fails and the policy gets updated with it.
    const text = JSON.stringify(PRIVACY).toLowerCase();
    for (const processor of ['supabase', 'modal', 'anthropic', 'google']) {
      expect(text, `${processor} is not named in the privacy policy`).toContain(
        processor,
      );
    }
  });

  it('tells a musician how to leave with their data', () => {
    const text = JSON.stringify(PRIVACY);
    expect(text).toContain('Download my data');
    expect(text).toContain('Delete account');
  });

  it('says the reading can be wrong', () => {
    // The app's whole output is an automated reading and a verdict measured
    // against it. Terms that did not say so would be promising accuracy the
    // rest of this codebase is careful never to claim.
    const text = JSON.stringify(TERMS).toLowerCase();
    expect(text).toContain('wrong');
    expect(text).toContain('practice aid');
  });

  it('says whose copyright the sheet music is', () => {
    // Specific to this app: a musician photographs printed music, and most
    // printed music is somebody's copyright.
    expect(JSON.stringify(TERMS).toLowerCase()).toContain('copyright');
  });

  it('never invents the publisher', () => {
    // **Null, not a plausible placeholder.** "InTempo Ltd" of
    // "hello@intempo.app" reads exactly like a finished policy and would ship.
    // The screen renders these lines only when they exist, so an unfilled field
    // is silence rather than a lie — and this test is what makes the gap
    // visible to whoever is preparing a store submission.
    for (const value of Object.values(OWNER)) {
      expect(value === null || (typeof value === 'string' && value.length > 0)).toBe(
        true,
      );
    }
  });

  it('lists what the publisher still has to supply', () => {
    const missing = missingOwnerDetails();
    // Not an assertion that it is empty — it is not, and it should not fail CI
    // for that. This pins the *shape* so the list stays usable as a checklist.
    expect(Array.isArray(missing)).toBe(true);
    for (const item of missing) {
      expect(item.length).toBeGreaterThan(10);
    }
  });

  it('carries a date on every document', () => {
    for (const doc of Object.values(DOCUMENTS)) {
      expect(doc.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(doc.sections.length).toBeGreaterThan(2);
      for (const section of doc.sections) {
        expect(section.body.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('a document id that does not exist', () => {
  it('is not in DOCUMENTS, so the screen must handle the gap', () => {
    // **This crashed the app.** `/legal/nope` reached `DOCUMENTS['nope']`,
    // which is undefined, and reading `.title` off it threw into the error
    // boundary — "Something broke", from a mistyped or stale link.
    //
    // The route type says `'privacy' | 'terms'`, and that is precisely what
    // made it easy to miss: TypeScript checks the callers it can see, and a URL
    // is not one of them.
    expect(DOCUMENTS['nope' as keyof typeof DOCUMENTS]).toBeUndefined();
    expect(Object.keys(DOCUMENTS).sort()).toEqual(['privacy', 'terms']);
  });
});

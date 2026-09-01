/**
 * The privacy policy and the terms, as data rather than markup.
 *
 * **Why they exist at all.** Both stores refuse a submission without a privacy
 * policy, and this app holds more than most: an email address, a name, a
 * photograph of the musician, photographs of the music they are working from,
 * and audio recordings of them playing. It also sends pages to two companies
 * that are not us. None of that was written down anywhere a musician could read.
 *
 * **Everything here is checked against the code, not against a template.** The
 * retention sentences name the endpoints that do the deleting; the processor
 * list is the four services the backend actually talks to; and the paragraph on
 * training corrections describes `013_training_corrections.sql`, which is
 * consent-gated and withdrawable. A policy that describes a different app is
 * worse than none, because it is a promise nobody can keep.
 *
 * Data rather than JSX so `legal.test.ts` can hold it to the things a policy has
 * to contain, and so the same words could be published on the web without being
 * retyped.
 */

export interface LegalSection {
  heading: string;
  /** Paragraphs. Rendered as written — no markdown, no links to resolve. */
  body: string[];
}

export interface LegalDocument {
  id: 'privacy' | 'terms';
  title: string;
  /** ISO date of the last substantive change. Shown under the title. */
  updated: string;
  sections: LegalSection[];
}

/**
 * The three facts only the owner can supply.
 *
 * **Null, not a plausible-looking placeholder.** A policy that names
 * "InTempo Ltd" of "hello@intempo.app" in a jurisdiction nobody chose reads
 * exactly like a finished one, and would ship. Null makes the gap visible on
 * the screen and in `missingOwnerDetails`, which is the same stance the rest of
 * this codebase takes on a clef it has not read.
 *
 * Filling these in is the last step before submitting to either store.
 */
export const OWNER: {
  /** The legal person publishing the app — a company, or an individual's name. */
  entity: string | null;
  /** Where a musician writes about their data. A real, monitored address. */
  contact: string | null;
  /** The law the terms are read under, e.g. "England and Wales". */
  jurisdiction: string | null;
} = {
  entity: null,
  contact: null,
  jurisdiction: null,
};

/** Which of `OWNER`'s fields are still unset, in the order they are needed. */
export function missingOwnerDetails(): string[] {
  return (
    [
      ['entity', 'the name of the person or company publishing the app'],
      ['contact', 'an email address for data questions'],
      ['jurisdiction', 'the law these terms are read under'],
    ] as const
  )
    .filter(([key]) => !OWNER[key])
    .map(([, described]) => described);
}

export const PRIVACY: LegalDocument = {
  id: 'privacy',
  title: 'Privacy',
  updated: '2026-08-31',
  sections: [
    {
      heading: 'What this app keeps',
      body: [
        'Your email address and password, so you can sign in. The password is handled by Supabase Auth and is never visible to this app or to us.',
        'Your name, your profile photograph and the instrument you play. You give these once, when you first sign in.',
        'The pieces in your library — their titles, composers and movements — and the notation read from them.',
        'Photographs of sheet music you scan, until the reading is accepted. See “How long things are kept”.',
        'Audio recordings of you playing, and the timing results worked out from them.',
      ],
    },
    {
      heading: 'What it does not keep',
      body: [
        'There is no advertising in this app, and no advertising network is given anything.',
        'There is no analytics or tracking library in it. Nothing records which screens you open or how long you spend on them.',
        'Nothing is sold, and nothing is shared with anyone for marketing.',
        'Your location is never requested or stored.',
      ],
    },
    {
      heading: 'How long things are kept',
      body: [
        'A photograph of a page is deleted as soon as you accept the reading taken from it. Nothing else deletes it — not a confidence score, not a timer — because the photograph is what the reading is checked against.',
        'Deleting a piece deletes its photographs with it.',
        'Recordings and their results stay until you delete the piece or your account, so you can look back at how a passage went.',
        'Deleting your account removes all of it. There is no waiting period and no archived copy.',
      ],
    },
    {
      heading: 'Who else handles it',
      body: [
        'Supabase stores the database and the files, and runs sign-in.',
        'Modal runs the reading of a page and the timing analysis. A page and a recording are sent there to be worked on and are not kept afterwards.',
        'Anthropic is sent a crop of a single line of music when a bar does not add up, so it can be read again. It is sent the picture and nothing about you.',
        'Google is available as an alternative reader and is switched off. If that ever changes, this page changes with it.',
      ],
    },
    {
      heading: 'Helping the reader improve',
      body: [
        'When you correct a bar the app read wrongly, that correction is the most useful thing there is for making the reader better.',
        'It is kept for that purpose only where you have explicitly agreed, in Profile. If you have not agreed, corrections are used to fix your piece and are not kept for anything else.',
        'Withdrawing that agreement deletes what was kept.',
      ],
    },
    {
      heading: 'What you can do',
      body: [
        'Download my data, in Profile, gives you a portable JSON copy of everything the app holds about your account.',
        'Delete account, in Profile, removes it permanently.',
        'You do not have to ask us to do either, and you do not have to explain why.',
      ],
    },
    {
      heading: 'Children',
      body: [
        'This app is written for music students of any age, and a young musician will often be using it because a teacher asked them to.',
        'It asks for no more than it needs: an email address, a name, a photograph and an instrument. If a parent or guardian would like an account removed, deleting it in Profile does so immediately and completely.',
      ],
    },
  ],
};

export const TERMS: LegalDocument = {
  id: 'terms',
  title: 'Terms',
  updated: '2026-08-31',
  sections: [
    {
      heading: 'What this app does',
      body: [
        'InTempo reads a page of music you photograph, listens to you play it, and tells you where you were ahead of the beat and where you were behind.',
      ],
    },
    {
      heading: 'What it cannot promise',
      body: [
        'Reading notation from a photograph is done by a machine and is sometimes wrong. The app shows you what it read and names the bars it is unsure of, and you can correct any of them.',
        'The timing report is only as good as the reading it was measured against. Check the notation before you take a verdict to heart, and treat the whole thing as a practice aid rather than a teacher.',
        'Nothing here is a substitute for a real lesson.',
      ],
    },
    {
      heading: 'The music you photograph',
      body: [
        'Sheet music is usually somebody’s copyright. Photographing a page you own, or one that is out of copyright, for your own practice is ordinarily fine; making copies of music you do not have the right to copy is not, and this app does not change that.',
        'You are responsible for having the right to photograph what you upload. Your pieces, photographs and recordings remain yours, and the app claims no ownership of them.',
      ],
    },
    {
      heading: 'Your account',
      body: [
        'One account is for one person. Keep your password to yourself.',
        'You can stop using the app at any time and delete your account from Profile. If an account is used to break these terms or the law, it may be closed.',
      ],
    },
    {
      heading: 'Changes',
      body: [
        'If these terms or the privacy policy change in a way that matters, the date at the top of the page changes and you will be told in the app before the change takes effect.',
      ],
    },
  ],
};

export const DOCUMENTS: Record<LegalDocument['id'], LegalDocument> = {
  privacy: PRIVACY,
  terms: TERMS,
};

import { canonical, COMPOSERS } from './composers';
import { REPERTOIRE, type Work } from './repertoire';

/**
 * What to offer, in grey, after what has been typed into a title or composer
 * field — the owner's "recommendation in the typing bar kind of like Google
 * Docs" (2026-09-26). The field draws it (`Input`'s `completion`); this
 * decides it.
 *
 * **A completion, not a correction.** Only ever the rest of something that
 * starts with exactly what was typed, so it can be drawn straight after the
 * text without moving it; nothing is offered for text that does not; and
 * nothing is changed unless the musician accepts. What is typed is kept as
 * typed, which is the rule `composers.ts` was built on and still holds.
 *
 * A module rather than a branch in the fields, because there is no React
 * Native testing library here (`DECISIONS.md`, 2026-08-24).
 */

export interface Completion {
  /** Drawn in grey straight after what was typed. Never empty. */
  rest: string;
  /** What the field holds once the suggestion is accepted. */
  value: string;
  /**
   * For a title: the composer it goes with, to fill an empty composer field.
   * Null for a traditional tune, and absent for a composer suggestion.
   */
  composer?: string | null;
}

/** A title the musician already has, offered before the built-in list. */
export interface KnownTitle {
  title: string;
  composer: string | null;
}

/** One character, compared the way a phone keyboard types it. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Where `typed` ends inside `candidate`, if the candidate starts with it —
 * ignoring case and accents, so "dvo" reaches "Dvořák" and "etudes" reaches
 * "Études" — or -1 if it does not.
 *
 * Returned as a position in the **candidate**, because the grey text is the
 * candidate's own rest ("řák", not "rak"), and folding can change a string's
 * length.
 */
export function prefixEnd(candidate: string, typed: string): number {
  const want = fold(typed);
  if (!want) return -1;
  let have = '';
  for (let i = 0; i < candidate.length; i++) {
    have += fold(candidate[i]);
    if (!want.startsWith(have.slice(0, want.length))) return -1;
    if (have.length >= want.length) return have === want ? i + 1 : -1;
  }
  return -1;
}

/** The rest of `candidate` after `typed`, or null when there is none to offer. */
function restOf(candidate: string, typed: string): string | null {
  const end = prefixEnd(candidate, typed);
  return end > 0 && end < candidate.length ? candidate.slice(end) : null;
}

/**
 * The composer to offer for what has been typed.
 *
 * **Surname first**, as a musician thinks of them — "Bee" is Beethoven — and
 * then the name as the app writes it, so "Lud" reaches him too. Accepting
 * either gives the full name the library groups by. Within each, the list's
 * own order, which is roughly how often the music is played: "B" is Bach.
 *
 * Nothing once what is typed already names someone: "Bach" is a composer, not
 * the start of one.
 */
export function completeComposer(typed: string): Completion | null {
  if (!typed.trim() || canonical(typed)) return null;
  for (const composer of COMPOSERS) {
    const rest = restOf(composer.surname, typed);
    if (rest) return { rest, value: composer.name };
  }
  for (const composer of COMPOSERS) {
    const rest = restOf(composer.name, typed);
    if (rest) return { rest, value: composer.name };
  }
  return null;
}

function sameComposer(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const known = canonical(a);
  return known ? known === canonical(b) : fold(a.trim()) === fold(b.trim());
}

/**
 * The title to offer for what has been typed.
 *
 * **The musician's own library first**, then the built-in repertoire
 * (`repertoire.ts`) — the owner's choice: a second movement or another part
 * of something already in the library is the likeliest thing to be typed, and
 * the list is for everything else. A composer already in the composer field
 * puts that composer's titles ahead of the rest, so "Con" after "Bottesini"
 * is his concerto rather than the first concerto in the list.
 *
 * Nothing when the text already is a known title: "Elijah" typed in full is
 * finished, and a Return that then added ", Op. 70" would be a Return that
 * changed what the musician had written.
 */
export function completeTitle(
  typed: string,
  library: readonly KnownTitle[],
  composer = '',
): Completion | null {
  if (!typed.trim()) return null;
  // Two works may share a title ("Viola Concerto", Walton's and Bartók's):
  // the first in order is offered, which is what the order is for.
  const candidates: Work[] = [...library, ...REPERTOIRE]
    .map((work) => ({ title: work.title.trim(), composer: work.composer }))
    .filter((work) => work.title.length > 0);
  const typedKey = fold(typed.trim());
  if (candidates.some((work) => fold(work.title) === typedKey)) return null;

  const chosen = composer.trim() || null;
  const ordered = chosen
    ? [
        ...candidates.filter((work) => sameComposer(work.composer, chosen)),
        ...candidates.filter((work) => !sameComposer(work.composer, chosen)),
      ]
    : candidates;
  for (const work of ordered) {
    const rest = restOf(work.title, typed);
    if (rest) return { rest, value: work.title, composer: work.composer };
  }
  return null;
}

/**
 * Whether a key accepts the grey suggestion.
 *
 * **Tab**, as in every editor that offers one. **→ only at the end of the
 * text**, where it would otherwise do nothing; anywhere else it moves the
 * cursor, and taking that away would be a trap. Return is not here: it
 * arrives as a submit, and the field accepts on that before moving on — the
 * owner's choice of "tap it or press return".
 */
export function acceptsCompletion(key: string, cursorAtEnd: boolean): boolean {
  return key === 'Tab' || (key === 'ArrowRight' && cursorAtEnd);
}

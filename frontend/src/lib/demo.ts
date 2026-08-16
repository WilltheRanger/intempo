/**
 * Demo repertoire for the library and practice screens.
 *
 * Why this exists: the live `GET /v1/library` and `/v1/sessions` endpoints
 * aren't wired yet (pending Supabase keys), but the screens are designed to
 * feel lived-in. Seeding real repertoire lets them render their intended
 * state without a backend. Swap for the real query when the endpoints land.
 *
 * Title and composer are separate fields, not one string: the title is the
 * primary line in every listing and the composer is secondary, so the UI
 * should never have to parse them apart.
 */

export type Verdict = "on" | "mid" | "bad";

/** Broad grouping, used by the library filter. */
export type PieceKind = "concerto" | "suite" | "etude" | "repertoire";

export type LibraryPiece = {
  id: string;
  /** Primary line. */
  title: string;
  /** Grid display name. Long classical titles wrap badly in two columns. */
  shortTitle?: string;
  composer: string;
  /** The movement currently being worked on. */
  movement: string;
  kind: PieceKind;
  /** Pre-formatted; demo data has no live clock. */
  lastPracticed: string;
  favorite: boolean;
  /** 0–1 through the piece, or undefined if never practiced. */
  progress?: number;
};

export type RecentSession = {
  id: string;
  pieceId: string;
  when: string;
  /** One-line verdict, in the teacher's-margin voice. */
  note: string;
  tone: Verdict;
};

export const LIBRARY: LibraryPiece[] = [
  {
    id: "p-dvorak-vc",
    title: "Cello Concerto in B Minor",
    shortTitle: "Cello Concerto",
    composer: "Dvořák",
    movement: "I. Allegro",
    kind: "concerto",
    lastPracticed: "Today",
    favorite: true,
    progress: 0.68,
  },
  {
    id: "p-saint-saens-vc1",
    title: "Cello Concerto No. 1 in A Minor",
    shortTitle: "Concerto No. 1",
    composer: "Saint-Saëns",
    movement: "I. Allegro non troppo",
    kind: "concerto",
    lastPracticed: "2 days ago",
    favorite: false,
    progress: 0.41,
  },
  {
    id: "p-bach-suite-1",
    title: "Suite No. 1 in G Major",
    shortTitle: "Suite No. 1",
    composer: "J. S. Bach",
    movement: "Prélude",
    kind: "suite",
    lastPracticed: "5 days ago",
    favorite: true,
    progress: 0.86,
  },
  {
    id: "p-elgar-vc",
    title: "Cello Concerto in E Minor",
    shortTitle: "Cello Concerto",
    composer: "Elgar",
    movement: "I. Adagio",
    kind: "concerto",
    lastPracticed: "1 week ago",
    favorite: false,
    progress: 0.22,
  },
  {
    id: "p-popper-40",
    title: "High School of Cello Playing, Op. 73",
    shortTitle: "High School",
    composer: "Popper",
    movement: "No. 4",
    kind: "etude",
    lastPracticed: "2 weeks ago",
    favorite: false,
    progress: 0.55,
  },
  {
    id: "p-bruch-kol",
    title: "Kol Nidrei, Op. 47",
    shortTitle: "Kol Nidrei",
    composer: "Bruch",
    movement: "Adagio",
    kind: "repertoire",
    lastPracticed: "3 weeks ago",
    favorite: false,
  },
];

export const RECENT_SESSIONS: RecentSession[] = [
  {
    id: "s-1",
    pieceId: "p-dvorak-vc",
    when: "Today, 4:32 PM",
    note: "Slight rush, m. 8–12",
    tone: "mid",
  },
  {
    id: "s-2",
    pieceId: "p-bach-suite-1",
    when: "5 days ago",
    note: "Steady and expressive",
    tone: "on",
  },
];

export function pieceById(id: string): LibraryPiece | undefined {
  return LIBRARY.find((p) => p.id === id);
}

/** The piece surfaced by "Continue practicing". */
export function continuePiece(): LibraryPiece {
  return pieceById(RECENT_SESSIONS[0].pieceId) ?? LIBRARY[0];
}

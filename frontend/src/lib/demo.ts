/**
 * Demo repertoire + session data for the Home / Library screen.
 *
 * Why this exists: the Home screen is designed to feel lived-in (the
 * moodboard shows a full library and recent sessions), but the live
 * "recent sessions" API and Supabase keys aren't wired yet. Seeding a
 * small built-in library of real repertoire — the "demo-mode" idea from
 * DESIGN_SYSTEM.md — lets the screen render its intended state without
 * depending on a live backend. Swap `useHomeData` for the real query
 * once `GET /v1/sessions` + `/v1/library` land.
 */

export type Verdict = "on" | "mid" | "bad";

export type RecentSession = {
  id: string;
  piece: string;
  movement: string;
  /** Human "when", already formatted — demo data, no live clock. */
  when: string;
  /** One-line teacher's-margin verdict shown under the title. */
  note: string;
  /** Amber note = there's something to refine; ink note = steady. */
  tone: Verdict;
};

export type LibraryPiece = {
  id: string;
  piece: string;
  movement: string;
  lastPracticed: string;
  favorite: boolean;
};

/**
 * Demo pieces are stored as "Composer — Title". Screens that show the
 * composer as its own line split it here rather than each re-parsing.
 */
export function splitPiece(piece: string): { composer: string; title: string } {
  const [composer, title] = piece.split(" — ");
  return title ? { composer, title } : { composer: "", title: piece };
}

export const RECENT_SESSIONS: RecentSession[] = [
  {
    id: "s-dvorak-1",
    piece: "Dvořák — Cello Concerto",
    movement: "I. Allegro",
    when: "Today, 4:32 PM",
    note: "Slight rush, m. 8–12",
    tone: "mid",
  },
  {
    id: "s-bach-suite-1",
    piece: "Bach — Cello Suite No. 1",
    movement: "Prélude",
    when: "May 3, 2024",
    note: "Steady and expressive",
    tone: "on",
  },
];

export const LIBRARY: LibraryPiece[] = [
  {
    id: "p-bruch-vc1",
    piece: "Bruch — Violin Concerto No. 1",
    movement: "I. Vorspiel",
    lastPracticed: "Last practiced May 2",
    favorite: true,
  },
  {
    id: "p-saint-saens-vc1",
    piece: "Saint-Saëns — Cello Concerto No. 1",
    movement: "I. Allegro non troppo",
    lastPracticed: "Last practiced Apr 30",
    favorite: false,
  },
  {
    id: "p-mozart-sinfonia",
    piece: "Mozart — Sinfonia Concertante",
    movement: "I. Allegro maestoso",
    lastPracticed: "Last practiced Apr 28",
    favorite: false,
  },
  {
    id: "p-bach-suite-1-g",
    piece: "Bach — Suite No. 1 in G Major",
    movement: "Prélude",
    lastPracticed: "Last practiced Apr 25",
    favorite: false,
  },
];

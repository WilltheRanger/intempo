import { describe, expect, it } from 'vitest';

/**
 * The action's ink is the action's alone.
 *
 * `actionBg` and `actionText` are the primary button's fill and label: the
 * darkest, heaviest thing on an ivory screen, and so the one place the eye goes
 * first (§3 law 4, one focal point). **Five choice controls borrowed them for
 * their selected state** — the instrument cells, "Learning or teaching?", the
 * tempo's quick picks, the bar editor's note values and switches, and the
 * proofreader's answers — so a chosen "I teach" sat over Next, "Marked · 96"
 * over Done and the half-note chip over Save, two equal focal points on every
 * one of those screens (the UI review, 2026-11-12). They now share
 * `choiceTile`: the ink as an edge, never as a fill.
 *
 * This holds the line. A new use of either token outside the files below
 * fails here and has to be argued for, in this list, with its reason.
 *
 * Counted per file rather than allowed per file: an allowed file is otherwise
 * a place where the next chip can borrow the ink unseen. Read as source text,
 * comments out, the way `ariaState.test.ts` reads it, because there is no
 * React Native testing library here (`DECISIONS.md`, 2026-08-24).
 */
declare global {
  interface ImportMeta {
    glob(pattern: string, options: object): Record<string, string>;
  }
}

// Each glob spells its options out: Vite reads them statically.
const sources: Record<string, string> = {
  ...import.meta.glob('./**/*.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../components/**/*.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../navigation/**/*.tsx', { query: '?raw', import: 'default', eager: true }),
};

/** The uses there are, by file, and why each is the action. */
const ALLOWED: Record<string, { uses: number; why: string }> = {
  '../components/primitives/PrimaryButton.tsx': {
    uses: 4,
    why: 'the primary action itself: its fill, its pressed fill, its label and its glyph',
  },
  './record/RecordScreen.tsx': {
    uses: 5,
    why: "the record button, Record's one action: its disc, pressed disc, and the stop and mic glyphs on it",
  },
  '../components/primitives/Avatar.tsx': {
    uses: 2,
    why: 'the brand mark drawn as a placeholder portrait: a picture, not a control',
  },
};

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

const ACTION_INK = /\bactionBg(?:Pressed)?\b|\bactionText\b/g;

describe('the action ink', () => {
  it('reads the screens, the components and the navigation', () => {
    // A glob that silently matched nothing would pass every check below.
    expect(Object.keys(sources).length).toBeGreaterThan(100);
  });

  it('is used only by the action, and only as many times as it was argued for', () => {
    const found: Record<string, number> = {};
    for (const [path, source] of Object.entries(sources)) {
      const uses = withoutComments(source).match(ACTION_INK)?.length ?? 0;
      if (uses > 0) found[path] = uses;
    }
    const expected = Object.fromEntries(
      Object.entries(ALLOWED).map(([path, { uses }]) => [path, uses]),
    );
    expect(found).toEqual(expected);
  });
});

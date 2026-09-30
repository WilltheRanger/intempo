/**
 * The bars a take's verdict is about, as the passage its button practises:
 * "Practice bars 5–8" (the owner, 2026-09-29, choosing this over "Record
 * again" as the result screen's main action).
 *
 * **Read from the sentence the server wrote**, because that sentence is the
 * only place the range reaches the app. `classification._run_verdict` builds
 * it as `"Bar {n}"` or `"Bars {first}–{last}"` followed by what they did
 * ("went at 104.", "ran ahead."), and the line under the title shows that same
 * range — so a button reading the same words can never name different bars
 * from the line above it. The two shapes are pinned in `passage.test.ts`; a
 * sentence in any other shape ("Steady all the way through.") names no
 * passage, and the screen keeps "Record again" alone.
 *
 * The range this replaced — `passageLabel`, "13 bars" in a row of facts —
 * went with that row: the chart under the verdict already names its first and
 * last bar.
 */

export interface Passage {
  from: number;
  to: number;
}

const RANGE = /^Bars? (\d+)(?:[–-](\d+))? /;

/** The bars a verdict sentence opens with, or null when it names none. */
export function headlinePassage(headline: string | null | undefined): Passage | null {
  const match = headline ? RANGE.exec(headline) : null;
  if (!match) {
    return null;
  }
  const from = Number(match[1]);
  const to = match[2] ? Number(match[2]) : from;
  return to >= from ? { from, to } : null;
}

/** "Practice bar 12", "Practice bars 5–8". */
export function practiceLabel(passage: Passage): string {
  return passage.from === passage.to
    ? `Practice bar ${passage.from}`
    : `Practice bars ${passage.from}–${passage.to}`;
}

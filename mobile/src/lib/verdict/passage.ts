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

/**
 * **The passage to practise next, for every Practice button.**
 *
 * The verdict found the weak bars and offered "Practice bars 5–8", and nothing
 * else in the app knew it: the Library's band and the piece screen opened
 * Record at the start, and Insights worked out a passage of its own and
 * offered bars 5–6 for the same piece under a chart of the same take (the
 * reviews of 2026-11-12). One rule now, read from the newest take the analysis
 * could judge, so the band, the piece, Insights and the result name the same
 * bars.
 *
 * Null when that take failed, was too uncertain to trust, or names no bars;
 * the button is then plain "Practice" from the top.
 */
export function practicePassage(
  take: { headline: string | null; lowConfidence: boolean; failure: unknown } | null | undefined,
): Passage | null {
  if (!take || take.failure !== null || take.lowConfidence) {
    return null;
  }
  return headlinePassage(take.headline);
}

/**
 * The line Record shows while a take still starts where a Practice button
 * sent it: "Practicing bars 5–8". The buttons name a passage; without this the
 * screen they opened never mentioned it. Gone once the musician moves the
 * start, because then they are practising something else.
 */
export function practicingLine(
  opened: { startAt?: number; endAt?: number },
  startFrom: number | null,
): string | null {
  const { startAt, endAt } = opened;
  if (startAt === undefined || endAt === undefined || startFrom !== startAt || endAt < startAt) {
    return null;
  }
  return startAt === endAt ? `Practicing bar ${startAt}` : `Practicing bars ${startAt}–${endAt}`;
}

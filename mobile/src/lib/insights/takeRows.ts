import type { TakeResult } from '../../data/types';
import { asLabel } from '../library/pieceStatus';
import { formatTakeVerdict } from '../tempo';
import { failureTitle, intakeRefusal, nothingUsableTitle } from '../verdict/failureTitle';

/**
 * "Your takes" on a piece as rows — the owner's choice of 2026-09-25, over a
 * card with a chart in it that competed with the score for the top of the
 * page. Each row is when, and what that take's verdict said. The rows have
 * their own page since 2026-09-29 (`PieceTakesScreen`).
 */

/**
 * What a take's verdict said, in a row's width: the sentence under its title
 * ("Bars 13–25 went at 81"), or the heading of a take that gave none ("We
 * didn't hear you play"). No full stop: a row is a label, not a sentence.
 */
export function takeRowWords(take: TakeResult): string {
  if (take.failure !== null) {
    return intakeRefusal(take.failure.reason)?.title ?? failureTitle(take.failure);
  }
  if (take.status !== 'ok') {
    return nothingUsableTitle(take.status);
  }
  const words = take.headline.trim().replace(/\.$/, '') || 'Take';
  // **With its unit and what it was aiming for** (2026-09-29). "Bars 5–8 went
  // at 104" three times down a page said nothing a first-time reader could
  // weigh: 104 what, and against what? The verdict screen gives both; a row
  // now does too.
  const run = /^(.*) went at (\d+)$/.exec(words);
  if (run && Number.isFinite(take.targetBpm) && Number(run[2]) !== Math.round(take.targetBpm)) {
    return `${run[1]} at ${run[2]}, not ${Math.round(take.targetBpm)} BPM`;
  }
  return words;
}

/**
 * Whether a take's row carries a verdict, or says there was none to give — a
 * take the analysis refused or could not time. **The owner, 2026-09-25**: the
 * loudest words under the score were three refusals in full ink. A refusal
 * recedes; a reading leads.
 */
export function takeRowIsVerdict(take: TakeResult): boolean {
  return take.failure === null && take.status === 'ok';
}

/**
 * A row's title: the take's own result title as a label ("Rushed in the
 * middle", "Held the tempo") — the words its result opens with — or the
 * heading of a take that gave no reading. Replaced the sentence under the
 * title, which down a page read "Bars 5–8 at 104, not 96 BPM" six times; the
 * figure has its own column now.
 */
export function takeRowTitle(take: TakeResult): string {
  if (!takeRowIsVerdict(take)) return takeRowWords(take);
  if (take.lowConfidence) return 'Timing is uncertain';
  return asLabel(formatTakeVerdict(take.measures, take.direction));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * When a take was, for its row — on every row (a row left blank because the
 * one above said the same read as a missing date, 2026-09-29): "Today",
 * "Yesterday", "3 days ago" within the week, then the date itself, with the
 * year once it is not this one.
 */
export function takeDateLabel(iso: string, now: Date = new Date()): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((day(now) - day(when)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const date = `${MONTHS[when.getMonth()]} ${when.getDate()}`;
  return when.getFullYear() === now.getFullYear() ? date : `${date}, ${when.getFullYear()}`;
}

/**
 * The line under a piece's takes when it has more than were fetched: "The
 * last 12 of 40". The page lists every take it has, so it has no "See all";
 * this is what stops twelve rows passing for all forty. Null when every take
 * is on the page.
 */
export function olderTakesNote(total: number, loaded: number): string | null {
  if (loaded >= total) {
    return null;
  }
  return `The last ${loaded} of ${total}`;
}

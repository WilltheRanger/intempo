import type { UserRole, UserTier } from '../data/types';

/** Whole calendar days between two dates, ignoring time of day. */
function calendarDaysBetween(from: Date, to: Date): number {
  const startOfFrom = new Date(
    from.getFullYear(),
    from.getMonth(),
    from.getDate(),
  );
  const startOfTo = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((startOfTo.getTime() - startOfFrom.getTime()) / msPerDay);
}

/**
 * Whole days since a piece was last practiced, or null if it never was.
 *
 * Shared so the Library's grouping and its row labels can't disagree about
 * which week something falls in — a row reading "5 days" under a heading that
 * says "Earlier this month" is the kind of thing nobody notices in review and
 * everybody notices in use.
 */
export function daysSincePracticed(
  isoTimestamp: string | null,
  now: Date = new Date(),
): number | null {
  if (!isoTimestamp) {
    return null;
  }
  const practicedAt = new Date(isoTimestamp);
  if (Number.isNaN(practicedAt.getTime())) {
    return null;
  }
  return calendarDaysBetween(practicedAt, now);
}

/**
 * "Practiced yesterday", "Practiced 3 weeks ago".
 *
 * Returns null when there is no timestamp, so callers omit the line entirely
 * rather than rendering a placeholder.
 *
 * `now` is here so a caller that has already decided *which* piece against a
 * given instant can describe it against the same one. `today.suggestionsFor`
 * takes a `now` and did not pass it, so with an injected clock it chose the
 * piece against that instant and then labelled it off the wall clock — a
 * fortnight-old take reading "Practiced yesterday". Harmless in the app, where
 * both are the current time, and a trap for anything that ever isn't.
 */
export function formatLastPracticed(
  isoTimestamp: string | null,
  now: Date = new Date(),
): string | null {
  const days = daysSincePracticed(isoTimestamp, now);
  if (days === null) {
    return null;
  }

  if (days <= 0) {
    return 'Practiced today';
  }
  if (days === 1) {
    return 'Practiced yesterday';
  }
  if (days < 7) {
    return `Practiced ${days} days ago`;
  }
  if (days < 28) {
    const weeks = Math.round(days / 7);
    return weeks === 1 ? 'Practiced last week' : `Practiced ${weeks} weeks ago`;
  }

  const months = Math.round(days / 30);
  return months <= 1 ? 'Practiced last month' : `Practiced ${months} months ago`;
}

/**
 * The same age, in a couple of words, for the right-hand column of a list.
 *
 * "Practiced 3 weeks ago" is a sentence, and a sentence repeated down forty
 * rows stops being read. This is the column you scan to find what you have
 * been neglecting, so it says only what changes from row to row.
 */
export function formatLastPracticedShort(
  isoTimestamp: string | null,
  now: Date = new Date(),
): string | null {
  const days = daysSincePracticed(isoTimestamp, now);
  if (days === null) {
    return null;
  }
  if (days <= 0) {
    return 'Today';
  }
  if (days === 1) {
    return 'Yesterday';
  }
  if (days < 7) {
    return `${days} days`;
  }
  if (days < 28) {
    const weeks = Math.round(days / 7);
    return weeks === 1 ? 'Last week' : `${weeks} weeks`;
  }
  const months = Math.round(days / 30);
  return months <= 1 ? 'Last month' : `${months} months`;
}


const TIER_LABELS: Record<UserTier, string> = {
  free: 'Free',
  pro: 'Pro',
  teacher: 'Teacher',
  student_via_teacher: 'Student, via teacher',
};

const ROLE_LABELS: Record<UserRole, string> = {
  student: 'Student',
  teacher: 'Teacher',
};

/**
 * Account tier and role, as a person reads them.
 *
 * Both fall back to the raw value rather than a guess: if the backend adds a
 * tier these will show `enterprise` until it's given a label here, which is
 * visible, where silently printing "Free" would not be.
 */
export function formatTier(tier: UserTier): string {
  return TIER_LABELS[tier] ?? tier;
}

export function formatRole(role: UserRole): string {
  return ROLE_LABELS[role] ?? role;
}

/** Joins metadata fragments, dropping the ones that had no value. */
export function joinMetadata(parts: (string | null | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join('  ·  ');
}

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
 * "Practiced yesterday", "Practiced 3 weeks ago".
 *
 * Returns null when there is no timestamp, so callers omit the line entirely
 * rather than rendering a placeholder. Nothing behind the API supplies this
 * yet — see `data/sources/api.ts`.
 */
export function formatLastPracticed(isoTimestamp: string | null): string | null {
  if (!isoTimestamp) {
    return null;
  }

  const practicedAt = new Date(isoTimestamp);
  if (Number.isNaN(practicedAt.getTime())) {
    return null;
  }

  const days = calendarDaysBetween(practicedAt, new Date());

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

/** `0.62` becomes `"62%"`. Null in, null out. */
export function formatProgressPercent(progress: number | null): string | null {
  if (progress === null || Number.isNaN(progress)) {
    return null;
  }
  const clamped = Math.min(Math.max(progress, 0), 1);
  return `${Math.round(clamped * 100)}%`;
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

/**
 * Time-of-day greeting for the Today screen heading.
 *
 * Deliberately plain. The brief rules out motivational copy, so this states
 * the time of day and nothing more.
 */
export function getGreeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) {
    return 'Good morning';
  }
  if (hour < 18) {
    return 'Good afternoon';
  }
  return 'Good evening';
}

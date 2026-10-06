/**
 * How a day is written in the app: "Sep 18", "September 18".
 *
 * **In the app's own language, not the browser's.** Two lines formatted dates
 * with the device's locale while every word around them was English, so the
 * piece screen read "7 since 18. Sept." in a German browser and "7 since
 * 9月18日" in a Japanese one, beside rows of "Sep 18" on the screen it opens
 * (measured 2026-10-06). The free-analysis reset sentence would have read
 * "Recording returns on 1. November." Month first, as the take rows already
 * wrote it. The day is the device's local day, as it was.
 */
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "Sep 18". */
export function shortDate(date: Date): string {
  return `${SHORT[date.getMonth()]} ${date.getDate()}`;
}

/** "September 18". */
export function longDate(date: Date): string {
  return `${LONG[date.getMonth()]} ${date.getDate()}`;
}

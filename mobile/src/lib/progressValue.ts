/**
 * How far along a progress bar is, as the props a screen reader reads.
 *
 * `accessibilityValue` is dropped by react-native-web — found on the analysis
 * wait's bar, 2026-09-20 — and a `progressbar` with no value is announced as
 * indeterminate: "busy", the reading every bar in this app exists to replace.
 * Measured 2026-10-05, all five bars in the app reached the browser that way.
 * The `aria-value*` props reach both platforms: the DOM on the web, and
 * `accessibilityValue` on native.
 *
 * A percentage, so a screen reader says "40 percent" rather than a fraction.
 * `null` is a bar with nothing to measure yet — an upload before its first
 * byte — and stays indeterminate, which is then the truth.
 */
export interface ProgressValue {
  'aria-valuemin'?: number;
  'aria-valuemax'?: number;
  'aria-valuenow'?: number;
}

export function progressValue(fraction: number | null): ProgressValue {
  if (fraction === null || !Number.isFinite(fraction)) return {};
  return {
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': Math.round(Math.max(0, Math.min(1, fraction)) * 100),
  };
}

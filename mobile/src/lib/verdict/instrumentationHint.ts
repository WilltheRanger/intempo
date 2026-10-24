/**
 * Whether the result screen shows the advisory instrumentation caveat.
 *
 * Only `true` shows anything. `false` means the pipeline checked and found
 * nothing, which is not news worth a line on screen; `null` covers an older
 * take, an un-migrated row, and a failed computation — all "no signal",
 * never read as "all clear".
 */
export function shouldShowInstrumentationHint(instrumentationFlagged: boolean | null): boolean {
  return instrumentationFlagged === true;
}

/**
 * The browser has no audio session, and no silent switch to override.
 *
 * A no-op rather than an absent module: every caller would otherwise need a
 * platform branch around a line that means "be audible", which is the default
 * everywhere except iOS.
 */
export async function prepareForPlayback(): Promise<void> {}

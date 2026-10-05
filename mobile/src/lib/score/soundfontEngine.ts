/**
 * The synthesiser and its sound banks, as the one thing playback loads late.
 *
 * **One door, because two let it in at the front.** `warmPlayback` and
 * `sampledPlayback` each imported `soundfontBank` and `soundfontRender`
 * separately, and both of those import `spessasynth_core`. Shared between two
 * lazily-loaded chunks, it was hoisted by the web export into `__common`,
 * which `index.html` loads with the app — 78 KB gzipped of synthesiser on
 * every first visit, for a Listen button most visits never press, and outside
 * the main bundle where the size check looks (measured 2026-10-05). Imported
 * through here alone, it stays in a chunk of its own until playback asks.
 */
export { loadSoundfont } from './soundfontBank';
export { renderSoundfont } from './soundfontRender';

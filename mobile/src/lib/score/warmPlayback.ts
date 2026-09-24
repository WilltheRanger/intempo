import type { Instrument } from '../../data/types';

/**
 * Fetching what Listen needs *before* Listen is pressed.
 *
 * **Measured, because the obvious diagnosis was wrong.** Listen felt slow, and
 * the suspicion was the synthesis — the whole passage is rendered to PCM
 * before a note sounds. It is not: `spessasynth_core` renders **23–45× faster
 * than real time** (5 s of audio in 216 ms, 60 s in 1325 ms), and parsing the
 * soundfont costs 24 ms. Rendering a minute-long passage is about a second.
 *
 * What is actually on the path between the tap and the first note is the
 * network, and none of it starts until the tap:
 *
 *   - `import('./soundfontRender')` pulls `spessasynth_core` — a synthesiser,
 *     620 KB of JavaScript — as its own lazily-loaded chunk.
 *   - `loadSoundfont` fetches the instrument's `.sf2`, 0.8–1.3 MB.
 *
 * So the musician decides to listen and *then* waits for up to two
 * megabytes. On a phone away from wifi that is the whole complaint, and when it
 * outlasts the watchdog it is the other half of it — "can't listen" rather
 * than "slow".
 *
 * This moves both fetches earlier, to the moment a Listen button appears on
 * screen. Nothing about playback changes; the work is the same work, done
 * while the musician is still reading the page rather than after they have
 * asked to hear it. `loadSoundfont` already caches per instrument, so the tap
 * finds the bank sitting in the same map it would have filled itself.
 *
 * **Never a failure path.** Warming is an optimisation and a failed warm must
 * be indistinguishable from never having warmed: the press repeats the work
 * and reports its own errors, which is where the musician can see them. So
 * every rejection is swallowed here, and `listenFailure` stays the only place
 * that speaks.
 */

/** Instruments already warmed (or in flight), so a re-render costs nothing. */
const warmed = new Set<Instrument>();

/**
 * Whether the browser has asked us not to spend a megabyte unasked.
 *
 * Data Saver is the one signal a musician gives about their connection, and a
 * pre-fetch is exactly the kind of speculative traffic it is meant to stop.
 * Listen still works — it simply pays on the tap, as it always did.
 *
 * Wrapped because `navigator.connection` is non-standard and absent on native.
 */
function saveDataRequested(): boolean {
  try {
    const connection = (
      globalThis as { navigator?: { connection?: { saveData?: boolean } } }
    ).navigator?.connection;
    return connection?.saveData === true;
  } catch {
    return false;
  }
}

/**
 * Start fetching the synthesiser and the instrument bank for `instrument`.
 *
 * Returns nothing and never rejects. Safe to call on every render.
 */
export function warmPlayback(instrument: Instrument): void {
  if (warmed.has(instrument) || saveDataRequested()) return;
  warmed.add(instrument);
  void (async () => {
    try {
      // The chunk first: it is the larger download and the one the render
      // cannot start without. Awaited rather than fired in parallel so a slow
      // connection spends its bandwidth in the order the tap will need it.
      const { loadSoundfont } = await import('./soundfontBank');
      await import('./soundfontRender');
      await loadSoundfont(instrument);
    } catch {
      // A warm that failed is a warm that did not happen. Let the press try
      // again and report in its own words.
      warmed.delete(instrument);
    }
  })();
}

/**
 * Forget which instruments have been warmed.
 *
 * @test-seam the set lives for the life of the process — that is the point of
 * it — and a suite cannot test the second call being free without a way to put
 * it back to the first.
 */
export function resetWarmPlaybackForTests(): void {
  warmed.clear();
}

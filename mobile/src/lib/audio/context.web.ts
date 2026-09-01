/**
 * The one `AudioContext` this app ever creates in a browser.
 *
 * **Why one, and never closed.** Both players used to construct a context per
 * playback and close it when the sound finished. That is tidy and it is the
 * shape of the commonest "audio works once on iPhone" bug there is: Safari on
 * iOS caps how many audio contexts a page may hold, and `close()` does not
 * reliably give the slot back. The second Listen then gets a context that is
 * born suspended, or none at all — the button works, the schedule is built,
 * every oscillator is created, and nothing comes out.
 *
 * It is also what a long piece plus a locked screen produces without any cap
 * involved: `requestAnimationFrame` stops when the page is hidden, so the tick
 * that ends playback never runs, so `close()` never runs, and the context
 * leaks with no way back.
 *
 * One context for the life of the page removes both. Web Audio is designed for
 * this — a context is a mixer, not a sound.
 *
 * **Resumed on every play, inside the gesture.** A context can be suspended by
 * the autoplay policy before the first tap, and *interrupted* afterwards by
 * anything the operating system decides matters more: a phone call, another
 * app, the microphone opening for a take. Asking it to resume costs nothing
 * when it is already running.
 */

let shared: AudioContext | null = null;

type Ctor = typeof AudioContext;

function constructor(): Ctor | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext ??
    null
  );
}

/**
 * The shared context, or null where Web Audio does not exist.
 *
 * A context that has somehow been closed is replaced rather than returned —
 * nothing here closes one, but a closed context accepts no nodes at all and
 * silently producing nothing is the failure this module exists to prevent.
 */
export function audioContext(): AudioContext | null {
  if (shared && shared.state !== 'closed') {
    return shared;
  }
  const Ctor = constructor();
  if (!Ctor) {
    return null;
  }
  try {
    shared = new Ctor();
  } catch {
    // **iOS throws here when the page is at its context limit**, which is the
    // state the per-playback context used to leave it in. Sharing one should
    // mean this never happens — but it is reached from a button's press
    // handler, and a throw there takes the whole press down: the label flips
    // to Stop and nothing plays, which is a worse version of the bug this
    // module exists to fix. Silence with an honest `null` is recoverable; the
    // caller reports not playing and the next press tries again.
    return null;
  }
  return shared;
}

/** Ask a suspended or interrupted context to run again. Never throws. */
export function resumeAudio(context: AudioContext): void {
  if (context.state === 'running') {
    return;
  }
  try {
    void context.resume();
  } catch {
    // Some browsers reject a resume outside a gesture. The caller is inside
    // one; if this fails there is nothing better to try.
  }
}

/** Test seam: forget the context so the next call builds a new one. */
export function resetAudioContextForTests(): void {
  shared = null;
}

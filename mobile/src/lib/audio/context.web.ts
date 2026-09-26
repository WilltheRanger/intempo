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

/**
 * The shared context, but only if one already exists.
 *
 * Separate from `audioContext()` because that one *builds* a context when
 * there is none, and the caller below wants the opposite: to know whether
 * something is already holding the audio session. Asking with `audioContext()`
 * would create the very thing it is checking for.
 */
export function existingAudioContext(): AudioContext | null {
  return shared && shared.state !== 'closed' ? shared : null;
}

/**
 * Give the operating system's audio session back, before asking for capture.
 *
 * **This is the half of the iPhone recording bug that two fixes missed.**
 * WebKit rejects `getUserMedia` with `InvalidStateError` when a *playback*
 * audio session is running, because capture needs the session category and
 * will not take it by force. The first fix stopped this app claiming one
 * immediately before asking (`audioRecorder.web.ts` now takes the microphone
 * first); the second stopped it building a second context at all. Neither
 * touched the context **Listen** leaves running, which predates the whole
 * call — and the comment written for the second fix says exactly that:
 *
 *   > taking the microphone first only helps when the running context is
 *   > *ours*. Listen leaves the shared one running, and nothing here could
 *   > see it.
 *
 * Suspending releases the session without closing the context, which is the
 * distinction that matters: `close()` on iOS does not reliably give the slot
 * back — that is this module's founding argument — and `suspend()` keeps the
 * mixer, the sample rate and the registered worklet intact. The recorder
 * resumes it once the microphone is granted, which is a state WebKit is happy
 * to put a playback graph back into.
 *
 * Never throws and never waits forever: a browser that refuses to suspend is
 * no worse off than before this existed.
 */
export async function releaseAudioSession(): Promise<void> {
  const context = existingAudioContext();
  if (!context || context.state !== 'running') {
    return;
  }
  try {
    await context.suspend();
  } catch {
    // Some engines reject a suspend on a context that is already going away.
    // The capture request is the next thing to happen either way.
  }
}

/** Ask a suspended or interrupted context to run again. Never throws. */
export function resumeAudio(context: AudioContext): void {
  if (context.state === 'running') {
    return;
  }
  try {
    void context.resume().catch(() => {});
  } catch {
    // Some browsers reject a resume outside a gesture. The caller is inside
    // one; if this fails there is nothing better to try.
  }
}

/**
 * Suspend a context whose clock has stopped while it says `running`, so the
 * caller's next resume starts it again (`clockStart.ts`). Never throws, and
 * does not wait: the promise is a hint and the state is the fact, and the
 * caller is already polling the state.
 */
export function kickAudio(context: AudioContext): void {
  try {
    void context.suspend().catch(() => {});
  } catch {
    // An engine that refuses to suspend leaves the context as it was; the
    // caller's deadline still ends the wait.
  }
}

/**
 * Let go of a context whose clock stopped and would not start again, so the
 * next `audioContext()` — the retry, inside a tap — builds a new one.
 *
 * **The exception to this module's rule, and a narrow one.** One context for
 * the life of the page is right because a new one costs a slot iOS may not
 * give back. A context whose clock has stopped is already a lost slot: keeping
 * it means every Listen, count-in and metronome for the rest of the page
 * schedules onto a clock that never reaches them (`clockStart.ts`, 2026-09-26).
 *
 * Closed as well as forgotten, so the stopped render thread is released if
 * WebKit will release it. Only the shared context is let go: a caller holding
 * one this module has already replaced has nothing to hand back.
 */
export function abandonAudioContext(context: AudioContext): void {
  if (shared !== context) {
    return;
  }
  shared = null;
  try {
    void context.close().catch(() => {});
  } catch {
    // Already closing, or an engine that refuses; it is forgotten either way.
  }
}

/**
 * Forget the context so the next call builds a new one.
 *
 * @test-seam the module holds one lazily-built `AudioContext` for the life of
 * the process, and a suite cannot test the building of it twice without a way
 * to put that back.
 */
export function resetAudioContextForTests(): void {
  shared = null;
}

/**
 * Waiting for a context to actually be running, rather than for `resume()` to
 * say so.
 *
 * **The distinction is the whole module, and it is not pedantry.** On iOS
 * WebKit the promise returned by `AudioContext.resume()` frequently never
 * settles — not rejects, *never settles* — on a context that goes on to reach
 * `running` a moment later. Code that awaits that promise against a deadline
 * therefore reports failure on a context that is working.
 *
 * That is the bug this was written for. `audioRecorder.web.ts` did:
 *
 *     await Promise.race([resume, rejectAfter(5_000)]);
 *
 * and a musician on an iPhone got "Audio did not start. Return to this screen
 * and try Record again." on take after take, while the microphone was open and
 * the context was running. The sentence was wrong in the one way a failure
 * message must never be: it blamed the device for something that had already
 * succeeded, and told them to retry a thing that had not failed.
 *
 * **Why the recorder cannot simply resume inside the gesture.** The obvious
 * fix — call `resume()` synchronously in the tap, as `context.web.ts` says
 * playback does — is not available to it. `releaseAudioSession()` *suspends*
 * the shared context on purpose before asking for the microphone, because
 * WebKit will not reassign the audio session away from a running context; the
 * capture request fails with `InvalidStateError` otherwise. So the take must
 * suspend first and resume after `getUserMedia`, by which point the gesture is
 * three awaits gone. The ordering is load-bearing, which leaves reading the
 * state as the only honest way to know.
 *
 * The state is authoritative and the promise is a hint. Ask for the resume,
 * then watch `state`; re-ask on each look, because an interrupted context can
 * refuse the first request and accept a later one once the system has finished
 * whatever took precedence.
 */

/** The part of `AudioContext` this needs, so a test can supply one. */
export interface RunnableContext {
  readonly state: AudioContextState;
  resume(): Promise<void>;
}

export interface ResumeOptions {
  /** How long to keep watching before giving up, in milliseconds. */
  timeoutMs?: number;
  /** How often to look at `state`, in milliseconds. */
  pollMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests. */
  now?: () => number;
}

export const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * How often to look.
 *
 * Short enough that a context which runs promptly is not held up by the poll
 * — the common case on a healthy device is one or two looks — and long enough
 * that a refusing context is not asked sixty times a second for five seconds.
 */
export const DEFAULT_POLL_MS = 50;

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * Read the state, in a way the compiler cannot narrow.
 *
 * **Not a style choice.** After `if (context.state === 'running')`, TypeScript
 * narrows `state` to the remaining members for the rest of the scope and then
 * reports every later comparison against `'running'` as an impossible one. It
 * is reasoning about a property that changes underneath it: the whole purpose
 * of the loop below is that a context which was suspended a moment ago is
 * running now. Going through a function whose return type is the full union
 * keeps each read a fresh question, which is what it is.
 */
const stateOf = (context: RunnableContext): AudioContextState => context.state;

/** Ask, and swallow everything. A refused resume is a state to re-read. */
function ask(context: RunnableContext): void {
  try {
    void context.resume().catch(() => {});
  } catch {
    // Some engines throw synchronously outside a gesture rather than
    // rejecting. Either way the answer is the same: look at the state.
  }
}

/**
 * Resume a context and report whether it actually reached `running`.
 *
 * Returns `true` as soon as the state says so, `false` if the deadline passes
 * with it still suspended or interrupted. **It does not throw**, because every
 * caller has a different thing to say about the failure and a shared exception
 * would make them all say the same one.
 *
 * A context that is already running costs one state read and no resume.
 */
export async function resumeToRunning(
  context: RunnableContext,
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    pollMs = DEFAULT_POLL_MS,
    sleep = wait,
    now = Date.now,
  }: ResumeOptions = {},
): Promise<boolean> {
  if (stateOf(context) === 'running') {
    return true;
  }

  const deadline = now() + timeoutMs;
  ask(context);

  for (;;) {
    if (stateOf(context) === 'running') {
      return true;
    }
    if (now() >= deadline) {
      // One last read: the poll and the deadline can land in the same
      // millisecond, and failing a context that is running is the bug.
      return stateOf(context) === 'running';
    }
    await sleep(pollMs);
    ask(context);
  }
}

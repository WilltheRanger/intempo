/**
 * Whether a playback's audio clock has got going, and what to do while it has
 * not.
 *
 * **Reported from the owner's iPhone on 2026-09-26**, on the page-review screen
 * straight after photographing a page: *"Audio couldn't start. Tap Listen to
 * retry. (AudioStartTimeout: context running after 2030ms)"*. The cause in the
 * parentheses is the case `listenFailure.startTimeout` was written to tell
 * apart and had not yet seen: a context that says `running` while its
 * `currentTime` stands still. That is not a refused resume — there is nothing
 * to resume — and it is not iOS taking the session away, which Safari reports
 * as `interrupted`. The clock itself has stopped, underneath a state that says
 * it has not.
 *
 * **And retrying could never have worked.** The app keeps one context for the
 * life of the page (`context.web.ts`), and every retry asks it to resume, which
 * on a context that is already `running` does nothing. So the sentence told the
 * musician to do the one thing that would fail the same way, for as long as
 * the page stayed open.
 *
 * What starts the clock again is not certain, so there are two answers, the
 * cheap one first:
 *
 *  1. **Kick it.** A context that has said `running` for half a second
 *     without its clock moving is suspended; the watch loop's own resume then
 *     brings it back. Suspending and resuming outside a gesture is what the
 *     recorder does on every take (`running.ts`), on the same phone, so WebKit
 *     is known to accept it.
 *  2. **Replace it.** If the clock still has not moved by the deadline, the
 *     context is let go (`abandonAudioContext`), so the retry the sentence
 *     asks for builds a new one — inside the tap, which is the one place iOS
 *     lets a new context start.
 *
 * A module rather than a branch in `scorePlayer.web.ts` because there is no
 * React Native testing library here (`DECISIONS.md`, 2026-08-24), and both of
 * the player's start loops need the same rule.
 */

/**
 * How long a context may say `running` with its clock still, before it is
 * kicked, in wall-clock ms the page was visible.
 *
 * A healthy clock passes a playback's start — scheduled 80 ms ahead — within
 * about that long of running. Half a second is several times that and still
 * leaves most of the start window for the kick to work in. Measured from when
 * the context was *last seen running*, not from the tap, so a context that
 * took a moment to resume is not kicked for having only just arrived.
 */
export const KICK_AFTER_RUNNING_MS = 500;

/**
 * How long to give the audio clock to start moving at all, in wall-clock ms
 * the page was visible.
 *
 * Wall time on purpose: the audio clock is the thing under suspicion, so it
 * cannot also be the judge.
 */
export const START_TIMEOUT_MS = 2000;

/** What the watch loop should do on this look. */
export type StartStep = 'started' | 'wait' | 'kick' | 'give-up';

export interface StartLook {
  /** Whether the audio clock has passed the moment the playback starts at. */
  started: boolean;
  /** The context's state now: `running`, `suspended`, `interrupted`, `closed`. */
  state: string;
  /** Wall-clock ms the page has been visible since the playback began waiting. */
  visibleMs: number;
  /** Of those, how long the context has been seen `running` without a break. */
  runningMs: number;
  /** Whether this playback has already kicked the context. Once is enough. */
  kicked: boolean;
}

export function startStep({ started, state, visibleMs, runningMs, kicked }: StartLook): StartStep {
  if (started) return 'started';
  if (visibleMs >= START_TIMEOUT_MS) return 'give-up';
  if (state === 'running' && !kicked && runningMs >= KICK_AFTER_RUNNING_MS) return 'kick';
  return 'wait';
}

/**
 * Whether a playback that gave up leaves the context itself unusable, so the
 * next Listen should build a new one.
 *
 * `running` at the deadline is a stopped clock, which no resume can fix. A
 * context this playback kicked was running and stopped too, whatever it says
 * now — it may still be `suspended` if WebKit refused the resume that follows a
 * kick outside a gesture.
 *
 * **Not** a context that was `suspended` or `interrupted` all along: the retry
 * resumes those inside a gesture, which is what they were waiting for, and a
 * new context during a phone call would only be interrupted too — spending one
 * of the page's few contexts (`context.web.ts`) on nothing.
 */
export function clockStopped(state: string, kicked: boolean): boolean {
  return state === 'running' || kicked;
}

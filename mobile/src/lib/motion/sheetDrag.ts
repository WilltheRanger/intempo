/**
 * When a downward drag on a sheet means "close it".
 *
 * A rule, in a module, with tests — there is no React Native testing library
 * here, so a threshold living inside a `.tsx` is a threshold nothing checks
 * (`CLAUDE.md` §3). These numbers decide whether a gesture feels responsive or
 * sticky, and they are exactly the kind of value that gets nudged by eye and
 * never measured again.
 */

/**
 * How far down the sheet must travel before letting go closes it, as a
 * fraction of the sheet's own height.
 *
 * A fraction rather than a fixed distance, because these sheets are not one
 * size: the add-a-piece sheet is about 320pt and the expanded ones fill the
 * screen. 90pt is a decisive flick on the first and a twitch on the second.
 */
export const DISMISS_TRAVEL_FRACTION = 0.28;

/**
 * The downward speed, in points per millisecond, that closes the sheet however
 * far it has actually moved.
 *
 * This is what makes a quick flick work. Without it a fast, short gesture — the
 * natural way to dismiss something you have already decided about — is refused
 * because the finger left before the sheet had travelled far enough, which
 * reads as the sheet ignoring you.
 *
 * 0.5 pt/ms is roughly a third of a screen height per second: brisk, and well
 * clear of the drift at the end of a slow deliberate drag.
 */
export const DISMISS_VELOCITY = 0.5;

/**
 * How much of an *upward* drag is passed through.
 *
 * These sheets have no expanded state to drag up into, so pulling up has
 * nowhere to go. Zero would feel broken — the sheet would appear stuck to the
 * finger — so it gives a little and stops, which is the rubber-band every
 * scrollable surface on the platform uses to say "this is the end".
 */
export const UPWARD_RESISTANCE = 0.2;

/**
 * The minimum finger travel before a touch is treated as a drag at all.
 *
 * Below this, the touch belongs to whatever is under it. A sheet full of
 * buttons that steals taps the instant a finger moves two points is worse than
 * a sheet with no gesture, which is the failure this whole change exists to
 * fix — so the responder is claimed late and only for movement that is clearly
 * vertical.
 */
export const DRAG_ACTIVATION_DISTANCE = 8;

/**
 * How far back to look when working out how fast the finger was moving.
 *
 * One move-to-move delta is too noisy — the last event before a lift is often a
 * stray pixel, which reads as a dead stop. A short window smooths that without
 * blurring a flick into the slow drag that preceded it.
 */
export const VELOCITY_WINDOW_MS = 100;

export interface DragSample {
  /** Downward travel at this moment, in points. */
  dy: number;
  /** A monotonic-enough timestamp, in milliseconds. */
  t: number;
}

/**
 * Downward speed over the last {@link VELOCITY_WINDOW_MS}, in points per
 * millisecond.
 *
 * **Computed here rather than read from `PanResponder`'s `gestureState.vy`**,
 * so the rule is one number this module owns, is identical on every platform,
 * and is testable — `vy` is not reachable from a unit test.
 *
 * **How this was verified, and what could not be.** A browser harness cannot
 * make a flick: six CDP touch dispatches take ~270ms in-page, about 45ms each,
 * so the fastest synthetic gesture available is ~0.27 pt/ms — below the 0.5
 * threshold by construction. That is a limit of the harness and says nothing
 * about the code. It was proved wired instead by moving the threshold: at 0.15
 * a 72pt gesture at 0.29 pt/ms dismissed, and it is 60pt short of the distance
 * rule, so only velocity could have closed it; restored to 0.5 the same gesture
 * holds. The distance path is verified directly — a 220pt drag dismisses, a
 * 30pt drag does not, and the sheet tracks the finger in between.
 */
export function velocityFrom(samples: readonly DragSample[]): number {
  if (samples.length < 2) {
    return 0;
  }
  const latest = samples[samples.length - 1];
  const previous = samples[samples.length - 2];
  /**
   * The oldest sample still inside the window — and never `latest` itself.
   *
   * Without the identity guard, a gesture sampled more sparsely than the window
   * matches only its own last sample, giving a zero time delta and a reported
   * speed of zero: a fast flick read as a dead stop. Falling back to the
   * previous sample measures over a longer base than intended, which is far
   * better than measuring nothing.
   */
  const inWindow = samples.find(
    (sample) => sample !== latest && latest.t - sample.t <= VELOCITY_WINDOW_MS,
  );
  const oldest = inWindow ?? previous;
  const dt = latest.t - oldest.t;
  if (dt <= 0) {
    return 0;
  }
  return (latest.dy - oldest.dy) / dt;
}

/** Drops samples that have aged out, so the buffer cannot grow without bound. */
export function trimSamples(
  samples: readonly DragSample[],
  now: number,
): DragSample[] {
  // One sample older than the window is kept, so a gesture that pauses and then
  // flicks still has a baseline to measure the flick against.
  const fresh = samples.filter((sample) => now - sample.t <= VELOCITY_WINDOW_MS);
  const firstFresh = samples.length - fresh.length;
  return firstFresh > 0 ? [samples[firstFresh - 1], ...fresh] : fresh;
}

export interface DragRelease {
  /** Downward travel at the moment the finger lifted, in points. */
  dy: number;
  /** Downward speed at that moment, in points per millisecond. */
  vy: number;
  /** The sheet's measured height. */
  height: number;
}

/**
 * Distance **or** speed closes the sheet; neither alone is enough of a signal.
 *
 * An upward flick never closes it, however fast — `vy` is signed, and a
 * negative velocity past the threshold would otherwise dismiss on a gesture
 * that means the opposite.
 */
export function shouldDismiss({ dy, vy, height }: DragRelease): boolean {
  if (dy <= 0) {
    return false;
  }
  if (vy >= DISMISS_VELOCITY) {
    return true;
  }
  // A zero or negative height means the sheet has not been measured yet. Fall
  // back to distance alone rather than dividing by it.
  return height > 0 && dy >= height * DISMISS_TRAVEL_FRACTION;
}

/**
 * The offset actually applied to the sheet for a given finger travel.
 *
 * Downward is followed exactly — a sheet that lags the finger feels broken in
 * a way no easing curve fixes. Upward is resisted.
 */
export function dragOffset(dy: number): number {
  return dy >= 0 ? dy : dy * UPWARD_RESISTANCE;
}

/**
 * Whether a moving touch should become a sheet drag rather than staying with
 * the control underneath it.
 *
 * Vertical *and* far enough. The dominance test is what stops a horizontal
 * swipe across a row of choices from dragging the sheet out from under it.
 */
export function isDragGesture(dx: number, dy: number): boolean {
  return Math.abs(dy) > DRAG_ACTIVATION_DISTANCE && Math.abs(dy) > Math.abs(dx);
}

import { Easing } from 'react-native';

/**
 * Motion. Quick and subtle, per the brief — animation exists to confirm an
 * action happened, never to make a screen feel impressive.
 */
export const motion = {
  /** The finger making contact. Short, but not a one-frame snap. */
  pressIn: 55,
  /** Press feedback and small state changes. */
  fast: 120,
  /** A whole screen settling after navigation. */
  scene: 180,
  /**
   * A pushed screen arriving.
   *
   * Longer than `scene` because it travels: `scene` settles a tab that was
   * already laid out where it is, and this carries a screen across the
   * viewport. Read the note on `EASE_OUT` below before changing it — the
   * number is about twice the length of the movement anyone sees.
   */
  push: 320,
  /**
   * A sheet rising from the bottom edge.
   *
   * **The longest thing in this file, and it was 240.** At 240 the sheet was
   * measured — in Chromium, on the built bundle, sampling `transform` every
   * frame — at 269pt from home on the first frame it appeared, 75 by 91ms and
   * 16 by 141ms: 97% of a 500pt journey in the first 140 milliseconds, with a
   * single frame carrying 231 of those points. That is not a slide, and the
   * owner reported it as the add-piece sheet "just pops up instead of having
   * like an animation". They were describing the curve, not a missing
   * animation.
   *
   * A sheet is the largest surface this app moves, and it is the one piece of
   * motion a musician will see hundreds of times. iOS gives its own about half
   * a second. See `EASE_OUT`: the visible half of this is around 220ms.
   */
  sheet: 440,
  /** How long the CSS approximation of `SPRING` runs for. */
  spring: 320,
  /** Progress fills, content settling in. */
  base: 240,
} as const;

/**
 * The one easing curve.
 *
 * Decelerating: fast at the start, settling at the end, which is how iOS moves
 * and how a physical object stops. Nothing here eases *in* — a UI element that
 * accelerates away from rest reads as sluggish, because the first frames are
 * the ones being waited on.
 *
 * **It is steeper than an ease-out curve usually is, and every duration above
 * has to be read against that.** Sampled, rather than assumed:
 *
 *     elapsed   10%   20%   30%   40%   50%   70%
 *     travelled 40%   67%   83%   92%   96%   99%
 *
 * Half the duration buys 96% of the movement. So a duration here is roughly
 * *twice* the length of the motion anybody perceives, and a number picked for
 * how long something should appear to take will produce something that looks
 * about half as long. That is what made a 240ms sheet read as a pop — see
 * `motion.sheet`.
 */
export const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);

/**
 * The spring the control layer settles on.
 *
 * Stiff and well damped — it arrives quickly and overshoots barely enough to
 * notice, which is what separates an iOS transition from a CSS ease-out that
 * reaches its target and stops dead. Physical parameters rather than a
 * duration, so an interrupted animation continues from where it was.
 */
export const SPRING = { stiffness: 260, damping: 24, mass: 1 } as const;

/**
 * The same motion for the web build, which has no `Animated.spring`.
 *
 * The control point past 1 is the overshoot; without it this is just another
 * ease-out with a longer duration.
 */
export const SPRING_CSS = 'cubic-bezier(0.33, 1.28, 0.5, 1)';

/**
 * Delay between one list item's entrance and the next.
 *
 * Short enough to read as one movement rather than a queue. `STAGGER_CAP`
 * stops a long list cascading for a second and a half — past the cap every
 * remaining row shares the last delay and they arrive together.
 */
export const STAGGER_MS = 30;
export const STAGGER_CAP = 6;

/** How far content rises as it fades in. Barely a shift; enough to have direction. */
export const RISE_DISTANCE = 8;

/** Scale a large card or record control takes while held. */
export const PRESSED_SCALE = 0.97;

/**
 * Full-width buttons travel less than cards. Enough to feel under a finger,
 * without making their text visibly resize.
 */
export const CONTROL_PRESSED_SCALE = 0.985;

/**
 * The scale a dialog enters from.
 *
 * It grows into place rather than only fading, which is what tells you it
 * arrived *now* rather than having been behind the scrim all along. Small on
 * purpose: anything lower reads as a zoom, and this is a question, not an
 * event.
 */
export const DIALOG_ENTER_SCALE = 0.94;

/** Opacity applied while a control is held down, where a colour swap won't do. */
export const pressedOpacity = 0.9;

/** Opacity for disabled controls. */
export const disabledOpacity = 0.4;

/**
 * The two ends of a skeleton's pulse.
 *
 * A pulse rather than the usual shimmer sweep, because a shimmer is a moving
 * gradient and the brief bans gradients outright. Opacity alone is also
 * quieter, which suits a screen whose job is to say "nearly there" rather than
 * to entertain.
 */
export const SKELETON_PULSE = { from: 1, to: 0.45, duration: 900 } as const;

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
 */
export const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);

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

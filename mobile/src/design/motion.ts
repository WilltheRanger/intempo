/**
 * Motion. Quick and subtle, per the brief — animation exists to confirm an
 * action happened, never to make a screen feel impressive.
 */
export const motion = {
  /** Press feedback and small state changes. */
  fast: 120,
  /** Progress fills, content settling in. */
  base: 240,
} as const;

/** Opacity applied while a control is held down, where a colour swap won't do. */
export const pressedOpacity = 0.9;

/** Opacity for disabled controls. */
export const disabledOpacity = 0.4;

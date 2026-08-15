/**
 * Shared motion tokens. Every animation in the app pulls from here so timing
 * and feel stay consistent instead of being re-decided per component.
 *
 * Rules these encode (Emil Kowalski's "Animations on the Web"):
 *  - enters ease-out at 200–300ms; exits ~75% of that
 *  - springs wherever an animation can be interrupted
 *  - transform and opacity only (GPU-composited; never animate layout)
 *  - every consumer gates on `useReducedMotion()`
 */

import type { Variants, Transition } from "motion/react";

/** The app's easing curve — matches `ease-ios` in tailwind.config.js. */
export const EASE_IOS = [0.32, 0.72, 0, 1] as const;
/** Softer decelerate for content settling into place. */
export const EASE_OUT_QUINT = [0.23, 1, 0.32, 1] as const;

/** Default interactive spring — close to the iOS system feel. */
export const spring: Transition = {
  type: "spring",
  stiffness: 300,
  damping: 30,
  mass: 0.9,
};

/** Snappier, for small elements like tab indicators. */
export const springSnappy: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 34,
};

/** Looser, for large surfaces like a sheet sliding up. */
export const springSheet: Transition = {
  type: "spring",
  stiffness: 260,
  damping: 30,
  mass: 1,
};

/** Tabbed screens: a quiet crossfade with a slight rise. */
export const pageVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE_OUT_QUINT } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.18, ease: "easeIn" } },
};

/** Flow screens: presented like an iOS sheet, dismissed downward. */
export const sheetVariants: Variants = {
  hidden: { opacity: 0, y: 32 },
  visible: { opacity: 1, y: 0, transition: springSheet },
  exit: { opacity: 0, y: 24, transition: { duration: 0.2, ease: "easeIn" } },
};

/** Parent of a staggered list. Pair with `listItem`. */
export const listContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.04 } },
};

export const listItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE_OUT_QUINT } },
};

/** Routes presented as sheets rather than tab crossfades. */
export function isFlowRoute(pathname: string): boolean {
  return (
    pathname === "/scores/new" ||
    pathname.startsWith("/analyses/") ||
    /^\/scores\/[^/]+\/record$/.test(pathname)
  );
}

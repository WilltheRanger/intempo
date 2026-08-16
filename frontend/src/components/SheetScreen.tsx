import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

import { springSheet } from "../lib/motion";

/**
 * Presents a full-screen flow (capture / record / verdict) the way iOS
 * presents a modal sheet: rising from below on a spring rather than cutting in.
 *
 * Entrance only. An exit animation would need `AnimatePresence` around the
 * router, which unmounts the whole tree mid-transition — that's what made the
 * tab bar blink, so the trade is deliberate: these screens leave instantly and
 * arrive smoothly, which is the half users actually notice.
 */
export function SheetScreen({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();

  if (reduce) return <>{children}</>;

  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springSheet}
    >
      {children}
    </motion.div>
  );
}

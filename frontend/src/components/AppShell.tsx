import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { useMe } from "../hooks/useApi";
import { TabBar } from "./TabBar";
import { pageVariants } from "../lib/motion";

/**
 * The main tabbed app surface — a phone-width column framed against the
 * page ground, with the bottom tab bar pinned. This is the "device"
 * chrome from the moodboard (Home / Insights / Profile live here). Flow
 * screens that take over the viewport (capture, record, result) use the
 * plain `Layout` instead.
 *
 * The transition lives here rather than around `<Routes>` so the frame and
 * tab bar stay mounted while the content swaps. Animating the router itself
 * unmounted the shell too, and the tab bar visibly blinked on every switch.
 */
export function AppShell() {
  // Kicks off the /v1/me fetch + store hydration once signed in.
  useMe();
  const location = useLocation();
  const reduce = useReducedMotion();

  return (
    <div className="min-h-[100dvh] bg-paper">
      <div className="mx-auto flex min-h-[100dvh] max-w-[440px] flex-col border-line bg-paper-raised sm:border-x">
        <main className="flex-1 px-5 pb-6 pt-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              variants={reduce ? undefined : pageVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
        <div className="sticky bottom-0 z-20">
          <TabBar />
        </div>
      </div>
    </div>
  );
}

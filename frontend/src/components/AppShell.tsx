import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { useMe } from "../hooks/useApi";
import { TabBar } from "./TabBar";
import { TopNav } from "./layout/TopNav";
import { PracticeBar } from "./layout/PracticeBar";
import { pageVariants } from "../lib/motion";

/**
 * The main application surface.
 *
 * Responsive by breakpoint rather than one layout squeezed into a phone
 * column: at `lg` and up this is a full-width workspace with top navigation;
 * below that it falls back to a single column with the bottom tab bar. The
 * previous 440px frame made desktop look like a phone stranded on a canvas.
 *
 * The transition wraps the outlet, not the router, so navigation chrome stays
 * mounted while content swaps.
 */
export function AppShell() {
  // Kicks off the /v1/me fetch + store hydration once signed in.
  useMe();
  const location = useLocation();
  const reduce = useReducedMotion();

  return (
    <div className="flex min-h-[100dvh] flex-col bg-paper">
      <TopNav />

      <main className="flex-1">
        <div className="mx-auto w-full max-w-[1240px] px-5 pb-16 pt-7 lg:px-8 lg:pb-20 lg:pt-10">
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
        </div>
      </main>

      {/* Persistent bottom furniture. The practice action sits directly above
          the tab bar so it lands in the thumb zone; both are opaque and flush,
          not floating over the content. */}
      <div className="sticky bottom-0 z-20 lg:hidden">
        {location.pathname === "/" && <PracticeBar />}
        <TabBar />
      </div>
    </div>
  );
}

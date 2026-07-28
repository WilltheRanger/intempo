import { Outlet } from "react-router-dom";

import { useMe } from "../hooks/useApi";
import { TabBar } from "./TabBar";

/**
 * The main tabbed app surface — a phone-width column framed against the
 * page ground, with the bottom tab bar pinned. This is the "device"
 * chrome from the moodboard (Home / Insights / Profile live here). Flow
 * screens that take over the viewport (capture, record, result) use the
 * plain `Layout` instead.
 */
export function AppShell() {
  // Kicks off the /v1/me fetch + store hydration once signed in.
  useMe();

  return (
    <div className="min-h-[100dvh] bg-paper">
      <div className="mx-auto flex min-h-[100dvh] max-w-[440px] flex-col border-line bg-paper-raised sm:border-x">
        <main className="flex-1 px-5 pb-6 pt-8">
          <Outlet />
        </main>
        <div className="sticky bottom-0 z-20">
          <TabBar />
        </div>
      </div>
    </div>
  );
}

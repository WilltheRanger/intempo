import { supabaseConfigured } from "../lib/supabase";

/**
 * Marks the static GitHub Pages build as what it is: the real screens, but
 * running on `lib/demo.ts` seed data with no backend behind them. Without
 * this, "Record" and "Photograph sheet music" look broken rather than absent.
 *
 * Only renders in a production build with no Supabase keys — so it never
 * appears in local dev, and disappears the moment real keys are supplied.
 */
export function PreviewBadge() {
  if (!import.meta.env.PROD || supabaseConfigured) return null;

  return (
    // Sits in the desktop gutter beside the phone column; on narrow screens it
    // lifts above the tab bar so it never covers navigation.
    <div className="pointer-events-none fixed bottom-[96px] left-3 z-50 md:bottom-4 md:left-4">
      <span className="pointer-events-auto rounded-full border border-line-2 bg-paper-raised/95 px-3 py-1.5 text-[11px] text-ink-mute shadow-card backdrop-blur-sm">
        Preview — demo data, no backend
      </span>
    </div>
  );
}

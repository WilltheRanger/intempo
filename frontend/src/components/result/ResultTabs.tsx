import { motion } from "motion/react";
import { Headphones, MusicNotes, ListBullets, Sparkle } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";

import { cn } from "../../lib/cn";

export type ResultTab = "listen" | "score" | "details" | "next";

const TABS: Array<{ id: ResultTab; label: string; Icon: Icon }> = [
  { id: "listen", label: "Listen", Icon: Headphones },
  { id: "score", label: "Score", Icon: MusicNotes },
  { id: "details", label: "Details", Icon: ListBullets },
  { id: "next", label: "Next steps", Icon: Sparkle },
];

/** Contextual result tabs with a shared-layout indicator that springs
 *  between tabs (animate skill: layoutId + spring). */
export function ResultTabs({
  active,
  onChange,
}: {
  active: ResultTab;
  onChange: (tab: ResultTab) => void;
}) {
  return (
    <nav
      aria-label="Result sections"
      className="sticky bottom-0 border-t border-line bg-paper/95 backdrop-blur-sm"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-[440px]">
        {TABS.map(({ id, label, Icon }) => {
          const isActive = active === id;
          return (
            <li key={id} className="flex-1">
              <button
                onClick={() => onChange(id)}
                className="relative flex w-full flex-col items-center gap-1 py-2.5"
              >
                {isActive && (
                  <motion.span
                    layoutId="result-tab"
                    className="absolute inset-x-3 inset-y-1 -z-10 rounded-lg bg-amber-soft"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <Icon
                  size={21}
                  weight={isActive ? "fill" : "regular"}
                  className={cn(
                    "transition-colors duration-200",
                    isActive ? "text-amber-deep" : "text-ink-mute",
                  )}
                />
                <span
                  className={cn(
                    "text-[10px] transition-colors duration-200",
                    isActive ? "font-medium text-ink" : "text-ink-mute",
                  )}
                >
                  {label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

import { NavLink } from "react-router-dom";
import {
  House,
  BookOpen,
  ChartLineUp,
  User,
  type Icon,
} from "@phosphor-icons/react";

import { motion, useReducedMotion } from "motion/react";

import { cn } from "../lib/cn";
import { springSnappy } from "../lib/motion";

type Tab = {
  to: string;
  label: string;
  Icon: Icon;
  /** Match nested routes (e.g. /scores/new) to the Record tab too. */
  end?: boolean;
};

// Destinations only. Adding a piece is an action and lives as an explicit
// "+ Add piece" control in the screen headers, not in navigation.
const TABS: Tab[] = [
  { to: "/", label: "Today", Icon: House, end: true },
  { to: "/scores", label: "Library", Icon: BookOpen },
  { to: "/insights", label: "Insights", Icon: ChartLineUp },
  { to: "/account", label: "Profile", Icon: User },
];

export function TabBar() {
  const reduce = useReducedMotion();

  return (
    <nav
      aria-label="Primary"
      className="border-t border-line bg-paper"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-[440px] items-stretch">
        {TABS.map(({ to, label, Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={end}
              className="press group flex min-h-[58px] flex-col items-center justify-center gap-1 py-3 outline-none"
            >
              {({ isActive }) => (
                <>
                  {/* Spring pop on select — the one place a little overshoot
                      earns its keep, since it confirms the tap. */}
                  <motion.span
                    animate={reduce ? undefined : { scale: isActive ? 1 : 0.92 }}
                    transition={springSnappy}
                    className="block"
                  >
                    <Icon
                      size={25}
                      weight={isActive ? "fill" : "regular"}
                      className={cn(
                        "transition-colors duration-200 ease-ios",
                        isActive ? "text-amber-deep" : "text-ink-mute",
                        "group-focus-visible:text-amber-deep",
                      )}
                    />
                  </motion.span>
                  <span
                    className={cn(
                      "text-[11px] tracking-tight transition-colors duration-200 ease-ios",
                      isActive
                        ? "font-medium text-ink"
                        : "text-ink-mute",
                    )}
                  >
                    {label}
                  </span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

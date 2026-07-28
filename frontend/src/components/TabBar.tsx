import { NavLink } from "react-router-dom";
import {
  BookOpen,
  Microphone,
  ChartLineUp,
  User,
  type Icon,
} from "@phosphor-icons/react";

import { cn } from "../lib/cn";

type Tab = {
  to: string;
  label: string;
  Icon: Icon;
  /** Match nested routes (e.g. /scores/new) to the Record tab too. */
  end?: boolean;
};

const TABS: Tab[] = [
  { to: "/", label: "Library", Icon: BookOpen, end: true },
  { to: "/scores/new", label: "Record", Icon: Microphone },
  { to: "/insights", label: "Insights", Icon: ChartLineUp },
  { to: "/account", label: "Profile", Icon: User },
];

export function TabBar() {
  return (
    <nav
      aria-label="Primary"
      className="border-t border-line bg-paper-raised/95 backdrop-blur-sm"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-[440px] items-stretch">
        {TABS.map(({ to, label, Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={end}
              className="group flex flex-col items-center gap-1 py-2.5 outline-none"
            >
              {({ isActive }) => (
                <>
                  <Icon
                    size={22}
                    weight={isActive ? "fill" : "regular"}
                    className={cn(
                      "transition-colors duration-200 ease-ios",
                      isActive ? "text-amber-deep" : "text-ink-mute",
                      "group-focus-visible:text-amber-deep",
                    )}
                  />
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

import { NavLink, Link } from "react-router-dom";
import { Plus } from "@phosphor-icons/react";

import { cn } from "../../lib/cn";

const NAV = [
  { to: "/", label: "Library", end: true },
  { to: "/insights", label: "Insights" },
  { to: "/account", label: "Account" },
];

/**
 * Desktop navigation. A compact top bar rather than a sidebar: this app has
 * three destinations, so a sidebar would spend 240px of horizontal space to
 * show three words. Hidden below `lg`, where `MobileTabBar` takes over.
 */
export function TopNav() {
  return (
    <header className="sticky top-0 z-30 hidden border-b border-line bg-paper/85 backdrop-blur-md lg:block">
      <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-8 px-8">
        <Link to="/" className="shrink-0" aria-label="InTempo home">
          <span className="font-serif text-[17px] tracking-[0.2em] text-ink">
            INTEMPO
          </span>
        </Link>

        <nav aria-label="Primary" className="flex items-center gap-1">
          {NAV.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "rounded-sm px-3 py-1.5 text-[13.5px] transition-colors duration-150",
                  isActive
                    ? "text-ink"
                    : "text-ink-mute hover:text-ink",
                )
              }
            >
              {({ isActive }) => (
                <span className="relative">
                  {label}
                  {isActive && (
                    <span className="absolute -bottom-[7px] left-0 right-0 h-[1.5px] bg-ink" />
                  )}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <Link
            to="/scores/new"
            className="press inline-flex items-center gap-1.5 rounded-sm border border-line-2 px-3 py-1.5 text-[13px] text-ink transition-colors duration-150 hover:bg-paper-warm"
          >
            <Plus size={13} weight="bold" />
            Add piece
          </Link>
        </div>
      </div>
    </header>
  );
}

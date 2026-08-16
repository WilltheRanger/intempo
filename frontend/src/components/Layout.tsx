import { Outlet } from "react-router-dom";

import { useMe } from "../hooks/useApi";
import { Header } from "./Header";

const VERSION = "v0.1.0";

export function Layout() {
  // Kicks off the /v1/me fetch + store hydration once signed in.
  useMe();

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4 text-xs text-ink-faint">
          <span>InTempo {VERSION}</span>
          <a
            href="/v1/health"
            className="transition-colors duration-200 ease-ios hover:text-ink-mute"
          >
            status
          </a>
        </div>
      </footer>
    </div>
  );
}

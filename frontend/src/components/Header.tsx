import { Link } from "react-router-dom";

import { useAuth } from "../hooks/useAuth";
import { Wordmark } from "./Wordmark";

export function Header() {
  const { status, email, signOut } = useAuth();

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-5">
        <Link to="/" aria-label="InTempo home">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-3 text-sm">
          {status === "signedIn" && email && (
            <>
              <span className="hidden text-ink-mute sm:inline">{email}</span>
              <button
                onClick={() => void signOut()}
                className="rounded-sm px-2 py-1 text-amber-deep transition-colors duration-200 ease-ios hover:bg-paper-warm"
              >
                Sign out
              </button>
            </>
          )}
          {status === "signedOut" && (
            <Link
              to="/login"
              className="rounded-sm px-2 py-1 text-amber-deep transition-colors duration-200 ease-ios hover:bg-paper-warm"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../hooks/useAuth";
import { Eyebrow } from "./ui/Eyebrow";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status, configured } = useAuth();

  // No Supabase keys → there is no auth to enforce and no backend to reach,
  // so there's nothing to protect: render the screens against `lib/demo.ts`
  // seed data. This is what makes the static preview build viewable. With
  // keys present, `configured` is true and the gate below behaves normally.
  if (!configured) {
    return <>{children}</>;
  }

  if (status === "loading") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Eyebrow>Loading</Eyebrow>
      </div>
    );
  }
  if (status === "signedOut") {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

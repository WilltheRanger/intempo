import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../hooks/useAuth";
import { Eyebrow } from "./ui/Eyebrow";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();

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

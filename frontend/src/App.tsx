import { useEffect } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useParams,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useAuthListener } from "./hooks/useAuth";
import { initAnalytics } from "./lib/analytics";
import { Layout } from "./components/Layout";
import { AppShell } from "./components/AppShell";
import { StubPage } from "./components/StubPage";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { HomeRoute } from "./routes/HomeRoute";
import { LoginRoute } from "./routes/LoginRoute";
import { ScoreListRoute } from "./routes/ScoreListRoute";
import { ScoreCaptureRoute } from "./routes/ScoreCaptureRoute";
import { RecordRoute } from "./routes/RecordRoute";
import { ResultRoute } from "./routes/ResultRoute";
import { AccountRoute } from "./routes/AccountRoute";
import { ShowcaseRoute } from "./routes/ShowcaseRoute";
import { PreviewBadge } from "./components/PreviewBadge";
import { SheetScreen } from "./components/SheetScreen";

const queryClient = new QueryClient();

/** Wraps a route element in the auth gate. */
function Protected({ element }: { element: ReactNode }) {
  return <ProtectedRoute>{element}</ProtectedRoute>;
}

/**
 * There's no score-detail screen yet, and `/scores/:id` used to render the
 * whole library — confusing. Send it to the thing you'd want anyway until a
 * detail screen exists.
 */
function ScoreDetailRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? `/scores/${id}/record` : "/scores"} replace />;
}

function AppRoutes() {
  return (
    <Routes>
          <Route path="/login" element={<LoginRoute />} />
          {/* Tabbed surfaces — phone-frame shell with the bottom tab bar. */}
          <Route element={<AppShell />}>
            <Route path="/" element={<Protected element={<HomeRoute />} />} />
            <Route path="/scores" element={<Protected element={<ScoreListRoute />} />} />
            <Route path="/scores/:id" element={<Protected element={<ScoreDetailRedirect />} />} />
            <Route
              path="/insights"
              element={
                <Protected
                  element={
                    <StubPage eyebrow="Insights" title="Your progress">
                      Tempo trends and per-piece steadiness will live here.
                      Coming in a later batch.
                    </StubPage>
                  }
                />
              }
            />
            <Route path="/account" element={<Protected element={<AccountRoute />} />} />
          </Route>
          {/* Flow screens that still use the plain header/footer chrome. */}
          <Route element={<Layout />}>
            {/* Public so the design system is reviewable without auth. */}
            <Route path="/showcase" element={<ShowcaseRoute />} />
          </Route>
          {/* Full-bleed flow screens with their own chrome. */}
          <Route path="/scores/new" element={<Protected element={<SheetScreen><ScoreCaptureRoute /></SheetScreen>} />} />
          <Route path="/scores/:id/record" element={<Protected element={<SheetScreen><RecordRoute /></SheetScreen>} />} />
          <Route path="/analyses/:id" element={<Protected element={<SheetScreen><ResultRoute /></SheetScreen>} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  useAuthListener();
  useEffect(() => {
    initAnalytics();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AppRoutes />
        {/* Outside AnimatedRoutes: it's `fixed`, and a transformed ancestor
            would re-anchor it to the page wrapper instead of the viewport. */}
        <PreviewBadge />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;

import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useAuthListener } from "./hooks/useAuth";
import { initAnalytics } from "./lib/analytics";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { HomeRoute } from "./routes/HomeRoute";
import { LoginRoute } from "./routes/LoginRoute";
import { ScoreListRoute } from "./routes/ScoreListRoute";
import { ScoreCaptureRoute } from "./routes/ScoreCaptureRoute";
import { RecordRoute } from "./routes/RecordRoute";
import { ResultRoute } from "./routes/ResultRoute";
import { AccountRoute } from "./routes/AccountRoute";
import { ShowcaseRoute } from "./routes/ShowcaseRoute";

const queryClient = new QueryClient();

/** Wraps a route element in the auth gate. */
function Protected({ element }: { element: ReactNode }) {
  return <ProtectedRoute>{element}</ProtectedRoute>;
}

function App() {
  useAuthListener();
  useEffect(() => {
    initAnalytics();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Protected element={<HomeRoute />} />} />
            <Route path="/scores" element={<Protected element={<ScoreListRoute />} />} />
            <Route path="/scores/new" element={<Protected element={<ScoreCaptureRoute />} />} />
            <Route path="/scores/:id" element={<Protected element={<ScoreListRoute />} />} />
            <Route path="/scores/:id/record" element={<Protected element={<RecordRoute />} />} />
            <Route path="/analyses/:id" element={<Protected element={<ResultRoute />} />} />
            <Route path="/account" element={<Protected element={<AccountRoute />} />} />
            {/* Public so the design system is reviewable without auth. */}
            <Route path="/showcase" element={<ShowcaseRoute />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;

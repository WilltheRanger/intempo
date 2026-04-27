import { useEffect, useState } from "react";

import { getHealth } from "./lib/api";

type Status = "loading" | "ok" | "not-ok";

function App() {
  const [status, setStatus] = useState<Status>("loading");
  const [detail, setDetail] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then((res) => {
        if (cancelled) return;
        if (res.status === "ok") {
          setStatus("ok");
          setDetail(JSON.stringify(res));
        } else {
          setStatus("not-ok");
          setDetail(`unexpected payload: ${JSON.stringify(res)}`);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus("not-ok");
        setDetail(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const label =
    status === "loading"
      ? "checking backend…"
      : status === "ok"
        ? "backend: ok"
        : "backend: not ok";

  const color =
    status === "ok"
      ? "text-emerald-600"
      : status === "not-ok"
        ? "text-red-600"
        : "text-neutral-500";

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-3 p-8">
      <h1 className="text-3xl font-medium">InTempo</h1>
      <p className={`text-base ${color}`}>{label}</p>
      {detail && (
        <pre className="text-xs text-neutral-500 max-w-md break-all whitespace-pre-wrap">
          {detail}
        </pre>
      )}
    </main>
  );
}

export default App;

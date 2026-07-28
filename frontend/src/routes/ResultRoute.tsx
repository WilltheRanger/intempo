import { Link, useNavigate, useParams } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { X } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { useAnalysisPolling } from "../hooks/useRecordingApi";
import { VerdictView } from "../components/result/VerdictView";

export function ResultRoute() {
  const { id } = useParams();
  const { data: row, isError } = useAnalysisPolling(id);

  if (isError) {
    return (
      <FullScreen>
        <Message title="Something went wrong">
          We couldn&rsquo;t load this analysis. Please try again.
        </Message>
      </FullScreen>
    );
  }

  if (!row || row.status === "queued" || row.status === "processing") {
    return (
      <FullScreen>
        <Analyzing />
      </FullScreen>
    );
  }

  if (row.status === "failed" || row.status === "failed_recoverable") {
    return (
      <FullScreen>
        <Message title="We couldn't finish that one">
          The analysis didn&rsquo;t complete. Try recording again.
          <RecordAgain scoreId={row.score_id} />
        </Message>
      </FullScreen>
    );
  }

  const result = row.result_json;
  if (!result || result.status !== "ok") {
    return (
      <FullScreen>
        <Message title="We couldn't quite hear it">
          {result?.verdict ??
            "We had trouble matching this take to the score. Give it another go."}
          <RecordAgain scoreId={row.score_id} />
        </Message>
      </FullScreen>
    );
  }

  return <VerdictView result={result} scoreId={row.score_id} />;
}

function FullScreen({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-[100dvh] flex-col bg-paper">
      <div className="px-5 pt-4">
        <button
          onClick={() => navigate("/")}
          aria-label="Close"
          className="grid size-9 place-items-center rounded-full text-ink transition-colors duration-200 hover:bg-paper-warm active:scale-90"
        >
          <X size={20} />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center px-6">{children}</div>
    </div>
  );
}

function Analyzing() {
  const reduce = useReducedMotion();
  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <motion.span
        className="size-3 rounded-full bg-amber"
        animate={reduce ? undefined : { scale: [1, 0.7, 1], opacity: [1, 0.5, 1] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="flex flex-col gap-1">
        <p className="font-serif text-2xl italic text-ink">Reading your tempo…</p>
        <p className="text-[13px] text-ink-soft">
          Listening measure by measure. This usually takes about 12 seconds.
        </p>
      </div>
    </div>
  );
}

function Message({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex max-w-[320px] flex-col items-center gap-2 text-center">
      <h1 className="font-serif text-xl text-ink">{title}</h1>
      <div className="text-[14px] text-ink-soft">{children}</div>
    </div>
  );
}

function RecordAgain({ scoreId }: { scoreId: string }) {
  return (
    <div className="pt-4">
      <Link to={`/scores/${scoreId}/record`}>
        <button className="rounded-full border border-line-2 px-5 py-2.5 text-sm text-ink transition-colors duration-200 hover:bg-paper-warm active:scale-[0.98]">
          Record again
        </button>
      </Link>
    </div>
  );
}

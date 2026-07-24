import { Link, useParams } from "react-router-dom";

import { useAnalysisPolling } from "../hooks/useRecordingApi";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Eyebrow } from "../components/ui/Eyebrow";
import { ProgressBar } from "../components/ui/ProgressBar";
import { VerdictCard } from "../components/result/VerdictCard";
import { AnnotatedScore } from "../components/result/AnnotatedScore";
import { TrendChart } from "../components/result/TrendChart";
import { PerNoteDetail } from "../components/result/PerNoteDetail";

export function ResultRoute() {
  const { id } = useParams();
  const { data: row, isError } = useAnalysisPolling(id);

  if (isError) {
    return (
      <Message title="Something went wrong">
        We couldn&rsquo;t load this analysis. Please try again.
      </Message>
    );
  }

  if (!row || row.status === "queued" || row.status === "processing") {
    return (
      <Card className="flex flex-col gap-4">
        <Eyebrow>Analyzing</Eyebrow>
        <p className="text-[15px] text-ink-soft">
          Listening measure by measure — this usually takes about 12 seconds.
        </p>
        <ProgressBar label="Reading your tempo…" />
      </Card>
    );
  }

  if (row.status === "failed" || row.status === "failed_recoverable") {
    return (
      <Message title="We couldn’t finish that one">
        {row.failure_reason === "server restarted while analyzing — please retry"
          ? "The server restarted mid-analysis. Please record and submit again."
          : "The analysis didn’t complete. Please try recording again."}
        <div className="pt-3">
          <Link to={`/scores/${row.score_id}/record`}>
            <Button variant="ghost">Record again</Button>
          </Link>
        </div>
      </Message>
    );
  }

  const result = row.result_json;
  if (!result) {
    return <Message title="No results">This analysis has no data.</Message>;
  }

  // Graceful pipeline outcomes: the verdict text is a re-record prompt.
  if (result.status !== "ok") {
    return (
      <div className="flex flex-col gap-5">
        <VerdictCard result={result} />
        <Link to={`/scores/${row.score_id}/record`}>
          <Button>Record again</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <VerdictCard result={result} />

      <Card bezel>
        <AnnotatedScore measures={result.per_measure} />
      </Card>

      {result.trend.length >= 2 && (
        <Card>
          <TrendChart trend={result.trend} />
        </Card>
      )}

      <PerNoteDetail notes={result.per_note} />

      <div className="flex flex-wrap gap-3">
        <Link to={`/scores/${row.score_id}/record`}>
          <Button>Practice again</Button>
        </Link>
        <Link to="/scores">
          <Button variant="ghost">Done</Button>
        </Link>
      </div>
    </div>
  );
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-2">
      <h1 className="font-serif text-xl text-ink">{title}</h1>
      <div className="text-sm text-ink-soft">{children}</div>
    </Card>
  );
}

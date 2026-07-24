import { useEffect, useRef } from "react";

import { useRecorder } from "../../hooks/useRecorder";
import { useCalibration } from "../../hooks/useRecordingApi";
import { Button } from "../ui/Button";
import { Eyebrow } from "../ui/Eyebrow";

/** 2-second calibration clip → POST /v1/calibration → present the outcome.
 *  The backend returns every edge-case code/message; we just show it. */
export function CalibrationFlow({
  onPick,
  onCancel,
}: {
  onPick: (bpm: number) => void;
  onCancel: () => void;
}) {
  const rec = useRecorder();
  const cal = useCalibration();
  const fired = useRef(false);

  useEffect(() => {
    if (rec.blob && !fired.current) {
      fired.current = true;
      cal.mutate(rec.blob);
    }
  }, [rec.blob, cal]);

  function retry() {
    fired.current = false;
    cal.reset();
    rec.reset();
  }

  const result = cal.data;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line bg-paper-raised p-5 shadow-hair">
      <div className="flex flex-col gap-1">
        <Eyebrow>Set your tempo</Eyebrow>
        <p className="text-[15px] text-ink-soft">
          Play about two seconds at the tempo you want — three or four steady
          notes is plenty.
        </p>
      </div>

      {rec.error && <p className="text-sm text-verdict-bad">{rec.error}</p>}

      {rec.state === "idle" && !result && (
        <div className="flex gap-3">
          <Button onClick={rec.start}>Record</Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}

      {rec.state === "recording" && (
        <div className="flex items-center gap-3">
          <span className="size-2.5 animate-pulse rounded-full bg-verdict-bad" />
          <span className="text-sm text-ink">Listening… {rec.seconds}s</span>
          <Button variant="stop" onClick={rec.stop}>
            Stop
          </Button>
        </div>
      )}

      {cal.isPending && <p className="text-sm text-ink-soft">Reading the pulse…</p>}
      {cal.isError && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-verdict-bad">
            {cal.error instanceof Error ? cal.error.message : "Calibration failed."}
          </p>
          <Button variant="ghost" onClick={retry}>
            Try again
          </Button>
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-3">
          {result.message && <p className="text-[15px] text-ink">{result.message}</p>}
          {result.ok && result.bpm ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => onPick(result.bpm as number)}>
                Use ♩={result.bpm}
              </Button>
              {result.alternates?.map((alt) => (
                <Button key={alt} variant="ghost" onClick={() => onPick(alt)}>
                  ♩={alt}
                </Button>
              ))}
              <Button variant="ghost" onClick={retry}>
                Redo
              </Button>
            </div>
          ) : (
            <Button variant="ghost" onClick={retry}>
              Try again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

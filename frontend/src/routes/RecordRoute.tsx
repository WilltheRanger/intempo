import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { X, CaretDown, DotsThreeVertical } from "@phosphor-icons/react";

import { useScore, useAnalysisSubmit } from "../hooks/useRecordingApi";
import type { MetronomeMode } from "../components/record/MetronomeToggle";
import { ScorePanel } from "../components/record/ScorePanel";
import { RecordingPanel } from "../components/record/RecordingPanel";
import { CalibrationFlow } from "../components/record/CalibrationFlow";

export function RecordRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  const scoreQuery = useScore(id);
  const submit = useAnalysisSubmit();

  const [bpm, setBpm] = useState(100);
  const [bpmSource, setBpmSource] = useState<"manual" | "calibration_clip">("manual");
  const [metronome, setMetronome] = useState<MetronomeMode>("off");
  const [calibrating, setCalibrating] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Seed tempo from the score's bpm_hint once, during render.
  if (!seeded && scoreQuery.data) {
    setSeeded(true);
    const hint = scoreQuery.data.score_json.bpm_hint;
    if (hint) setBpm(hint);
  }

  const title = scoreQuery.data?.title ?? "Dvořák · Cello Concerto";
  const movement = scoreQuery.data?.score_json.tempo_marking ?? "I. Allegro";
  const meter = scoreQuery.data?.score_json.time_signature ?? "4/4";

  function handleSubmit(blob: Blob) {
    if (!id) return;
    submit.mutate(
      { blob, scoreId: id, targetBpm: bpm, bpmSource, metronomeMode: metronome },
      { onSuccess: (data) => navigate(`/analyses/${data.analysis_id}`) },
    );
  }

  return (
    <div className="min-h-[100dvh] bg-paper">
    <div className="mx-auto flex max-w-[440px] flex-col gap-4 px-5 pb-8 pt-4">
      {/* top bar */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          aria-label="Close"
          className="grid size-9 place-items-center rounded-full text-ink transition-colors duration-200 ease-ios hover:bg-paper-warm active:scale-90"
        >
          <X size={20} />
        </button>
        <div className="flex flex-col items-center leading-tight">
          <span className="max-w-[220px] truncate text-[14px] font-medium text-ink">
            {title}
          </span>
          <span className="flex items-center gap-1 text-[12px] text-ink-mute">
            {movement} <CaretDown size={11} />
          </span>
        </div>
        <button
          aria-label="More"
          className="grid size-9 place-items-center rounded-full text-ink transition-colors duration-200 ease-ios hover:bg-paper-warm active:scale-90"
        >
          <DotsThreeVertical size={20} weight="bold" />
        </button>
      </div>

      <ScorePanel activeSystem={2} />

      {calibrating ? (
        <CalibrationFlow
          onPick={(picked) => {
            setBpm(picked);
            setBpmSource("calibration_clip");
            setCalibrating(false);
          }}
          onCancel={() => setCalibrating(false)}
        />
      ) : (
        <RecordingPanel
          bpm={bpm}
          meter={meter}
          onBpmChange={(v) => {
            setBpm(v);
            setBpmSource("manual");
          }}
          onCalibrate={() => setCalibrating(true)}
          metronomeMode={metronome}
          onToggleMetronome={() =>
            setMetronome((m) => (m === "off" ? "visual" : "off"))
          }
          submitting={submit.isPending}
          onSubmit={handleSubmit}
        />
      )}

      {submit.isError && (
        <p className="text-sm text-verdict-bad">
          {submit.error instanceof Error
            ? submit.error.message
            : "Couldn't submit the recording."}
        </p>
      )}
    </div>
    </div>
  );
}

import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useScore, useAnalysisSubmit } from "../hooks/useRecordingApi";
import { Card } from "../components/ui/Card";
import { Eyebrow } from "../components/ui/Eyebrow";
import { TempoSelector } from "../components/record/TempoSelector";
import { CalibrationFlow } from "../components/record/CalibrationFlow";
import { MetronomeToggle } from "../components/record/MetronomeToggle";
import type { MetronomeMode } from "../components/record/MetronomeToggle";
import { RecordingPanel } from "../components/record/RecordingPanel";

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

  // Seed the tempo from the score's bpm_hint once, during render (the
  // React-recommended alternative to a setState-in-effect).
  if (!seeded && scoreQuery.data) {
    setSeeded(true);
    const hint = scoreQuery.data.score_json.bpm_hint;
    if (hint) setBpm(hint);
  }

  function handleSubmit(blob: Blob) {
    if (!id) return;
    submit.mutate(
      { blob, scoreId: id, targetBpm: bpm, bpmSource, metronomeMode: metronome },
      { onSuccess: (data) => navigate(`/analyses/${data.analysis_id}`) },
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Eyebrow>Recording</Eyebrow>
        <h1 className="font-serif text-2xl text-ink">
          {scoreQuery.data?.title ?? "Play along"}
        </h1>
      </div>

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
        <Card className="flex flex-col gap-5">
          <TempoSelector
            bpm={bpm}
            onChange={(v) => {
              setBpm(v);
              setBpmSource("manual");
            }}
            onCalibrate={() => setCalibrating(true)}
          />
          <div className="border-t border-line pt-4">
            <MetronomeToggle value={metronome} onChange={setMetronome} />
          </div>
        </Card>
      )}

      <RecordingPanel
        bpm={bpm}
        metronomeMode={metronome}
        submitting={submit.isPending}
        onSubmit={handleSubmit}
      />

      {submit.isError && (
        <p className="text-sm text-verdict-bad">
          {submit.error instanceof Error
            ? submit.error.message
            : "Couldn't submit the recording."}
        </p>
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Camera, AlertTriangle } from "lucide-react";

import { supabaseConfigured } from "../lib/supabase";
import { isValidPitch, CONFIDENCE_THRESHOLD } from "../lib/score";
import type { ScoreJson, ScoreResponse } from "../lib/score";
import { useScoreUpload, useScoreSave } from "../hooks/useScoreUpload";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Eyebrow } from "../components/ui/Eyebrow";
import { ProgressBar } from "../components/ui/ProgressBar";
import { ImageUploader } from "../components/score/ImageUploader";
import { CameraCapture } from "../components/score/CameraCapture";
import { ScoreEditor } from "../components/score/ScoreEditor";
import { ScorePreview } from "../components/score/ScorePreview";
import { ScoreSaveBar } from "../components/score/ScoreSaveBar";

type Step = "capture" | "processing" | "edit" | "saved" | "error";

function hasInvalidPitch(score: ScoreJson): boolean {
  return score.measures.some((m) =>
    m.notes.some((n) => n.pitch !== "rest" && !isValidPitch(n.pitch)),
  );
}

export function ScoreCaptureRoute() {
  const upload = useScoreUpload();
  const save = useScoreSave();

  const [step, setStep] = useState<Step>("capture");
  const [useCamera, setUseCamera] = useState(false);
  const [score, setScore] = useState<ScoreResponse | null>(null);
  const [edited, setEdited] = useState<ScoreJson | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setUseCamera(false);
    setStep("processing");
    try {
      const res = await upload.mutateAsync({ file, title: "Untitled piece" });
      setScore(res);
      setEdited(res.score_json);
      setTitle(res.title);
      setStep("edit");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setStep("error");
    }
  }

  async function handleSave() {
    if (!score || !edited) return;
    setError(null);
    try {
      const res = await save.mutateAsync({
        id: score.id,
        scoreJson: edited,
        title: title.trim() || "Untitled piece",
      });
      setScore(res);
      setEdited(res.score_json);
      setStep("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save. Try again.");
    }
  }

  const canSave = useMemo(
    () => Boolean(edited) && title.trim().length > 0 && !hasInvalidPitch(edited!),
    [edited, title],
  );

  const lowConfidence =
    edited != null && edited.ocr_confidence < CONFIDENCE_THRESHOLD;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Eyebrow>New recording</Eyebrow>
        <h1 className="font-serif text-2xl text-ink">Capture a score</h1>
      </div>

      {step === "capture" && (
        <div className="flex flex-col gap-4">
          {!supabaseConfigured && (
            <p className="rounded-md border border-line bg-paper-warm px-3 py-2 text-xs text-ink-mute">
              Storage isn’t configured in this environment — set the Supabase
              keys to upload and parse a real score.
            </p>
          )}
          {useCamera ? (
            <CameraCapture
              onCapture={handleFile}
              onClose={() => setUseCamera(false)}
            />
          ) : (
            <>
              <ImageUploader onSelect={handleFile} />
              <button
                onClick={() => setUseCamera(true)}
                className="mx-auto flex items-center gap-2 text-sm text-amber-deep transition-colors duration-200 ease-ios hover:text-ink"
              >
                <Camera size={16} strokeWidth={1.5} /> Use the camera instead
              </button>
            </>
          )}
        </div>
      )}

      {step === "processing" && (
        <Card className="flex flex-col gap-4">
          <Eyebrow>Reading your score</Eyebrow>
          <p className="text-[15px] text-ink-soft">
            Making sense of the notes — this takes a few seconds.
          </p>
          <ProgressBar label="Recognising notes and measures…" />
        </Card>
      )}

      {step === "error" && (
        <Card className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-verdict-bad">
            <AlertTriangle size={18} strokeWidth={1.5} />
            <span className="font-medium">We couldn’t read that one</span>
          </div>
          <p className="text-sm text-ink-soft">{error}</p>
          <div>
            <Button variant="ghost" onClick={() => setStep("capture")}>
              Try another photo
            </Button>
          </div>
        </Card>
      )}

      {step === "edit" && edited && (
        <div className="flex flex-col gap-4">
          {lowConfidence && (
            <div className="flex gap-3 rounded-md border border-[rgba(180,122,44,0.35)] bg-[rgba(180,122,44,0.10)] px-3 py-2.5">
              <AlertTriangle
                size={16}
                strokeWidth={1.5}
                className="mt-0.5 shrink-0 text-verdict-mid"
              />
              <p className="text-sm text-ink">
                Some measures looked uncertain — please review before saving.
                {edited.notes_to_human ? ` ${edited.notes_to_human}` : ""}
              </p>
            </div>
          )}
          <ScoreEditor score={edited} onChange={setEdited} />
          {error && <p className="text-sm text-verdict-bad">{error}</p>}
          <ScoreSaveBar
            title={title}
            onTitleChange={setTitle}
            canSave={canSave}
            saving={save.isPending}
            onSave={handleSave}
          />
        </div>
      )}

      {step === "saved" && score && edited && (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <Eyebrow>Saved</Eyebrow>
            <h2 className="font-serif text-xl text-ink">{score.title}</h2>
            <ScorePreview score={edited} />
          </Card>
          <div className="flex flex-wrap gap-3">
            <Link to={`/scores/${score.id}/record`}>
              <Button>Play it</Button>
            </Link>
            <Link to="/scores">
              <Button variant="ghost">Back to scores</Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

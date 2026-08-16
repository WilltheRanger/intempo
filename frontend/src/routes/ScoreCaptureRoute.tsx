import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { Camera, Warning, X, CheckCircle } from "@phosphor-icons/react";

import { supabaseConfigured } from "../lib/supabase";
import { isValidPitch, CONFIDENCE_THRESHOLD } from "../lib/score";
import type { ScoreJson, ScoreResponse } from "../lib/score";
import { useScoreUpload, useScoreSave } from "../hooks/useScoreUpload";
import { Button } from "../components/ui/Button";
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

const STEP_TITLE: Record<Step, string> = {
  capture: "New piece",
  processing: "Reading",
  edit: "Check the notes",
  saved: "Saved",
  error: "New piece",
};

export function ScoreCaptureRoute() {
  const navigate = useNavigate();
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
    <div className="min-h-[100dvh] bg-paper">
      <div className="mx-auto flex min-h-[100dvh] max-w-[440px] flex-col px-5 pb-8 pt-4">
        {/* top bar */}
        <div className="mb-5 flex items-center justify-between">
          <button
            onClick={() => navigate("/")}
            aria-label="Close"
            className="grid size-9 place-items-center rounded-full text-ink transition-colors duration-200 ease-ios hover:bg-paper-warm active:scale-90"
          >
            <X size={20} />
          </button>
          <span className="text-[14px] font-medium text-ink">{STEP_TITLE[step]}</span>
          <span className="size-9" aria-hidden />
        </div>

        {step === "capture" && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-amber-deep">
                Photograph sheet music
              </p>
              <h1 className="font-serif text-[28px] leading-tight text-ink">
                Point at the page. We&rsquo;ll read the notes.
              </h1>
            </div>

            {!supabaseConfigured && (
              <p className="rounded-lg border border-line bg-paper-warm px-3.5 py-2.5 text-[13px] text-ink-mute">
                Storage isn&rsquo;t configured here. Add the Supabase keys to
                upload a real score.
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
                  className="mx-auto flex items-center gap-2 text-[14px] text-amber-deep transition-colors duration-200 ease-ios hover:text-ink"
                >
                  <Camera size={17} /> Use the camera instead
                </button>
              </>
            )}
          </div>
        )}

        {step === "processing" && <Processing />}

        {step === "error" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 pb-16 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-[rgba(123,46,47,0.1)] text-verdict-bad">
              <Warning size={22} />
            </span>
            <h2 className="font-serif text-xl text-ink">We couldn&rsquo;t read that one</h2>
            <p className="max-w-[300px] text-[14px] text-ink-soft">{error}</p>
            <button
              onClick={() => setStep("capture")}
              className="mt-2 rounded-full border border-line-2 px-5 py-2.5 text-sm text-ink transition-colors duration-200 ease-ios hover:bg-paper-warm active:scale-[0.98]"
            >
              Try another photo
            </button>
          </div>
        )}

        {step === "edit" && edited && (
          <div className="flex flex-col gap-4">
            {lowConfidence && (
              <div className="flex gap-3 rounded-lg border border-[rgba(180,122,44,0.35)] bg-amber-soft px-3.5 py-3">
                <Warning size={18} className="mt-0.5 shrink-0 text-amber-deep" weight="fill" />
                <p className="text-[13px] text-ink">
                  Some measures looked uncertain. Please review before saving.
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
          <div className="flex flex-col gap-5">
            <div className="flex flex-col items-center gap-2 pt-4 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-[rgba(47,110,78,0.12)] text-verdict-on">
                <CheckCircle size={24} weight="fill" />
              </span>
              <h2 className="font-serif text-[24px] text-ink">{score.title}</h2>
              <p className="text-[13px] text-ink-soft">Saved to your library.</p>
            </div>
            <div className="rounded-lg border border-line bg-paper-raised p-4 shadow-hair">
              <ScorePreview score={edited} />
            </div>
            <div className="flex flex-col gap-2.5">
              <Link to={`/scores/${score.id}/record`} className="block">
                <Button fullWidth>Play it</Button>
              </Link>
              <Link to="/scores" className="block">
                <Button variant="ghost" fullWidth>
                  Back to scores
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Manuscript "reading your score" state — matches the analysis pulse. */
function Processing() {
  const reduce = useReducedMotion();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 pb-16 text-center">
      <motion.span
        className="size-3 rounded-full bg-amber"
        animate={reduce ? undefined : { scale: [1, 0.7, 1], opacity: [1, 0.5, 1] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="flex flex-col gap-1">
        <p className="font-serif text-2xl italic text-ink">Reading your score…</p>
        <p className="text-[13px] text-ink-soft">
          Recognising notes and measures. This usually takes about 10 seconds.
        </p>
      </div>
    </div>
  );
}

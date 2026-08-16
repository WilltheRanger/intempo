import { useQuery, useMutation } from "@tanstack/react-query";

import { authedFetch } from "../lib/api";
import { uploadAudioClip } from "../lib/upload";
import type { ScoreResponse } from "../lib/score";
import type { AnalysisRow } from "../lib/analysis";
import { TERMINAL_STATUSES } from "../lib/analysis";

type CalibrationResult = {
  ok: boolean;
  bpm?: number | null;
  alternates?: number[] | null;
  warning?: string | null;
  code?: string | null;
  message?: string | null;
};

export function useScore(id?: string) {
  return useQuery({
    queryKey: ["score", id],
    queryFn: () => authedFetch<ScoreResponse>(`/v1/scores/${id}`),
    enabled: Boolean(id),
  });
}

/** Poll an analysis until it reaches a terminal status; pauses on tab blur. */
export function useAnalysisPolling(id?: string) {
  return useQuery({
    queryKey: ["analysis", id],
    queryFn: () => authedFetch<AnalysisRow>(`/v1/analyses/${id}`),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && TERMINAL_STATUSES.includes(status) ? false : 2000;
    },
    refetchIntervalInBackground: false, // stop polling when the tab is hidden
  });
}

export function useCalibration() {
  return useMutation({
    mutationFn: async (blob: Blob): Promise<CalibrationResult> => {
      const audioUrl = await uploadAudioClip(blob);
      return authedFetch<CalibrationResult>("/v1/calibration", {
        method: "POST",
        body: JSON.stringify({ audio_url: audioUrl }),
      });
    },
  });
}

export function useAnalysisSubmit() {
  return useMutation({
    mutationFn: async (args: {
      blob: Blob;
      scoreId: string;
      targetBpm: number;
      bpmSource: "manual" | "calibration_clip";
      metronomeMode: "off" | "visual";
    }): Promise<{ analysis_id: string; status: string }> => {
      const audioUrl = await uploadAudioClip(args.blob);
      return authedFetch("/v1/analyses", {
        method: "POST",
        body: JSON.stringify({
          score_id: args.scoreId,
          audio_url: audioUrl,
          target_bpm: args.targetBpm,
          bpm_source: args.bpmSource,
          metronome_mode: args.metronomeMode,
        }),
      });
    },
  });
}

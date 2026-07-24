import { useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "recording" | "stopped";

export const MAX_SECONDS = 300; // 5-minute hard cap (spec §7)
export const WARN_SECONDS = 270; // warn at 4:30

/** MediaRecorder wrapper: start/stop, elapsed seconds, resulting blob, and a
 *  live AnalyserNode for the waveform. */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startRef = useRef(0);

  function cleanup() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void contextRef.current?.close();
    contextRef.current = null;
    analyserRef.current = null;
  }

  async function start() {
    setError(null);
    setBlob(null);
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      contextRef.current = ctx;
      analyserRef.current = analyser;

      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        setBlob(
          new Blob(chunksRef.current, {
            type: recorder.mimeType || "audio/webm",
          }),
        );
      };
      recorder.start();
      recorderRef.current = recorder;

      startRef.current = Date.now();
      setSeconds(0);
      setState("recording");
      timerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startRef.current) / 1000);
        setSeconds(elapsed);
        if (elapsed >= MAX_SECONDS) stop();
      }, 250);
    } catch {
      setError("Couldn't access the microphone — check the permission.");
      setState("idle");
    }
  }

  function stop() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setState("stopped");
  }

  function reset() {
    setBlob(null);
    setSeconds(0);
    setState("idle");
  }

  useEffect(() => () => cleanup(), []);

  return { state, seconds, blob, error, analyser: analyserRef, start, stop, reset };
}

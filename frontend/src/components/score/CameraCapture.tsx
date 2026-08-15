import { useEffect, useRef, useState } from "react";
import { Camera, X } from "@phosphor-icons/react";

/**
 * Light live-camera capture. Mounted only after a user tap (iOS requires a
 * gesture for getUserMedia), so starting the stream in an effect is safe.
 * Falls back with a message if the camera is unavailable or denied — the
 * ImageUploader is always there as the reliable path.
 */
export function CameraCapture({
  onCapture,
  onClose,
}: {
  onCapture: (file: File) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => {
        if (!cancelled)
          setError("Couldn't open the camera. Use “choose a photo” instead.");
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function capture() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(new File([blob], "capture.jpg", { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.92,
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-lg border border-line bg-ink">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="aspect-[3/4] w-full object-cover"
        />
        <button
          onClick={onClose}
          aria-label="Close camera"
          className="absolute right-3 top-3 grid size-9 place-items-center rounded-full bg-black/40 text-white backdrop-blur-sm active:scale-90"
        >
          <X size={18} />
        </button>
        {/* 4-corner framing guide */}
        <div className="pointer-events-none absolute inset-6 rounded-md border-2 border-white/40" />
      </div>
      {error ? (
        <p className="text-sm text-verdict-bad">{error}</p>
      ) : (
        <button
          onClick={capture}
          aria-label="Capture photo"
          className="mx-auto grid size-16 place-items-center rounded-full border-4 border-ink/80 bg-paper-raised active:scale-95"
        >
          <span className="grid size-11 place-items-center rounded-full bg-amber text-white">
            <Camera size={20} />
          </span>
        </button>
      )}
    </div>
  );
}

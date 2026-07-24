import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/** Live waveform drawn from a recording AnalyserNode. */
export function WaveformPreview({
  analyser,
  active,
}: {
  analyser: RefObject<AnalyserNode | null>;
  active: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const node = analyser.current;
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      if (!node) return;
      const buf = new Uint8Array(node.fftSize);
      node.getByteTimeDomainData(buf);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#C78A3A";
      ctx.beginPath();
      const step = width / buf.length;
      for (let i = 0; i < buf.length; i++) {
        const y = (buf[i] / 255) * height;
        const x = i * step;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [analyser, active]);

  return (
    <canvas
      ref={canvasRef}
      width={520}
      height={72}
      className="h-16 w-full rounded-md bg-spruce"
    />
  );
}

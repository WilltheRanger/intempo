/**
 * A recording's shape as a row of bars — the Upload screen's waveform
 * (`redesign/UploadRecording.dc.html`).
 *
 * The peak of each slice, not its average: a note's attack is what a musician
 * recognises in a waveform, and averaging flattens exactly that. Scaled so the
 * loudest bar is full height, because the row is for recognising the take,
 * not for reading its level — and a quiet phone recording drawn to its true
 * scale would be a flat line.
 */
export function peaksOf(samples: ArrayLike<number>, bars: number): number[] {
  if (bars <= 0 || samples.length === 0) {
    return [];
  }
  const slice = samples.length / bars;
  const peaks: number[] = [];
  for (let bar = 0; bar < bars; bar += 1) {
    const from = Math.floor(bar * slice);
    const to = Math.max(from + 1, Math.floor((bar + 1) * slice));
    let peak = 0;
    for (let i = from; i < to && i < samples.length; i += 1) {
      const value = Math.abs(samples[i]);
      if (value > peak) peak = value;
    }
    peaks.push(peak);
  }
  const loudest = Math.max(...peaks);
  return loudest > 0 ? peaks.map((peak) => peak / loudest) : peaks;
}

/** `8.1 MB`, `640 KB` — the size under the file name. */
export function sizeLabel(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) {
    return null;
  }
  if (bytes >= 1_048_576) {
    return `${(bytes / 1_048_576).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

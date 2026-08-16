/**
 * Mock output of transcription, for the review screen.
 *
 * Nothing reads a score to produce this — there is no OMR, no MusicXML, no
 * measure detection. It exists so the review screen can be judged as an
 * experience. The real pipeline replaces this module and the screen above it
 * is unchanged.
 */
export interface TranscriptionDraft {
  title: string;
  composer: string;
  movement: string | null;
  /** Measure count for each captured page, in order. */
  measuresPerPage: number[];
}

/** Plausible measure counts, cycled so pages differ from one another. */
const MEASURE_PATTERN = [12, 16, 12, 8];

export function buildDraft(pageCount: number): TranscriptionDraft {
  return {
    title: '60 Studies for the Violin, Op. 45',
    composer: 'Franz Wohlfahrt',
    movement: 'No. 28 — Allegretto',
    measuresPerPage: Array.from(
      { length: pageCount },
      (_, index) => MEASURE_PATTERN[index % MEASURE_PATTERN.length],
    ),
  };
}

import type { Clef, ScoreJson } from '../../data/types';
import { staveScoreFor, type StaveScore } from './fromScore';
import { keySignatureFor, timeSignatureDigits } from './keySignature';
import { layOutStave, type StaveLayout, type StaveLayoutRequest } from './staveLayout';

/** Where noteheads go while nothing has said which clef the part is in. */
const UNREAD_CLEF_PLACEMENT = 'treble' as const;

/**
 * How many sizes of one score are kept. A tile is one, the piece screen's
 * opening another; the rest are the widths a window passed through while it
 * was dragged to a new size, and keeping those would keep an engraving of the
 * whole piece for every one of them.
 */
const SIZES_KEPT = 3;

/** What `ScoreBand` draws from, apart from the width: read once per score. */
export interface Band {
  clef: Clef;
  stave: StaveScore;
  head: NonNullable<StaveLayoutRequest['head']>;
}

interface Kept {
  band: Band;
  /** Engravings by `sizeKey`, oldest first. */
  sizes: Map<string, StaveLayout>;
}

/**
 * Engravings kept for as long as the notation they were drawn from.
 *
 * **Keyed by the notation object itself.** React Query hands back the same
 * object for notation that did not change, through a refetch as well as a
 * re-render, so a tile that mounts again — the search cleared, the shelf
 * regrouped when a take moved a piece into "This week" — finds its engraving
 * here instead of laying out the whole piece again. A weak map, so a library
 * that is gone takes its engravings with it.
 *
 * The component's own `useMemo` kept one for exactly as long as the component
 * lived, and the shelf unmounts every tile whenever a search starts.
 */
const kept = new WeakMap<ScoreJson, Kept>();

function sizeKey(width: number, scale: number): string {
  return `${width}@${scale}`;
}

function keptFor(score: ScoreJson): Kept {
  let entry = kept.get(score);
  if (entry === undefined) {
    const clef = score.clef ?? UNREAD_CLEF_PLACEMENT;
    entry = {
      band: {
        clef,
        stave: staveScoreFor(score),
        head: {
          clef: score.clef ?? null,
          key: keySignatureFor(score.key_signature, clef),
          time: timeSignatureDigits(score.time_signature),
        },
      },
      sizes: new Map(),
    };
    kept.set(score, entry);
  }
  return entry;
}

/** The parts of a band that do not depend on its width. */
export function bandOf(score: ScoreJson): Band {
  return keptFor(score).band;
}

/** This score's engraving at this size, if it has been engraved already. */
export function keptEngraving(
  score: ScoreJson,
  width: number,
  scale: number,
): StaveLayout | null {
  return kept.get(score)?.sizes.get(sizeKey(width, scale)) ?? null;
}

/**
 * Engrave a score as a band: wrapped and justified to `width`, shrunk once if
 * a bar is wider than that, with its clef, key and metre at the head and no
 * row of note names. The same request `ScoreBand` has always made — moved here
 * so that it can be kept.
 */
export function engraveBand(score: ScoreJson, width: number, scale: number): StaveLayout {
  const entry = keptFor(score);
  const key = sizeKey(width, scale);
  const known = entry.sizes.get(key);
  if (known !== undefined) {
    return known;
  }

  const { clef, stave, head } = entry.band;
  const layout = layOutStave({
    notes: stave.items,
    clef,
    maxWidth: width,
    fitWidth: width,
    scale,
    justify: true,
    beatQuarters: stave.beatQuarters,
    closesWithRepeat: stave.closesWithRepeat,
    endings: stave.endings,
    tempoMarks: stave.tempoMarks,
    head,
    nameRow: false,
  });

  entry.sizes.set(key, layout);
  if (entry.sizes.size > SIZES_KEPT) {
    const oldest = entry.sizes.keys().next().value;
    if (oldest !== undefined) {
      entry.sizes.delete(oldest);
    }
  }
  return layout;
}

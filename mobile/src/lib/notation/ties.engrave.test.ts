import { describe, expect, it } from 'vitest';

import { engrave, type StaveItem, type StaveNote } from './engrave';
import { staveScoreFor } from './fromScore';
import type { ScoreJson } from '../../data/types';

/**
 * Tie curves, which the app has folded in playback and never drawn.
 *
 * `scheduleScore` absorbs a tie into one long note; the page drew **two
 * separate noteheads with nothing joining them**. A musician reads that as two
 * attacks, `alignment.py` expects one, and the app plays one — three readings
 * of the same bar, two of them agreeing with each other and neither agreeing
 * with the page.
 *
 * The reading is shared rather than reimplemented: `fromScore` calls the same
 * `readTies` that `scheduleScore` does, so a curve is drawn exactly where a
 * note is held.
 */

function scoreOf(
  notes: { pitch: string; tied?: boolean; duration?: string }[][],
): ScoreJson {
  return {
    time_signature: '4/4',
    key_signature: 'C major',
    tempo_marking: null,
    bpm_hint: null,
    clef: 'treble',
    repeats: [],
    ocr_confidence: 1,
    notes_to_human: '',
    measures: notes.map((bar, i) => ({
      measure_number: i + 1,
      slurs: [],
      notes: bar.map((n) => ({
        pitch: n.pitch,
        duration: n.duration ?? 'quarter',
        tied_to_next: n.tied ?? false,
      })),
    })),
  } as unknown as ScoreJson;
}

const flags = (items: StaveItem[]) =>
  items.map((item) => [
    (item as StaveNote).tiedFromPrevious ?? false,
    (item as StaveNote).tiesToNext ?? false,
  ]);

describe('reading ties onto the stave', () => {
  it('marks the note that continues a tie, and the one it comes from', () => {
    const stave = staveScoreFor(
      scoreOf([[{ pitch: 'C4', tied: true }, { pitch: 'C4' }, { pitch: 'D4' }]]),
    );
    expect(flags(stave.items)).toEqual([
      [false, true],
      [true, false],
      [false, false],
    ]);
  });

  it('does not tie two different pitches, which is a slur', () => {
    // The reading `readTies` exists for. A curve between two pitches is a slur;
    // merging it would make one long note out of two, and drawing a tie would
    // claim the page said so.
    const stave = staveScoreFor(
      scoreOf([[{ pitch: 'C4', tied: true }, { pitch: 'D4' }]]),
    );
    expect(flags(stave.items).flat().some(Boolean)).toBe(false);
  });

  it('ties across a barline, which is the commonest kind', () => {
    const stave = staveScoreFor(
      scoreOf([[{ pitch: 'C4', tied: true }], [{ pitch: 'C4' }]]),
    );
    expect(flags(stave.items)).toEqual([
      [false, true],
      [true, false],
    ]);
  });

  it('does not tie back to a note that was never drawn', () => {
    // `H4` is German for B natural and not a pitch this engraver can place, so
    // it makes no item. A curve back to nothing is worse than no curve.
    const stave = staveScoreFor(
      scoreOf([[{ pitch: 'H4', tied: true }, { pitch: 'H4' }, { pitch: 'C4' }]]),
    );
    expect(flags(stave.items).flat().some(Boolean)).toBe(false);
  });
});

describe('drawing a tie', () => {
  const note = (pitch: string, extra: Partial<StaveNote> = {}): StaveItem =>
    ({ pitch, value: 'quarter', ...extra }) as StaveItem;

  it('joins the two noteheads with one curve', () => {
    const drawn = engrave(
      [note('C4', { tiesToNext: true }), note('C4', { tiedFromPrevious: true })],
      'treble',
    );
    const system = drawn.systems[0];
    expect(system.ties).toHaveLength(1);
    const [tie] = system.ties;
    // Springing from outside each notehead, not from their centres.
    expect(tie.from.x).toBeGreaterThan(system.notes[0].x);
    expect(tie.to.x).toBeLessThan(system.notes[1].x);
  });

  it('curves away from the stem', () => {
    // A tie drawn through the stems is the same mistake as a slur drawn through
    // them, and this one is measured from the note the tie *starts* on.
    const low = engrave(
      [note('D4', { tiesToNext: true }), note('D4', { tiedFromPrevious: true })],
      'treble',
    ).systems[0];
    expect(low.notes[0].stemUp).toBe(true);
    expect(low.ties[0].control.y).toBeGreaterThan(low.ties[0].from.y);

    const high = engrave(
      [note('D5', { tiesToNext: true }), note('D5', { tiedFromPrevious: true })],
      'treble',
    ).systems[0];
    expect(high.notes[0].stemUp).toBe(false);
    expect(high.ties[0].control.y).toBeLessThan(high.ties[0].from.y);
  });

  it('draws a half at each end when a line break falls inside it', () => {
    // **Not an exotic case.** Ties across barlines are the commonest kind and
    // `packSystems` breaks on barlines, so this is the ordinary one. Without
    // the halves a tie at a break simply disappears.
    const bars = Array.from({ length: 10 }, (_, i) =>
      note('C4', { barBefore: i > 0 }),
    );
    const plain = engrave(bars, 'treble', { maxWidth: 150, lineGap: 5, noteGap: 16 });
    expect(plain.systems.length).toBeGreaterThan(1);
    const onFirst = plain.systems[0].notes.length;

    const tied = bars.map((item, i) => {
      if (i === onFirst - 1) return { ...item, tiesToNext: true };
      if (i === onFirst) return { ...item, tiedFromPrevious: true };
      return item;
    });
    const drawn = engrave(tied, 'treble', { maxWidth: 150, lineGap: 5, noteGap: 16 });

    expect(drawn.systems[0].ties).toHaveLength(1);
    expect(drawn.systems[1].ties).toHaveLength(1);
    // The trailing half runs to the right of its last note; the leading half
    // arrives from the left of its first.
    const out = drawn.systems[0];
    expect(out.ties[0].to.x).toBeGreaterThan(out.notes.at(-1)!.x);
    const back = drawn.systems[1];
    expect(back.ties[0].from.x).toBeLessThan(back.notes[0].x);
  });

  it('draws nothing when nothing is tied', () => {
    const drawn = engrave([note('C4'), note('D4')], 'treble');
    expect(drawn.systems[0].ties).toHaveLength(0);
  });
});

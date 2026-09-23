import { describe, expect, it } from 'vitest';

/**
 * The bar the musician enters on reaches the analysis.
 *
 * **The picker existed on the Record screen and governed nothing but
 * playback.** Its own comment said so: a bare "From bar 1" there "reads as
 * where the take starts — which it is not, and which would be a promise about
 * the analysis that nothing keeps". Someone working on bar 40 of a concerto
 * had to play the preceding thirty-nine to be told anything about it.
 *
 * Two halves, and either one alone is worse than neither. Sending the bar
 * without relabelling means a control that silently changes where a recording
 * begins. Relabelling without sending it means the screen promises the
 * analysis knows, and the take is judged against bar 1 onward — misaligned at
 * every onset, and `alignment.py` accumulates durations, so the error moves
 * every bar after it.
 *
 * Source text, for the same reason as `loadErrors.test.ts`: there is no React
 * Native testing library here (`DECISIONS.md`, 2026-08-24), so a rule that
 * lives in a `.tsx` is a rule nothing checks.
 */
const record = Object.entries(
  import.meta.glob('./record/RecordScreen.tsx', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>,
);

describe('the entry bar on the record screen', () => {
  it('finds the screen it is about', () => {
    expect(record).toHaveLength(1);
  });

  it('sends the chosen bar with the take', () => {
    const [, source] = record[0];

    // `entryBar` is the start bar, unless the Upload screen chose one for a
    // picked file — see `send`.
    expect(source).toContain('const entryBar = recording.fromMeasure ?? startFrom;');
    expect(source).toContain('fromMeasure: entryBar');
  });

  it('tells the picker it governs the take, so the label says so', () => {
    const [, source] = record[0];

    // `entryCopy.test.ts` holds the words; this holds the fact that this
    // screen asks for them. It asked through `PlaybackSettings entry="take"`
    // until the redesign (2026-09-23) moved the row onto the Record panel.
    expect(source).toContain("entryRowLabel('take')");
    expect(source).toContain("entryAccessibilityLabel('take', startFrom)");
  });

  it('measures the rest cues from the bar the take starts at', () => {
    // `longRestCues` counts beats from the first bar played. Given the whole
    // score, every cue for a take that began partway in fires at the wrong
    // moment, and the count-in leads into the wrong music.
    const [, source] = record[0];

    expect(source).toContain('longRestCues(takeScore');
    expect(source).toContain('startFromMeasure(heard, startFrom)');
  });
});

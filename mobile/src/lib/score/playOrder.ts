import type {
  ScoreJson,
  ScoreMeasure,
  ScoreRepeat,
} from '../../data/types';

/**
 * Measures in the order a musician performs them.
 *
 * This is a TypeScript port of the backend's `expand_repeats`. Keeping this
 * order shared by reference playback and practice cues prevents the app from
 * demonstrating one timeline while the analyser grades another.
 *
 * Invalid repeat references are ignored. OCR can misread a repeat sign, and a
 * straight-through timeline is safer than losing the whole score.
 */
export function measuresInPlayOrder(score: ScoreJson): ScoreMeasure[] {
  const measures = score.measures ?? [];
  const repeats = score.repeats ?? [];
  if (repeats.length === 0) {
    return measures;
  }

  const byNumber = new Map(
    measures.map((measure) => [measure.measure_number, measure]),
  );
  const order = measures.map((measure) => measure.measure_number);
  const spans = repeats.filter((repeat) => repeat.type === 'repeat');
  const firstBrackets = repeats
    .filter((repeat) => repeat.type === 'first_ending')
    .map((repeat) => [repeat.start_measure, repeat.end_measure] as const);
  const secondBrackets = repeats
    .filter((repeat) => repeat.type === 'second_ending')
    .map((repeat) => [repeat.start_measure, repeat.end_measure] as const);

  function bracketed(
    brackets: ReadonlyArray<readonly [number, number]>,
    span: ScoreRepeat,
    body: number[],
  ): Set<number> {
    const removed = new Set<number>();
    for (const [start, end] of brackets) {
      // An ending belongs only to a section that starts before it. This stops
      // an outer ending from deleting a pass through an inner repeat.
      if (
        start <= span.start_measure ||
        !body.includes(start) ||
        !body.includes(end)
      ) {
        continue;
      }
      for (let number = start; number <= end; number += 1) {
        removed.add(number);
      }
    }
    return removed;
  }

  function play(numbers: number[], available: ScoreRepeat[]): number[] {
    const played: number[] = [];
    let position = 0;

    while (position < numbers.length) {
      const number = numbers[position];
      const here = available.filter(
        (span) =>
          span.start_measure === number &&
          numbers.indexOf(span.end_measure, position) >= position,
      );

      if (here.length === 0) {
        played.push(number);
        position += 1;
        continue;
      }

      // The widest span owns this position; its inner repeats are expanded
      // recursively before first/second endings filter either pass.
      const span = here.reduce((widest, candidate) =>
        numbers.indexOf(candidate.end_measure, position) >
        numbers.indexOf(widest.end_measure, position)
          ? candidate
          : widest,
      );
      const stop = numbers.indexOf(span.end_measure, position);
      const body = numbers.slice(position, stop + 1);
      const inside = available.filter(
        (other) =>
          other !== span &&
          (other.start_measure !== span.start_measure ||
            other.end_measure !== span.end_measure) &&
          body.includes(other.start_measure) &&
          body.includes(other.end_measure),
      );
      const written = play(body, inside);
      const firsts = bracketed(firstBrackets, span, body);
      const seconds = bracketed(secondBrackets, span, body);

      played.push(...written.filter((measure) => !seconds.has(measure)));
      played.push(...written.filter((measure) => !firsts.has(measure)));
      position = stop + 1;
    }

    return played;
  }

  return play(order, spans)
    .map((number) => byNumber.get(number))
    .filter((measure): measure is ScoreMeasure => measure !== undefined);
}

import type { TakeResult } from '../../data/types';

function eligible(take: TakeResult): boolean {
  return Boolean(take.comparisonKey?.startsWith('v1:')) && !take.failure
    && take.status === 'ok' && !take.lowConfidence
    && take.missedNotes === 0 && take.extraNotes === 0
    && take.measures.length > 0
    && take.measures.every((bar) => Number.isFinite(bar.deviationPct)
      && (bar.timedNoteCount ?? 0) > 0 && !bar.uneven && !bar.underTempoChange);
}

/** Mean absolute bar-average deviation, not note accuracy or a skill score. */
function deviation(take: TakeResult): number {
  const count = take.measures.reduce((n, bar) => n + bar.timedNoteCount!, 0);
  return take.measures.reduce((n, bar) => n + Math.abs(bar.deviationPct) * bar.timedNoteCount!, 0) / count;
}

export function compareLatest(takes: TakeResult[]) {
  const sorted = takes.filter((take) => Number.isFinite(Date.parse(take.recordedAt)))
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
  const latest = sorted[0];
  if (!latest || !eligible(latest)) return null;
  const shape = (take: TakeResult) => JSON.stringify(take.measures.map((bar) =>
    [bar.measure, bar.noteCount, bar.timedNoteCount]));
  const previous = sorted.slice(1).find((take) => take.id !== latest.id
    && Date.parse(take.recordedAt) < Date.parse(latest.recordedAt)
    && take.pieceId === latest.pieceId && take.targetBpm === latest.targetBpm
    && take.comparisonKey === latest.comparisonKey && eligible(take)
    && shape(take) === shape(latest));
  if (!previous) return null;
  return { latest, previous, latestDeviation: deviation(latest), previousDeviation: deviation(previous) };
}

import type { Instrument } from '../../data/types';
import type { Schedule } from './schedule';

/** Bass notation sounds an octave below written pitch. Timing stays written. */
export function instrumentPlayback(
  schedule: Schedule,
  instrument: Instrument,
): Schedule {
  if (instrument !== 'double_bass') return schedule;
  return {
    ...schedule,
    notes: schedule.notes.map((note) => ({
      ...note,
      frequency: note.frequency / 2,
    })),
  };
}

import type { Instrument } from './types';

/**
 * The instruments this app knows, and the guard that reads one off storage.
 *
 * **A list retyped is a list that drifts**, and this one was: `preferences.ts`
 * and `onboardingDraft.ts` each held their own copy of the four names and their
 * own byte-identical `isInstrument`. I introduced the second one myself, in the
 * commit that put onboarding ahead of sign-up — copied rather than imported,
 * which is the cheap move at the time and the expensive one later.
 *
 * The failure it sets up is quiet and asymmetric. Add a fifth instrument to one
 * list and not the other, and the app accepts it in the onboarding draft and
 * rejects it when the preferences store reads the same value back — falling
 * through to the default, silently, on the device of the musician who chose it.
 * Nothing throws and no test fails, because each store is right about its own
 * list.
 *
 * A module that imports nothing but a type, so both stores can depend on it and
 * neither depends on the other. `services/ocr/meter.py` is the same shape on
 * the backend, for the same reason.
 */
/**
 * **`Record<Instrument, true>` rather than `Instrument[]`, and that is the
 * whole guarantee.** An array typed `Instrument[]` is satisfied by a list
 * missing three of them, so a fifth instrument added to the union in
 * `types.ts` and forgotten here would compile — and the guard would reject a
 * value the type says is valid, on the device of whoever chose it. A mapped
 * object is exhaustive by construction: leave one out and `tsc` names it.
 *
 * This is `noUnusedLocals`'s argument again — the compiler already knows, it
 * just has to be asked.
 */
const ALL: Record<Instrument, true> = {
  violin: true,
  viola: true,
  cello: true,
  double_bass: true,
};

const INSTRUMENTS = Object.keys(ALL) as Instrument[];

/** Whether a value off storage is still an instrument this build offers. */
export function isInstrument(value: unknown): value is Instrument {
  return INSTRUMENTS.includes(value as Instrument);
}

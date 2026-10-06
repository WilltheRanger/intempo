/**
 * A pitch the way a page prints it: "F#4" → "F♯4", "Bbb2" → "B𝄫2".
 *
 * **One rule, where there were three.** The verdict's wrong notes, the Pitch
 * tab's note marks and the bar editor each had their own — and the bar
 * editor's note tabs used none, so the editor that shows a stepper reading
 * "F♯4" labelled the same note "F#4" directly above it (2026-10-05). Two of
 * the three also mishandled doubles: "F##4" came out "F♯#4", "Bbb4" "B♭b4".
 * Imported scores carry doubles, and `Text` draws 𝄪 and 𝄫 in the accidentals
 * font like the others.
 *
 * With or without an octave. Anything that is not a pitch — "rest", a German
 * "H" — comes back as it was rather than half-converted.
 */
const SIGNS: Record<string, string> = {
  '': '',
  '#': '♯',
  b: '♭',
  '##': '𝄪',
  x: '𝄪',
  bb: '𝄫',
};

export function printedPitch(pitch: string): string {
  const match = /^([A-G])(##|bb|#|b|x)?(-?\d+)?$/.exec(pitch);
  if (!match) return pitch;
  return match[1] + SIGNS[match[2] ?? ''] + (match[3] ?? '');
}

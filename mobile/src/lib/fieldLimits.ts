/**
 * The longest each typed field may be: the API's own `max_length`, so a field
 * stops accepting characters at the point the server would refuse them.
 *
 * **Without these, too long was a dead end with the wrong explanation.** The
 * server answers an 81-character name with a 422 whose `detail` is a list,
 * which `apiFetch` cannot put into words, so the musician read "Something went
 * wrong at our end … it is not you" — about their own input, on a save that
 * would fail the same way every time. In onboarding, where a name is required,
 * that was a screen with no way forward (found 2026-09-30). A paste is the
 * likely way in: a name or a title copied from somewhere with more on it.
 *
 * `fieldLimits.test.ts` reads each number out of the backend's models, so a
 * limit changed on one side fails there rather than in someone's hands.
 */
export const FIELD_LIMITS = {
  /** `users.display_name` — `app/models/user.py`. */
  displayName: 80,
  /** A piece's title — `app/routers/scores.py`. */
  pieceTitle: 200,
  /** A piece's composer — `app/routers/scores.py`. */
  composer: 200,
  /** A piece's movement — `app/routers/scores.py`. */
  movement: 200,
  /** "3/4", typed on the manual form — `app/routers/scores.py`. */
  timeSignature: 20,
  /** A tempo marking as printed — `TempoChange.text`, `app/services/score_schema.py`. */
  printedTempo: 40,
} as const;

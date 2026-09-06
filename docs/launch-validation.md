# Launch validation — 2026-09-05

This is a working release checklist, not a declaration that the app is ready.
Practice lessons remain removed. No new production deployment in this pass.

## Recording

- Implemented: resume after permission setup interrupts audio; cleanup after a
  closed graph; cancel a microphone whose permission resolves after screen exit.
- Implemented: show whether any audio has reached the recorder since the last
  count-in reset. This is not a loudness, clipping, or recording-quality verdict.
- Required on a real iPhone: allow permission; deny then restore permission;
  leave while permission is pending; record after Listen; stop; retry; background
  and return; test Safari and the installed home-screen version separately.
- Check the live version, not only localhost. Capture the exact error and browser
  version for any failure. Do not mark the reported phone failure resolved yet.

## Score import and review

- Existing: multi-page capture/upload, page preview, naming, reading status,
  editable notation and acceptance flow.
- Improved: synchronous save guard against duplicate taps, reject empty or
  incomplete page uploads, explain image quality and the next review step.
- Remaining acceptance: photograph a complete part on a phone, change page order,
  recover from an interrupted upload, correct a deliberately misread bar, and
  verify accepted notes are the notes used in Listen and timing analysis.

## Bass timing

- Automated coverage: synthetic low-register bowed onset regression tests.
- Do not tune thresholds from synthetic signals alone.
- Required inputs: short real bowed and plucked clips, matching notation, played
  tempo, instrument, and manually checked onset timestamps. Include low E/A,
  rests, repeated notes and a quiet take. Use held-out clips when tuning.
- Report missed/extra attacks and timing offsets, not just whether analysis ran.

## Insights and recorded playback

- Existing: per-measure feedback and private recording replay.
- Improved: up to 20 recent sessions, collapsed to five initially; blur stops
  replay, including playback still awaiting audio-session preparation.
- Implemented locally: automatic comparison within the latest 20 takes. New
  worker results fingerprint processed notation, piece, tempo, instrument,
  starting bar, rest handling, metronome and tuning configuration. The client
  also requires matching bar/note counts and excludes uncertain results,
  uneven bars and missed/extra notes. Old results remain incomparable.
  The metric is absolute bar-average deviation, not a general progress score.
  Backend and client both need deploying before real new takes can use it.

## Mobile polish

- Existing: compositor-driven web press feedback, reduced-motion support,
  native momentum scrolling, keyboard dismissal and safe-area-aware navigation.
- Improved: keyboard inset adjustment and bottom inset for pushed screens.
- Required: 320px width and large-text checks; real-device keyboard open/close;
  swipe-back; interrupted gestures; long score/list scrolling; reduced motion.
  Do not infer smoothness on an iPhone from desktop tests.

## Accounts, privacy and release

- Existing account/password-recovery flows need production-email smoke testing
  with a disposable test account. Account deletion must be tested only against
  that account, not the owner's data.
- Backend auth/account/health/readiness and private-audio tests were exercised.
- Owner choices still required: website-only versus App Store release; publisher
  entity, contact and jurisdiction; final icon/artwork; public privacy policy.
- App Store additionally needs EAS project, signing account and store listing.
- Run `tools/check-store-readiness.py` before submission. Its outstanding items
  must not be replaced with invented IDs, publisher details or policy URLs.

## Publication

Keep this pass in preview until reviewed. When authorized, merge the tested
changes, verify the production bundle changed, then repeat the phone microphone
test. A successful merge is not proof of a successful deployment or recording.

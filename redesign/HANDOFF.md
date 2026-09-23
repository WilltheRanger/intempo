# InTempo redesign handoff

These are the design files for the InTempo redesign. Each `.dc.html` file is one phone screen (390 × 844) built as an HTML prototype on a design canvas. Treat them as the visual source of truth for layout, spacing, copy and color, and rebuild each one as native React Native components. Do not port their JavaScript.

`Main.dc.html` is the Foundations board (type, color, components). Read it first. `canvas.json` shows how the screens are arranged and titled; screens in the same row belong to the same flow.

## Tokens

The palette is the one the app already ships, so map everything to the existing tokens in `mobile/src/design` and don't hardcode hex values. If a color below has no token, add one rather than inlining it.

| Role | Hex |
| --- | --- |
| Ivory background | #F7F2E9 |
| Card / raised surface | #FBFAF7 |
| Paper (score plates, scanner page) | #FBF9F4 |
| Ink (text, primary buttons) | #14110E |
| Dark surface (Today hero) | #1A1714 |
| Antique gold (accent, "rushing") | #9A7B4F |
| Gold, pressed or darker text | #7F6541 |
| Secondary text | #5C564D |
| Tertiary text | #756E63, #8C857B |
| Hairlines and dividers | #E6E2DA |
| Spent or disabled | #D8D2C6 |
| Steady (neutral chart bars) | #968D80 |
| Success / error | #1D7F46 / #C53B3B |

Type is Newsreader for headings and big numbers, Inter for everything else.

## What is real and what is a prototype trick

The following are real behavior and should be built:

- **Tempo screen:** tap tempo (average of the last 6 taps, resets after 2 seconds of no taps), a draggable bar from 40 to 160 BPM, and quick picks for half, three quarters and marked tempo.
- **Record ready:**
  - The score scrolls, with a white fade at the bottom.
  - Tapping a bar highlights it and sets the start bar.
  - The "Start at" sheet offers From the top, Where you stopped, Where you rushed last time, and Choose on the score.
  - The Listen player has a play button and scrubber.
- **Charts on Insights and Piece detail:** every plot point is one take, not one day, because students don't practice daily. Labels read "Take 1" to "Take N".
- **Insights:** only the recommended piece shows by default; "See all pieces" expands the rest.
- **Onboarding animations:** the scan on Welcome and the staff and playhead on Done. Honor Reduce Motion by showing the finished state.

The following only exist so the prototype could click through, so replace them:

- **sessionStorage hand-offs:**
  - `intempo:bpm` carries the chosen tempo from Tempo back to Record. Make this shared state or a navigation param.
  - `intempo:from-welcome` makes Today rise in once. Show that rise-in only on the first arrival after onboarding.
- **Links between screens:** `<a href="X.dc.html">` links become real navigation.
- **Light and dark Today:** `Today.dc.html` and `TodayLight.dc.html` are the dark and light versions of one screen. Pick between them with the system color scheme; the prototype's `todayHref()` switch goes away.
- **Sample data:** the piece names, take counts and bar numbers are sample data. Wire them to the real data where the app has it, and stub what the backend doesn't support yet.
- **Hidden scrollbars:** the prototypes hide their scrollbars. That is browser-only and needs nothing in native.

## Images

Two photos didn't export with the files, so the prototypes point to `/_blob/...` URLs that won't load. Put them in `design/redesign/assets/` as:

- `today-hero.png`: the rehearsal-room photo behind the Today hero.
- `signin-hero.jpg`: the turntable photo on Sign in (Kevin McCutcheon on Unsplash, keep the credit).

## Build order

Build one batch at a time and show each screen running before moving on.

1. **Record:** RecordReady, Tempo, RecordCountIn, UploadRecording, Verdict
2. **Home:** Today, TodayLight, Library, Profile
3. **Progress:** Insights, PieceDetail, PieceScore
4. **Adding a piece:** Scanner, ReviewPages, NamePiece, SetTempo, MeasureEdit
5. **Onboarding:** SignIn, OnboardWelcome, OnboardName, OnboardInstrument, OnboardRole, OnboardMic, OnboardSource, OnboardPhoto, OnboardDone

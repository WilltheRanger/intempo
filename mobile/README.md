# InTempo — the app

React Native (Expo SDK 57) for iOS, also built to the web for Cloudflare Pages.
This is the only application in the repository; the backend it talks to is in
`../backend`.

## Running it

```bash
cd mobile
npm install
npm start          # then press i for the iOS simulator, w for the browser
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
```

Before committing, run the checks from the repository root. GitHub Actions is
the clean runner check; this catches most failures before a push spends a run:

```bash
python3 tools/preflight.py          # the gates that need no build
python3 tools/preflight.py --full   # and the builds, the walk and the audits
```

Environment variables (all optional):

| Variable | Default | Purpose |
|---|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | unset | FastAPI backend |
| `EXPO_PUBLIC_SUPABASE_URL` | unset | Supabase project, for auth |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | unset | Supabase anon key |
| `EXPO_PUBLIC_FIXTURES` | unset | `empty` or `new` for a fixture account with no pieces (`new`: not yet onboarded) |
| `EXPO_PUBLIC_SENTRY_DSN` | unset | Native release builds only: where unhandled crashes are sent |

With any of the first three missing, the app boots in deterministic fixture
mode and says so at boot (`data/environment.ts`). With all three configured,
`data/sources/index.ts` selects the authenticated API source instead. Backend
secrets belong to the deployed API host and are never placed in this app.

## Layout

```
src/
├── App.tsx          boot, providers, error boundary
├── design/          tokens: the only place a colour, size, radius or spacing value lives
├── components/      primitives/ (Text, buttons, inputs, headers), overlays/ (sheets,
│                    dialogs), notation/ and score/ (engraved music, playback),
│                    charts/, pieces/, practice/, profile/, brand/, motion/, skeletons/
├── navigation/      RootNavigator, the floating BottomTabBar, deep links
├── screens/         one folder per screen: library/, pieceDetail/, scanner/,
│                    transcriptionReview/, record/, tempo/, verdict/, insights/,
│                    profile/, onboarding/, auth/, account/ …
├── data/            wire types, the API client, auth, the fixture/API source seam,
│                    React Query hooks and the persisted cache
└── lib/             platform and domain logic: audio recording, the metronome,
                     the offline take queue (sync/), score playback, verdict
                     presentation, formatting, accessibility
```

Tests sit beside the module they test (`foo.ts` + `foo.test.ts`).

## Three rules that keep this maintainable

**Values come from `design/`.** No component declares a colour, font size,
radius, or spacing of its own. Adding a screen should never add a token; if a
layout seems to need a value that isn't in the scale, that's a design question,
not an implementation one.

**Screens never touch the API.** They call hooks in `data/hooks`, which call a
source. `data/sources/index.ts` picks the implementation (fixtures or the live
backend) from the environment, so swapping it changes no component.

**Screen rules live in modules, not components.** There is no React Native
testing library here, so a rule inside a `.tsx` is a rule nothing checks. Put
it in a `.ts` module with tests and let the component call it. The design laws
every screen follows are in the repository's `CLAUDE.md` §3.

## Why fixtures remain

Fixtures keep screenshots, accessibility sweeps, failure states and local
development deterministic without contacting the deployed API or a paid
provider. The live source is implemented separately in `data/sources/api.ts`,
so fixture data cannot silently become a production fallback. Fixture artwork
is the repository's own public-domain set from `fixtures/scores/`; each
thumbnail is genuinely the piece it claims to be. See
`fixtures/scores/SOURCES.md` for provenance.

### An account with nothing in it

    npm run build:web:empty        # builds into dist-empty/
    npx serve dist-empty -l 4323 -s
    node ../tools/audit-a11y.mjs 4323 Library Insights Profile

`EXPO_PUBLIC_FIXTURES=empty` makes `data/sources/fixtures.ts` describe an
account with no pieces, no takes and no insights. It is the state **every
musician meets first** and the one every other build lacks: the Library and
Insights are otherwise only ever seen with a library, a take and thirty days of
trend behind them.

That gap has cost a real bug. On 2026-09-02 the home screen of the time was
found telling a new musician *"Nothing to practice yet"* directly above a fully
built daily warmup it was hiding from them, and it was found by hand-editing five functions and
remembering to revert them. The flag is those five edits with the remembering
taken out.

The audit takes route names after the port because most of the list points at
`fixture-…` ids that an empty account does not have; sweeping all of them would
measure a page of not-found states. The unvisited-route check still runs
against the whole list, so a filtered run cannot claim full coverage.

## Building for a device or the App Store

`app.json` carries `ios.bundleIdentifier` and `android.package`
(`com.intempo.app`) and `eas.json` carries the build profiles. Without those,
`expo prebuild` and EAS cannot run at all, so there was no route onto a phone.

**The bundle identifier is freely changeable right up until the first
submission and permanent after it.** Change it in `app.json` if
`com.intempo.app` is not the identity you want; nothing else in the repository
depends on the value.

Verified here: `expo prebuild --platform ios` completes, and the generated
`Info.plist` carries the bundle identifier, all three permission strings from
the config plugins, `ITSAppUsesNonExemptEncryption: false` (this app's only
cryptography is the platform's TLS, which is exempt — the declaration saves an
export-compliance question on every upload), and `RCTRootViewBackgroundColor`
at the app's own paper colour.

**The iOS bundle builds.** `ci.yml` and `tools/preflight.py --full` both carry
an iOS export gate. GitHub Actions is running again; a fork pull request may
still require a maintainer to approve its first workflow run. `expo export
--platform ios` resolves the *native*
module graph — a different graph from the
web one this repository's screenshots and walk all run through — and Hermes
compiles it. Measured on the resulting bytecode: `intempo-listen-`, the WAV
filename the **native** score player writes, is present; `AudioContext` and
`createMediaStreamDestination` from the Web Audio player are absent; and
`beforeunload` is gone entirely, because Metro folds `Platform.OS` and strips
the guarded web branch.

That proves the bundle **builds**, not that it **behaves**. The native recorder
and the native player have still never made a sound.

**Not verified, and it cannot be here:** no build has ever been produced. There
is no macOS, no Xcode, no Apple account and no EAS credentials in this
container.

**What still needs a person is a command, not a paragraph:**

```bash
python3 tools/check-store-readiness.py
```

This sentence used to be a numbered list of three, and it was wrong — it named
the EAS and Apple items and omitted the brand assets, the publisher's own
details in the privacy policy, and a hosted policy URL, all of which block a
submission just as hard. A count in prose is a claim that goes stale the first
time the world moves. The command reads `app.json`, `src/lib/legal.ts` and the
brand-asset hashes live, so it cannot say anything that is not true today, and
an item stops being listed the moment it is done with nobody editing anything.

Two of them can only be stated, never measured from a checkout, and the command
says so: an Apple Developer account with signing credentials
(`eas credentials`), and an App Store Connect listing — name, screenshots,
description, privacy answers, age rating.

There is no `development` profile, deliberately: one requires the
`expo-dev-client` package, which is not a dependency, so the profile would be
config that fails on first use. Add both together or neither.

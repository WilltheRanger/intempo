# InTempo — mobile

React Native (Expo SDK 57) app for iOS. Phases 2 and 3 of the frontend
rebuild: the design system, the shared primitives, the data seam, and the
Today screen.

## Running it

```bash
cd mobile
npm install
npm start          # then press i for the iOS simulator
npm run typecheck  # tsc --noEmit
```

Before committing, run the checks from the repository root. GitHub Actions is
the clean runner check; this catches most failures before a push spends a run:

```bash
python3 tools/preflight.py          # the gates that need no build
python3 tools/preflight.py --full   # and the builds, the walk and the audits
```

Optional environment variables (all have working defaults):

| Variable | Default | Purpose |
|---|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | `http://127.0.0.1:8000` | FastAPI backend |
| `EXPO_PUBLIC_SUPABASE_URL` | — | Supabase project, for auth |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | — | Supabase anon key |

The app boots without the Supabase variables in deterministic fixture mode.
With all three public runtime values configured, `data/sources/index.ts`
selects the authenticated API source instead. Backend secrets belong to the
deployed API host and are never placed in this app.

## Layout

```
src/
├── design/       tokens — the only place a hex, size, or spacing value lives
├── components/
│   ├── primitives/   Text ScreenContainer PageHeader SectionHeader Card
│   │                 PrimaryButton SecondaryButton ProgressBar MetadataRow
│   │                 EmptyState LoadingState
│   └── pieces/       ScoreThumbnail FeaturedPieceCard PieceCard
├── navigation/   RootNavigator · BottomTabBar
├── screens/      today/ library/ insights/ profile/ practice/
├── data/         wire types, API calls, auth, sources, hooks
└── lib/          formatting, greeting, reduced-motion
```

## Two rules that keep this maintainable

**Values come from `design/`.** No component declares a colour, font size,
radius, or spacing of its own. Adding a screen should never add a token; if a
layout seems to need a value that isn't in the scale, that's a design question,
not an implementation one.

**Screens never touch the API.** They call hooks in `data/hooks`, which call a
`PieceSource`. `data/sources/index.ts` picks the implementation — fixtures
today, the live backend later. Swapping it changes one line and no component.

## Today is the canonical reference

The Today screen is approved and frozen. Library, Piece Detail, Practice,
Insights, and Profile derive from it — they do not get their own visual
decisions. Nothing about Today changes without the owner asking for it.

What that means in practice when building a new screen:

- **Compose, don't invent.** Everything on Today is built from
  `components/primitives` and `components/pieces`. If a new screen seems to
  need a new card, button, or heading style, it almost certainly needs an
  existing one with different content.
- **Values come from `design/`.** No new colours, sizes, radii, or spacing
  steps. The accent appears sparingly — on Today it is used three times
  (progress fill, "See all", active tab) and nowhere else.
- **Serif is for titles only.** Screen titles, the featured composition
  title, and library composition titles. Everything functional — composers,
  metadata, labels, controls — is Inter.
- **Borders, never shadows.** One hairline `BORDER_WIDTH` in `colors.border`.
- **Score imagery earns its place.** A piece is shown with its score, not an
  icon or a coloured tile.
- **Titles clamp.** Composition titles cap at two lines; composers and
  metadata at one. Long real repertoire names — "Sonata for Violin and Piano
  No. 9 in A major, Op. 47 'Kreutzer'" — must not break a row's layout.
- **Safe areas, never device constants.** Top spacing is `ScreenContainer`'s
  `SafeAreaView`; bottom spacing is the measured tab-bar height from
  `navigation/tabBarMetrics`. No status-bar or notch numbers anywhere.

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
    node ../tools/audit-a11y.mjs 4323 Today Library Insights Profile

`EXPO_PUBLIC_FIXTURES=empty` makes `data/sources/fixtures.ts` describe an
account with no pieces, no takes and no insights. It is the state **every
musician meets first** and the one every other build lacks: Today, Library and
Insights are otherwise only ever seen with a library, a take and thirty days of
trend behind them.

That gap has cost a real bug. On 2026-09-02 Today was found telling a new
musician *"Nothing to practice yet"* directly above a fully built daily warmup
it was hiding from them, and it was found by hand-editing five functions and
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

## Not built yet

`Modal` is specified in the brief and not built. `Input` and `SearchField`
were on this list until they had callers — `Input` across the auth and
transcription screens, `SearchField` in the library — and `BottomSheet` is
used by the add-piece sheet. Library, Insights and Profile were on it too, and
are built. This section had said otherwise for long enough that it was
describing a different app.

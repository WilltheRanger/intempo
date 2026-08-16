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

Optional environment variables (all have working defaults):

| Variable | Default | Purpose |
|---|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | `http://127.0.0.1:8000` | FastAPI backend |
| `EXPO_PUBLIC_SUPABASE_URL` | — | Supabase project, for auth |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | — | Supabase anon key |

The app boots without the Supabase variables — it runs on fixtures today, so
nothing authenticated is on the Today screen's path yet.

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

## Why fixtures

The Today screen shows progress, a last-practiced line, and score thumbnails.
None of those exist behind the API:

- `scores` has no progress column and no movement field.
- Last-practiced would come from `analyses.created_at`, but `/v1/analyses`
  isn't built (Batch 4).
- Score images sit in a private bucket and no endpoint signs a download URL.
  `scores.source_image_url` stores the signed *upload* URL, which expires
  after five minutes.

`data/sources/api.ts` implements the real mapping and returns `null` for each
of those fields, so the gap is visible in code rather than hidden. The fixture
artwork is the repo's own public-domain set from `fixtures/scores/` — each
thumbnail is genuinely the piece it claims to be. See
`fixtures/scores/SOURCES.md` for provenance.

## Not built yet

Library, Insights, Profile, and Practice are placeholders. They wait for the
Today screen's visual system to be signed off so they inherit settled
components rather than a second set that has to be reconciled later.

`Input`, `SearchField`, `Modal`, and `BottomSheet` are specified in the brief
but not built — nothing uses them yet, and a component with no caller tends to
be wrong in ways you only discover on its second use.

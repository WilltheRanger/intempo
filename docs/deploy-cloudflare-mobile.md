# Deploying the mobile app preview to Cloudflare Pages

A browser build of the **React Native app** in `mobile/`, rendered through
react-native-web, so the screens are clickable without a simulator or a
TestFlight build.

This used to be one of two web builds in the repository. The other — a Vite
frontend in `frontend/`, with its own `docs/deploy-cloudflare.md` — was deleted
on 2026-09-09, so this is now the only browser build there is.

## Set up the Pages project

If a Pages project already exists from that era it will have **Root directory
`frontend`**, which no longer exists on `main` and now fails in zero seconds.
Repoint it using the table below, or create a new one.

Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
**Connect to Git** → pick the `intempo` repo → **Begin setup**.

| Field | Value |
|---|---|
| Project name | anything free — it becomes `<name>.pages.dev` |
| Production branch | **`main`** (the default, and correct — `main` has the app) |
| Framework preset | **None** |
| Root directory | **leave empty** |
| Build command | **`npm run build`** |
| Build output directory | **`mobile/dist`** |

Then **Environment variables → Production**, before the first build:

| Variable | Value | Why |
|---|---|---|
| `NODE_VERSION` | `22` | Expo SDK 57 needs a current Node. Cloudflare's default is older, and this is the usual first-build failure. |

Save and deploy. First build takes 3–5 minutes, mostly `npm ci`.

`npm run build` is the root `package.json`'s only script — it runs
`cd mobile && npm ci && npm run build:web`. Keeping the path in
the repo rather than in a dashboard field means the two can't drift apart, and
it's the configuration verified from a clean tree on `main`.

<details>
<summary>The equivalent setup using Root directory instead</summary>

| Field | Value |
|---|---|
| Root directory | `mobile` |
| Build command | `npx expo export --platform web` |
| Build output directory | `dist` — **not** `mobile/dist` |

Under the v2 root-directory strategy the output path is *relative to the root
directory*, so `mobile/dist` there sends Cloudflare looking for
`mobile/mobile/dist`. That is the second-most-common first-build failure.

</details>

### Nothing else needs configuring

- **Deep links need no fallback rule.** Every screen has a URL
  (`mobile/src/navigation/linking.ts`), and a refresh on `/pieces/:id` still
  loads the app because the export has no top-level `404.html`, which is what
  makes Pages serve `index.html` for any unmatched path. Do not add the
  `/* /index.html 200` rule from Cloudflare's SPA guide: Pages rejects it as an
  infinite loop, prints a warning on every build, and applies nothing. If a
  `404.html` ever appears in `dist/`, this default stops and refreshes on deep
  links will 404.
- **So do the cache headers** — `mobile/public/_headers` marks the hashed
  bundle and assets immutable and the entry point no-cache.
- **No secrets are required.** With no Supabase variables the app runs on
  fixtures and opens straight onto the Library; the sign-in gate passes through by
  design. Adding them (below) turns the gate on.

### The production branch

`mobile/` now exists on `main` — PR #2 merged 2026-08-16, commit `46c2da3` —
so the default production branch is correct and nothing needs changing.

Before that merge it was not: `mobile/` was empty on `main`, zero files, and a
build pointed there failed on the missing root directory before it reached npm.
That was the second of the two failures logged below. If you ever see it again,
the cause is the same: the branch being built doesn't have the app on it.

Cloudflare also builds a preview URL for every other branch and PR.

### Status, 2026-08-16 — deploying from `main`

`main` carries the whole app as of `f3cb2f3`, and the `intempo` project's build
check has come back **green** on the last two commits. That is the deploy path:
push to `main`, Cloudflare builds it.

Verified from a clean tree on `main` before the merge — `rm -rf
mobile/node_modules mobile/dist && npm run build` at the repo root, which is
the exact command Cloudflare runs. Exits 0, applies the `expo-audio` patch via
`postinstall`, and writes a 4.9 MB `mobile/dist`. The export was then served
and driven in a browser: every screen renders, fonts load, no console errors.

**There are three Pages projects on this repo and two of them are failing.**

| Project | State | What it looks like |
|---|---|---|
| `intempo` | ✅ green | The one that works. This is the deploy. |
| `front` | ❌ failing | Reports failure in the same second it starts |
| `i` | ❌ failing | Same shape |

A build that fails in zero seconds never ran — that is a configuration error,
not a build error, and the usual cause is a **root directory that doesn't
exist** on the branch being built. Both extra projects red every commit, which
makes the checks list useless for spotting a real failure.

If `front` and `i` were attempts at this same app, delete them; `intempo`
already serves it. Any project still pointed at `frontend` is building a tree
that was deleted on 2026-09-09 and can only fail — repoint or delete it. Their
logs are only in the Cloudflare dashboard, and nothing about them is reachable
from the repo.

### If the build fails on a missing package.json

```
Executing user command: npx expo export --platform web
ConfigError: The expected package.json path: /opt/buildhome/repo/package.json does not exist
```

The root directory isn't set — the command ran at the repo root, where there
is no Node project. The second tell is in the line above it: `npm warn exec
The following package was not found and will be installed: expo@57.0.13`. With
the root directory set, Cloudflare installs `mobile/`'s dependencies first and
`expo` is already local, so npx never fetches it.

Set **Root directory** to `mobile` and retry the deployment; nothing in the
repo needs to change. Note that under the v2 root directory strategy the
**output path is relative to the root directory** — with root `mobile` the
output is `dist`, and writing `mobile/dist` there sends it looking for
`mobile/mobile/dist`.

If the field is unavailable or won't stick, there is a root `package.json`
whose only job is to reach the app, so the path lives in the repo rather than
in a dashboard field:

| Setting | Value |
|---|---|
| Root directory | *(empty)* |
| Build command | `npm run build` |
| Build output directory | `mobile/dist` |

It runs `cd mobile && npm ci && npm run build:web`. The `npm ci`
is the part that matters: with no dependencies declared at the repo root,
Cloudflare's automatic install step installs nothing, and without it `npx`
goes and fetches its own copy of Expo — which is what the failing log shows.

### Auth and live data need all three variables — and a hosted backend

**Never put `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` or
`GEMINI_API_KEY` in a Pages environment.** This project is a *static export*;
the FastAPI backend does not run here, so nothing on Cloudflare would read
them. Named with the `EXPO_PUBLIC_` prefix they would be inlined into the
bundle and readable by every visitor — and the service-role key bypasses RLS,
so that is full read/write on every account's data. Without the prefix Expo
ignores them and they do nothing. There is no naming that makes them useful
here. They belong wherever `backend/Dockerfile` is deployed.

Three variables put the app on live data, and **the app only switches when all
three are present** (`mobile/src/data/environment.ts`):

| Variable | Value | Safe to publish? |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | the project URL | Yes |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | the anon key | Yes — meant to ship in a client; RLS protects the data |
| `EXPO_PUBLIC_API_BASE_URL` | the public URL of the FastAPI backend | Yes, it's just a hostname |

**Add the third one only once a backend is actually serving at that URL.**
Setting all three against a host that isn't up takes the deployed site from a
working fixture demo to every screen failing to load — the switch is presence,
not reachability, so it cannot detect the difference.

Setting only the first two is deliberately a no-op: the app stays on fixtures
and the sign-in gate stays open. The gate follows the same all-three predicate
as the data, because a build that demands a sign-in and then serves sample data
is a gate guarding nothing. (This changed on 2026-08-17; before that the two
Supabase variables alone were enough to turn the gate on.)

## What already ships in the repo

- **No `_redirects`, on purpose.** Deep links work through Pages' own SPA
  fallback (see "Nothing else needs configuring" above). Locally, use
  `node tools/serve-with-headers.mjs mobile/dist 4320`, which serves
  `index.html` for unknown paths and applies `_headers`, rather than
  `python -m http.server`, which 404s on `/pieces/…`.
- **`mobile/public/_headers`** — immutable caching for `_expo/static/*` and
  `assets/*`, both of which carry content hashes in their filenames, and
  no-cache for `index.html`, which doesn't. Without it the 3.3 MB bundle is
  re-fetched on every visit; with a stale `index.html` a browser can end up
  pinned to a bundle that no longer exists.
- **`npm run build:web`** in `mobile/package.json`, the same command Cloudflare
  runs, so a failure can be reproduced locally before pushing.
- **`mobile/package-lock.json`**, so Cloudflare's install resolves the same
  versions this was built and verified against.

- **`patch-package` is a runtime dependency, not a dev one.** It runs from
  `postinstall` and applies `patches/expo-audio+57.0.3.patch`, which is what
  keeps Android recording off the OEM's processed input path. `npm ci` installs
  dev dependencies anyway, so this is belt and braces — but a build environment
  that omitted them would produce a working app that records subtly wrong
  audio, which is the one failure worth being paranoid about.

Verified from a clean tree with Node 22: `rm -rf mobile/node_modules
mobile/dist && npm run build` at the repo root — the exact command Cloudflare
runs — exits 0, applies the patch, and writes `mobile/dist`: `index.html`, a
JS bundle, the bundled fonts, the fixture images, and `_headers`.

## What this preview is, and what it isn't

It is the real component tree, real navigation, real layout and state — the
geometry is genuine. It is **not** the native app.

| Works | Doesn't |
|---|---|
| Every screen and the whole capture-to-practice flow | Haptics (silently no-op in a browser) |
| The camera, through the browser's `getUserMedia` (`expo-camera` on the web) | Native text rendering — this is the browser's, not CoreText's |
| Navigation, tabs, sheets, reordering, search, deep links | The native audio paths (`expo-audio`); the web records through Web Audio instead |
| Safe-area layout, driven by real insets on a phone | |
| Fixture data without the three variables; live accounts with them | |

Nothing on screen marks this as a preview rather than a working build, so say
what it is when you share the link.

## Caveats worth knowing

- **Bundle size.** The web export is a multi-megabyte JS bundle plus the
  bundled fonts; `tools/check-bundle-size.mjs` holds the budget in CI. Fine
  over a CDN, slow on a cold 3G load.
- **Not a substitute for a device pass.** Font rasterisation, gesture feel, and
  haptics all differ. The visual system still needs one run on real hardware
  before it can be called finished.
- **Fonts are bundled, not fetched.** Newsreader and Inter (four subset TTFs),
  plus Bravura and a Noto Music subset for the notation, ship in the export;
  there is no font CDN to fail.
- **`EXPO_PUBLIC_*` values are baked in, and cached.** They're inlined at
  transform time, and Metro's cache key doesn't include them — so adding,
  changing, or removing `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_ANON_KEY` between local builds keeps the old value
  until you run `npx expo export --platform web --clear`. It cost a confusing
  half-hour once: a build with the keys removed still showed the sign-in gate.
  CI is unaffected, since each run starts from a cold cache.

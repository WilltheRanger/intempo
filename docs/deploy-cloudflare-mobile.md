# Deploying the mobile app preview to Cloudflare Pages

A browser build of the **React Native app** in `mobile/`, rendered through
react-native-web, so the screens are clickable without a simulator or a
TestFlight build.

This is separate from `docs/deploy-cloudflare.md`, which deploys the Vite web
frontend in `frontend/`. They are two different applications and they need two
different Pages projects.

## Set up a second Pages project — don't repoint the existing one

The existing Pages project has **Root directory `frontend`**. Changing it to
`mobile` would replace the web frontend preview with this one. Create a new
project instead so both stay reachable.

Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
**Connect to Git**, pick the `intempo` repo, then:

| Setting | Value |
|---|---|
| Project name | `intempo-mobile` (anything not already taken) |
| Framework preset | `None` |
| **Root directory** | `mobile` |
| Build command | `npx expo export --platform web` |
| Build output directory | `dist` |

Under **Settings → Environment variables**:

| Variable | Value | Why |
|---|---|---|
| `NODE_VERSION` | `22` | Expo SDK 57 needs a current Node; Cloudflare's default is often older, and that is the usual first-build failure. |

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
already serves it. If one is meant for the Vite frontend in `frontend/`, set
its root directory to `frontend`. Their logs are only in the Cloudflare
dashboard — nothing about them is reachable from the repo.

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

It runs `cd mobile && npm ci && npx expo export --platform web`. The `npm ci`
is the part that matters: with no dependencies declared at the repo root,
Cloudflare's automatic install step installs nothing, and without it `npx`
goes and fetches its own copy of Expo — which is what the failing log shows.

### Auth is off unless you add the keys

With no Supabase variables set, the app runs on fixtures and opens straight
onto Today — the sign-in gate passes through, by design. To exercise the real
auth flow on the deployed preview, add both under Environment variables:

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | the project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | the anon key |

Both are public by design — the anon key is meant to ship in a client, and row
level security is what protects the data. Adding them turns on the gate, so the
preview then opens on the sign-in screen instead of the app.

## What already ships in the repo

- **`mobile/public/_redirects`** — the SPA fallback (`/* /index.html 200`).
  Expo copies `public/` into the export, so it lands in `dist/` automatically.
  Without it, a refresh or a shared deep link 404s. It cannot be tested against
  a plain local static server — `python -m http.server` knows nothing about it,
  so `/scores` 404s locally and works on Pages. Don't chase that one.
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
3.3 MB JS bundle, four bundled fonts, the fixture images, and `_redirects`.

## What this preview is, and what it isn't

It is the real component tree, real navigation, real layout and state — the
geometry is genuine. It is **not** the native app.

| Works | Doesn't |
|---|---|
| Every screen and the whole capture-to-practice flow | The camera — the scanner viewfinder is a mock on every platform |
| Navigation, tabs, sheets, reordering, search | Haptics (silently no-ops in a browser) |
| Safe-area layout, driven by real insets on a phone | Native text rendering — this is the browser's, not CoreText's |
| Fixture data throughout | Anything needing the backend; no Supabase keys are set |

Nothing on screen marks this as a preview rather than a working build, so say
what it is when you share the link.

## Caveats worth knowing

- **Bundle size.** The web export is a ~3 MB JS bundle plus four bundled font
  files. Fine over a CDN, slow on a cold 3G load.
- **Not a substitute for a device pass.** Font rasterisation, gesture feel, and
  haptics all differ. The visual system still needs one run on real hardware
  before it can be called finished.
- **Fonts are bundled, not fetched.** Newsreader and Inter ship as four TTFs in
  the export; there is no font CDN to fail.
- **`EXPO_PUBLIC_*` values are baked in, and cached.** They're inlined at
  transform time, and Metro's cache key doesn't include them — so adding,
  changing, or removing `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_ANON_KEY` between local builds keeps the old value
  until you run `npx expo export --platform web --clear`. It cost a confusing
  half-hour once: a build with the keys removed still showed the sign-in gate.
  CI is unaffected, since each run starts from a cold cache.

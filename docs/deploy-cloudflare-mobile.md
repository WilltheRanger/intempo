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

### Set the production branch, or the first build fails

**`mobile/` does not exist on `main`.** It is empty there — zero files — and a
build pointed at `main` fails on the missing root directory before it reaches
npm. Cloudflare defaults the production branch to `main`, so this is the step
that catches people.

Two ways round it, either is fine:

- **Point the project at the branch.** Settings → Builds & deployments →
  Production branch → `claude/mobile-frontend-rebuild-vay1tg`. Live now, and it
  keeps redeploying as that branch moves.
- **Merge PR #2 to `main` first**, then leave the production branch as `main`.
  Tidier long-term; nothing deploys until the merge lands.

Cloudflare also builds a preview URL for every other branch and PR either way.

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
  Without it, a refresh or a shared deep link 404s.
- **`npm run build:web`** in `mobile/package.json`, the same command Cloudflare
  runs, so a failure can be reproduced locally before pushing.
- **`mobile/package-lock.json`**, so Cloudflare's install resolves the same
  versions this was built and verified against.

Verified on this branch with Node 22: install tree clean, `npx expo export
--platform web` succeeds, and `dist/` comes out at 4.9 MB — `index.html`, a
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

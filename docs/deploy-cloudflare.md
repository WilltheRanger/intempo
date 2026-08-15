# Deploying the frontend preview to Cloudflare Pages

A static build of the web frontend, so the screens are viewable in a browser
(including on a phone) without running anything locally.

**This works with a private repo on Cloudflare's free tier** — which is why we
use it instead of GitHub Pages, where private repos require GitHub Pro.

## What this deploys — and what it doesn't

It's the **UI only**. Cloudflare Pages serves static files; the FastAPI service
isn't deployed and no Supabase keys are set. So:

| Works | Doesn't work |
|---|---|
| Every screen renders | Sign-in (no Supabase) |
| Navigation, tabs, empty states | Photograph a score → OCR (no API) |
| `/showcase` design system | Record → analysis (no API, no mic permission over some hosts) |

Screens read seed data from `frontend/src/lib/demo.ts`, and a
**"Preview — demo data, no backend"** badge renders so absent features don't
read as broken. Both disappear automatically once real keys are supplied.

## One-time setup

In the Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
**Connect to Git**, pick the `intempo` repo, then set:

| Setting | Value |
|---|---|
| Framework preset | `Vite` (or `None`) |
| **Root directory** | `frontend` |
| Build command | `npm run build` |
| Build output directory | `dist` |

Then under **Settings → Environment variables**, add:

| Variable | Value | Why |
|---|---|---|
| `NODE_VERSION` | `22` | Cloudflare's default Node can be older than the build needs. This is the most common cause of a first-build failure. |

### Production branch

Set it to the branch that actually has the frontend. `main` is currently back at
Batch 2 and has none of these screens — pointing at it will deploy an app that
doesn't exist yet.

Cloudflare also builds a **preview URL for every other branch and PR**
automatically, which is useful on its own.

## What's already in the repo

- **`frontend/public/_redirects`** — the SPA fallback (`/* /index.html 200`).
  Without it, refreshing on `/scores` or sharing a deep link 404s, because
  Cloudflare only knows about files on disk while React Router owns the routes.
  Vite copies `public/` to the dist root, so it ships automatically.

No `wrangler.toml` is needed — this is a plain static site with no Functions or
bindings.

## Going from preview to a real deployment

When you're ready for the deployed site to actually work, add these under
**Settings → Environment variables** (Production *and* Preview scopes):

```
VITE_SUPABASE_URL      = https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY = <anon / public key>
VITE_API_BASE_URL      = https://<your-deployed-api>
```

Three things follow from that, so do them deliberately:

1. **The preview badge disappears and the auth gate engages.** `ProtectedRoute`
   passes through only while Supabase is unconfigured; once keys exist, every
   screen requires a real sign-in.
2. **Add the Cloudflare URL to Supabase's redirect allow-list**
   (Authentication → URL Configuration), or magic links will send fine and then
   fail on the way back.
3. **Only ever put `VITE_`-prefixed values here.** They are compiled into the
   JavaScript bundle and visible to anyone. The anon key is designed for that;
   `SUPABASE_SERVICE_ROLE_KEY` must never appear in a frontend build — it
   bypasses Row Level Security entirely.

The API itself still needs somewhere to run (Fly.io per the spec's hosting
table). Cloudflare Pages hosts the frontend only.

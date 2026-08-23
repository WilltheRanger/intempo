# Hosting the API, and pointing the app at it

**Live as of 2026-08-23:**

| | |
|---|---|
| API | `https://intempo-api.onrender.com` (Render, free plan, Oregon) |
| App | `https://idk-41z.pages.dev` (Cloudflare Pages) |
| Database | Supabase project `<project-ref>` (`intempo-dev`) |

Use the plain Pages domain, not the per-deployment ones like
`https://a16c6845.idk-41z.pages.dev`. Those are different origins and CORS
rejects them — which presents as a network error, not a permissions one.

The app already calls this API. `POST /v1/scores` runs the whole OCR pipeline —
OMR second opinion, vision model, beat-sum check — and the app's
`useTranscribePage` hook already calls it. **Nothing in the app needs changing.**
It is on sample data only because `EXPO_PUBLIC_API_BASE_URL` is empty.

Two steps.

## 1. Deploy the API

`render.yaml` is a Render blueprint: **New → Blueprint → pick this repo**. It
asks for the secrets on first deploy and keeps them out of git. Fly and Railway
read `backend/Dockerfile` directly if you prefer them.

It names `plan: free`. If Render asks for a card before deploying anything,
something in the blueprint has named a paid instance — check that line first.

**What the free plan costs:** the service sleeps after about 15 minutes idle,
so the next request pays a cold start of roughly a minute, and memory is tight.
That is fine while you are trying the thing out and wrong once a real user is
the one waiting — change `plan` to `starter` then.

Two consequences worth knowing before you blame the app:

* **The first scan after a quiet spell will look like it hung.** It is the
  container waking up, not the OCR. The second is normal speed.
* **Audio analysis may run out of memory** on the free plan — the OCR path is
  light but the analysis path loads librosa and numpy. If `/v1/analyses`
  returns 502 while `/v1/scores` is fine, that is what happened.

You will be asked for:

| Variable | Where it comes from |
|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API |
| `SUPABASE_KEY` | same page, the **anon/publishable** key |
| `SUPABASE_SERVICE_ROLE_KEY` | same page, the **service role** key — server only, never in the app |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `GEMINI_API_KEY` | aistudio.google.com/apikey |
| `CORS_ALLOWED_ORIGINS` | the app's own URL, e.g. `https://intempo.pages.dev` |

`CORS_ALLOWED_ORIGINS` is not optional. The app and the API are never
same-origin, and a browser refuses every response without a matching origin —
the failure looks like a network error rather than a permissions one.

Check it: `curl https://YOUR-API.onrender.com/v1/health` → `{"status":"ok"}`.

## 2. Point the app at it

In Cloudflare Pages → the mobile project → Settings → Environment variables:

```
EXPO_PUBLIC_API_BASE_URL   https://YOUR-API.onrender.com
EXPO_PUBLIC_SUPABASE_URL   https://YOUR-PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY   the anon key
```

All three, or the app stays on sample data — `IS_LIVE_BACKEND` requires all of
them. It says which one is missing in the browser console rather than falling
back silently.

**`EXPO_PUBLIC_*` values are compiled into the JavaScript bundle**, so anyone
can read them. Only the anon key belongs there. The service-role key goes in the
API's environment and nowhere else.

Then **redeploy the Pages project**. Expo substitutes these at build time, not
at runtime, so an existing build keeps whatever it was built with.

## 3. Adding the OMR second opinion (optional, later)

Get the API up first. Then see `docs/deploy-omr.md` — it means rebuilding the
image with `--build-arg WITH_AUDIVERIS=1`, which adds a JDK and a Gradle build.
Until then the step is skipped automatically: one failed lookup on `PATH`, a log
line, and the vision chain answers exactly as before.

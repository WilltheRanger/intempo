# Hosting the API, and pointing the app at it

**Live as of 2026-08-23:**

| | |
|---|---|
| API | `https://YOUR-API.onrender.com` — the managed host, free plan. Real hostname in `LOCAL_NOTES.md`. |
| App | `https://YOUR-PROJECT.pages.dev` (Cloudflare Pages). Real project and hostname in `LOCAL_NOTES.md`. |
| Database | Supabase project `<project-ref>` — named in `LOCAL_NOTES.md`; `list_projects` also finds it |

Use the plain Pages domain, not the per-deployment ones like
`https://a16c6845.YOUR-PROJECT.pages.dev`. Those are different origins and CORS
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
| `CORS_ALLOWED_ORIGINS` | the app's own origins — see below |

`CORS_ALLOWED_ORIGINS` is not optional. The app and the API are never
same-origin, and a browser refuses every response without a matching origin —
the failure looks like a network error rather than a permissions one.

**Cloudflare gives your project more than one hostname**, and the exact list
does not cover them all. There is the production alias
`https://project.pages.dev`, and then a *different* one for every deployment,
`https://a16c6845.project.pages.dev`, plus a branch alias. The dashboard shows
the deployment-specific URL most prominently right after a build, so it is the
one you are most likely to click — and it will fail.

Listing them is hopeless; a new one exists after every push. Use a subdomain
wildcard alongside the exact alias:

```
CORS_ALLOWED_ORIGINS=https://project.pages.dev,https://*.project.pages.dev,http://localhost:8081,http://127.0.0.1:8081,http://localhost:8899,http://127.0.0.1:8899,http://localhost:19006,http://127.0.0.1:19006
```

The `*` stands for **one hostname label**. It cannot cross a dot, cannot appear
in the scheme, and cannot be the whole host — `https://*` would let every site
on the internet read this API with a musician's token, so it is rejected and
logged rather than honoured. `project.pages.dev.evil.com` is a domain anyone
can register, and is refused.

**Once you set this, the localhost defaults stop applying.** The fallback only
covers the case where the variable is empty, so a deployment that names its own
origin has to name the development ones too if it wants them — hence the tail
of that example.

### Applying the schema

**Nothing auto-applies `backend/app/migrations/*.sql`.** No deploy runs them,
so shipping code and applying its migration are two separate acts, and the gap
between them is invisible: the service starts fine and every write that touches
the missing column returns a 500 that reads like a server bug. It has happened
once already — `analyses.instrument` went live in code before the column
existed.

Two ways to apply one, and **the second was overlooked for weeks**:

1. Paste it into the Supabase SQL editor.
2. A Claude session with the Supabase MCP server connected can apply it
   directly — `list_migrations` to see what a project has, `apply_migration` to
   add one. Migration 017 sat unapplied for several sessions, each of them
   reporting it as blocked on the owner, because this file said the SQL editor
   and nobody checked whether that was still the only route.

Run any migration you have not run, in numeric order. The check below names the
ones that are missing.

### Then ask the API what is still wrong

`curl https://YOUR-API.onrender.com/v1/health` answers "is the process alive",
which is what Render's health check needs and all it needs. It answered 200 on
a deployment with no service-role key, no model key and a database missing a
column — while every single write returned 500.

So the one to open is:

```
curl https://YOUR-API.onrender.com/v1/ready
```

**503 with a `blocking` list** naming what is stopping it — each missing key,
an unresolvable provider chain, each missing column — and **200** when nothing
is. It reports only whether a setting is *present*, never its value, so it is
safe to open in a browser on a phone.

`tuning_config` is one of the blocking ones, and worth knowing about because
its failure is invisible until the worst moment. Every analysis threshold lives
in `backend/config.toml` and is read *lazily*, inside the pipeline — so a build
without it starts cleanly, passes the health check, signs people in and reads
photographed pages, and then fails every take with `internal_error`. The API
image shipped that way; the Dockerfile copies it now, and this line is what
would have said so.

Where a take will run is reported too — `analysis_runtime:inprocess`,
`modal_credentials`, `analysis_runtime:modal` — see `docs/deploy-modal.md`.
None of those block: falling back to in-process is degraded, not broken.

Two other things it reports without blocking, because neither stops the app for
everyone: a stale name in `OCR_PROVIDER_CHAIN` (the rest of the chain still
runs), and an unset `CORS_ALLOWED_ORIGINS`.

That second one is worth its own line. It is the **only** misconfiguration here
whose failure names nothing anywhere: a missing key gives a 500 with a message,
a missing column gives column-not-found, a stale model name is logged — a
browser refused by CORS never sends the request at all, so there is no server
log, no status code, and the only thing the client can report is "Failed to
fetch". It looks exactly like the API being down.

### The first request after a nap

The free plan spins down when idle, and waking it takes 50 seconds or more.
The app retries a repeatable request once for exactly this reason, so a cold
start costs a wait rather than an error — but `curl` does not, so give the
first one a generous `--max-time` and do not read a timeout as a fault.

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

## 3. Let the sign-in link come back

Supabase → Authentication → URL Configuration → **Redirect URLs**. Add
**both** of these:

```
https://YOUR-APP.pages.dev/**
https://*.YOUR-APP.pages.dev/**
```

The second line is not optional in practice, and it is the same lesson CORS
already taught this project. Cloudflare Pages gives a project **a new hostname
for every deployment** — `https://a16c6845.YOUR-APP.pages.dev` — plus a branch
alias, and the dashboard shows the deployment-specific URL most prominently
after a build, so it is the one you are most likely to open. `authRedirectUrl()`
returns whatever origin the page is actually being served from, so a sign-in
started from that URL asks Supabase to redirect back to it, and a list holding
only the production alias does not cover it.

**Supabase rejects any redirect it has not been told about and silently falls
back to the Site URL.** No error, no log line the app can see — the mail
arrives, the link works, and it lands on a Supabase page instead of the app.
That looks exactly like the feature not being built.

The app asks for the right thing already: `authRedirectUrl()` returns
`window.location.origin` on web, so a preview build's mail comes back to the
preview and production's to production. Hardcoding one would cross them. The
allowlist is the half that lives outside the repo.

## 4. The page reader (not optional, and not a second opinion)

Get the API up first, then see [`docs/deploy-modal.md`](./deploy-modal.md).

**This section used to say the opposite, and following it would have cost you a
deploy.** It called the reader an optional second opinion and promised that
until it was added "the step is skipped automatically: one failed lookup on
`PATH`, a log line, and the vision chain answers exactly as before". That was
true when the chain had a vision model behind homr. It has not been true since
the chain became homr alone (`backend/app/config.py`, 2026-08-24), and the
sentence pointed at `docs/deploy-omr.md`, which has never existed.

What is actually true, from `backend/app/workers/transcription_runner.py`:

- the chain is `OCR_PROVIDER_CHAIN`, which defaults to `homr` and has nothing
  behind it;
- homr is installed **only in the Modal container**, so an API host on its own
  has no reader in it at all;
- `_nothing_here_can_read()` catches that up front and fails the row with a
  message that blames the server rather than the photograph — *"the machine
  that reads them could not be reached… the photograph is still here, so try
  reading it again in a few minutes"*.

So the API alone will sign people in, hold a library and analyse recordings, and
**every scan will refuse**. That is the accepted trade rather than a bug: a
refused scan is retakeable because the photograph is kept. It is not a step you
can defer and still have a working scanner.

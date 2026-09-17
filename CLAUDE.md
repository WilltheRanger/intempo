# CLAUDE.md — working agreement for InTempo

This file is read at the start of every Claude session. It is binding.
`intempo-combined.md` is the source of truth for *what* to build;
this file is *how* we work while building it.

**The spec is not in this repository.** It carries the monetisation strategy,
pricing rationale and unit economics, and was withheld when the repository was
opened. Around fifteen code comments, migrations and test docstrings cite it by
section — those citations are still correct about *why* something is the way it
is, and the section they point at is simply not public. They were deliberately
not rewritten, for the reason §5 gives about pointers: touching fifteen files to
fix one is how a documentation change becomes a diff nobody reviews.

**`LOCAL_NOTES.md` is not in this repository either, and four passages below
point at it.** It holds the *identities* this file used to name: which Supabase
project is the live one, which Cloudflare Pages project is the live site, what
hosts the backend, and the Actions-minutes history. It is gitignored, so it is
on the owner's machine and **a session container does not have it** — the same
situation as the `.env` files §4 describes, and going to look for it costs a
search that ends in nothing.

It was moved out on 2026-09-17, while assessing the repository for going
public. None of it is a credential — no key, token or project ref is in it, and
none has ever been committed here. It is a *map*: harmless alone, and a list of
what to probe once the schema is published beside it.

**Every passage that used to name one of those identities keeps its lesson and
now says how to recover the fact with a tool instead** — `list_projects` for
the live project, `get_workflow_run_usage` for the refusal, which Pages check
takes real seconds to build. So a session without the file is slower, never
blocked, and no rule here has had its subject deleted out from under it. That
last part is the whole difficulty of moving anything out of this file, and §5
is the standing argument about it.

## 1. Follow the developer procedures — every session, no exceptions

These are the "Operating principles" and "Build-time activity logging"
rules from the spec's Part II (see the note above — the spec is private).
They are not optional polish.

**The three logs — keep them current as you work:**

| File | When to write | What goes in |
|---|---|---|
| **The commit message** | Every commit | What changed, why, tests run, known side effects, rollback. This is the entry. Atomic, frequent, descriptive. |
| `DECISIONS.md` | Only on a real "X over Y because Z" architectural call | Context, decision, alternatives considered, trade-offs accepted. |
| `TUNING_LOG.md` | Every Batch 3 audio-threshold change | Old value → new value, clip-by-clip regression across all six fixtures, rationale. |

**There was a fourth, `EDIT_LOG.md`, and it was removed on 2026-09-10.**
Measured before removing it rather than argued: every commit carried a detailed
message *and* a log entry roughly **1.8× its length** saying the same thing, and
668 entries had reached **43,577 lines** — a quarter of every diff, and the
most-modified file in the repository. Its stated reason for existing was that a
commit had once landed without an entry and nothing noticed, which is a guard on
the log rather than an argument for it.

What it did uniquely — a chronological narrative, rollback notes, corrections of
earlier entries — git already provides through `git log -p`, attached to the
diff it describes instead of a thousand lines away from it. **`git log` is the
running account**, and roughly a dozen code comments still say "see
`EDIT_LOG.md`": they mean that history, which is in `git log -- EDIT_LOG.md`.
They were not rewritten, for the reason §5 gives about pointers.

The trade this accepts: nothing now enforces that a change is described. The
commit message is the only record, so write it as one.

Five Python checks run on every push, and a change that trips one is not
merged: `check-brand-assets.py` (a new asset shipping as the Expo
starter's, or a listed one drawn and its line now a false claim),
`check-dead-exports.py` (a named export nothing else in the corpus references),
`check-dependencies.py` (npm and `pip-audit` advisories, added to CI
2026-09-09), `check-migrations.py` (all migrations applied in order to an empty
database) and `check-outbound-fetch.py` (an inventory of every place the backend
fetches a URL — added 2026-09-09 after two twin functions drifted apart and one
of them shipped an SSRF). `.github/workflows/ci.yml` is the list that cannot go
stale.

**Run `tools/preflight.py` before you commit** — faster than a push, and it
catches most of what CI would. It is no longer the only gate: **CI runs again
as of 2026-09-12**, after six days refusing every job.

**The refusal signature, worth recognising if it returns:** jobs *created* and
then refused before a runner picks one up — **0 billable milliseconds** on all
five, a run about five seconds long, log downloads 404ing because no log
exists, and an empty check-run output. That is an account being refused
compute, not broken YAML, which fails differently and produces both logs and
billable time. The cause both times was **exhausted Actions minutes**: this is
a private repo on a personal account, so minutes are billed, where a public
repo's are free and unlimited. The plan, the allowance and the run numbers are
in `LOCAL_NOTES.md` — gitignored, so a session container does not have it; what
a session needs is the signature above and the conclusion, which is that **no
commit can repair this** and it is the owner's billing page. `get_workflow_run_usage`
on the run is how you confirm it rather than guess: 0 billable ms is the tell.

**Minutes are still finite**, and `app-walk` — two web builds, the walk, the
devices and two accessibility sweeps — is most of the cost of a run. Preflight
first; push when you believe it is green.

**Its first working run failed two jobs, and both were defects in checks rather
than in the app**: `check-brand-assets.py` could not tell "the art is wrong"
from "I could not look at the art", because the job had no Pillow and the check
read only stdout; and `device-check.mjs` demanded a permission error from a
headless runner with no audio hardware to refuse. Neither is reachable on a
machine that has Pillow installed and a sound card. **A check that has never
run in CI is not a check yet** — if you add one, watch it run there.

    tools/preflight.py            # the gates that need no build
    tools/preflight.py --full     # and the builds, the walk and the audits

It runs what `ci.yml` runs, prints what it cannot run and why, and needs a
`DATABASE_URL` for the migrations gate — any empty Postgres will do. It is not
a substitute for CI: one machine, one Node, one Python, and the working tree
rather than what was pushed.

**Three of the four Cloudflare Pages checks on every PR are permanently red and
are not yours.** `front`, `intempo` and `i` are abandoned projects still wired
to this repo — `front` builds the `frontend/` tree deleted on 2026-09-09 — and
they fail in zero seconds on every commit, including on `main`. **Exactly one
of the four is the live site and the only one worth reading**; it is named in
`LOCAL_NOTES.md`, and without that file you can still tell which: it is the one
that takes real seconds to build and passes, where the abandoned three fail in
zero. Their build settings live in the Cloudflare dashboard, so no commit can
repair them; deleting them is the owner's.

**The session container runs a Postgres, and the migrations gate had been
skipped for want of it.** Every session read "no `DATABASE_URL`" as "there is
no database here", so the one check that can catch SQL which does not run had
never run at all. `preflight.py` now says when a server is answering; the shell
user may still have no role on it, which `su postgres -c 'createdb preflight'`
fixes. **It also stops on its own** — twice in one session, once across a
container restart and once mid-`preflight --full`, which reports the gate as
`FAIL … connection refused` rather than as a skip. `pg_ctlcluster 16 main start`
brings it back with the role and databases intact; a stale pid file is normal
and it clears that itself. Same shape as the mistake below about the schema, and worth reading
together: **before calling something unavailable, check whether this session
already has it.**

**The schema is not owner-blocked, and several sessions wrongly said it was.**
No deploy applies `backend/app/migrations/*.sql`, but a session with the
Supabase MCP server connected can: `list_migrations` shows what a project has,
`apply_migration` adds one. Migration 017 sat unapplied for weeks with each
session reporting it as waiting on the owner, because the docs said "the
Supabase SQL editor" and nobody checked whether that was still the only route.
**Before calling anything owner-blocked, check whether a tool in this session
can do it.**

**Which project is the live one matters, and more than one of them looks
plausible** — including one whose name is exactly this repository's, which is
paused and which nothing points at. Targeting that one would apply a migration
to a database no deploy reads. The live project's name is in `LOCAL_NOTES.md`;
`list_projects` is how you find it without that file, and the discriminator is
`status: ACTIVE_HEALTHY` plus a schema `list_migrations` shows to be in step
with `migrations/`. Neither the name nor the ref is written down here.

**The rest of the operating principles:**

1. **Branch per batch** (`feat/batch-N-...` or the session's assigned branch). Squash to main on DoD.
2. **One fixture file per tricky endpoint** — save the raw response to `fixtures/`, test against it forever. Never call a real LLM/paid API in CI.
3. **Build the best version first.** Not a sketch you intend to replace — the
   version you would defend in review. The shape of the data, the correctness
   of a rule and the composition of a screen are all far cheaper to get right
   now than after something is built on top of them, and a large part of
   `EDIT_LOG.md` is the cost of the other choice. This is **not** licence to
   gold-plate: "best" means the best version *of what was asked for*, not more
   than was asked for. Speed is the one thing still worth leaving alone until
   something is measurably slow — measure, then optimise.
4. **No `print`/`console.log` debug shipped.** Real logger from day one —
   **which here means stdlib `logging` in the backend and nothing at all in
   `mobile/`.** The rule used to name `loguru` for Python and `pino` for JS, and
   **neither is in this repository**: not in `pyproject.toml`, not in `uv.lock`,
   not in `package.json`, not in a single source file, and neither appears in
   any manifest or source file across the 98 commits a session's shallow clone
   can see — only in this sentence's own predecessor. Reaching for either on the
   instruction's word costs a dependency the project does not want, and `pino`
   is a server-side logger that does not belong in a React Native app at all.
   What the backend actually does is
   `logging.getLogger("intempo.<area>")` — `intempo.analysis`, `intempo.ocr`,
   `intempo.scores`, `intempo.me`, `intempo.transcription`, `intempo.training`
   — so a new log line joins that hierarchy rather than starting a second one.
   `mobile/` has no logging facility and the two `console` calls below are the
   whole of it, which is deliberate rather than a gap.
   Enforced in `mobile/` since 2026-09-03 (`no-console`, error). Two lines are
   exempt with a written reason: `App.tsx`'s boot line naming whether the build
   is on fixtures, and `ErrorBoundary.componentDidCatch` — the only record a
   crash leaves. **The app had no linter at all until then**, while six files
   carried `eslint-disable` directives for one; `react-hooks/rules-of-hooks` is
   the rule it was worth installing for, since a hook below an early return is
   React error #310, which this project has shipped and which compiles,
   typechecks and passes its tests. Rules and the three scoped exceptions are in
   `DECISIONS.md`, 2026-09-03. There used to be a second, unlinted tree
   (`frontend/`) that CI also ignored; it was deleted on 2026-09-09 and
   `mobile/` is now the only JavaScript in the repository.
5. **Smoke-test the happy path manually** after each batch, not just automated tests.
6. **Tag the end of every batch**: when the DoD is met, `git tag batch-N-done` and push the tag. These are the known-good rollback anchors — so check `git ls-remote --tags origin` before writing one, because a shallow session clone shows none of them and re-tagging moves an anchor (see §4).
7. **Externalize magic numbers to config** (see `backend/config.toml`) so tuning never requires a code edit.
8. **Be honest about DoD status.** If part of a Definition of Done can't be met in-session (e.g. it needs a human ear or real recordings), say so plainly in `EDIT_LOG.md` and the PR — never claim it's done.

**Definition of Done for a batch** = the batch's own DoD checklist in
the spec + all four logs updated + tests green + tag pushed.

## 2. STOP and ask before any UI/UX work

The human owns the look and feel (spec §3.5 is an art-director brief, not
a licence to vibe-code freely). **Before starting any batch that builds
or changes user-facing UI/UX, pause and ask the user before proceeding** —
present the plan and get a go-ahead first. This applies to:

- **Batch 5** — Frontend foundation
- **Batch 6** — Score capture flow
- **Batch 7** — Recording + analysis flow
- **Batch 8** — Free tier + Stripe + Pro upgrade (has UI)
- **Batch 9** — Native iOS (React Native)
- **Batch 13** — App Store launch + marketing
- …and any later batch, or any change, that touches a screen, component,
  visual style, copy the user sees, or the design system.

Backend / infra / data / pipeline batches (0–4, 10 offline sync core,
11 telemetry, 12 teacher-tier backend) do **not** require this gate —
proceed on those following the procedures in §1.

If in doubt whether something is "UI/UX," ask.

## 3. Design laws — binding for every UI change

These govern all UI work and outrank any component convention in
`docs/subsystems.md`. They are
the user's rules, not suggestions to weigh against convenience.

1. **Design a native mobile product, not a responsive website shrunk onto a
   phone.** Mobile is the primary target; desktop is an adaptation of it, not
   the other way round.
2. **Prioritise hierarchy, spatial rhythm, thumb reach and content flow** over
   decorative components.
3. **Do not turn every section into a card.** The background is a compositional
   surface. Cards are reserved for information that genuinely needs grouping.
4. **One dominant focal point per screen.** Secondary information must visually
   recede. Two competing focal points means the hierarchy is wrong.
5. **Consistent horizontal margins and a deliberate vertical spacing system.**
   Spacing is a system, not a per-component guess.
6. **Rounded containers, pills, gradients, shadows, borders and floating
   elements are exceptions, not the default styling language.** Reach for
   typography and spacing first. **The control layer is the one exception**
   (amended 2026-09-06): navigation, toolbars, buttons and floating panels are
   floating glass capsules — `mobile/src/components/primitives/GlassSurface`.
   That list *is* the definition of chrome for this rule; content keeps the rule
   in full and may never use the material.
   **The bottom bar is not covered by that exception and never carries a
   gradient** (amended 2026-09-12, asked for three times). The glass material's
   specular catch is light across a small curved capsule; across the full width
   of the one element that is on screen at all times it is a pale band, and
   "there should not be gradience on the lower bar" is the standing answer.
   Twice it was removed by narrowing the *ground* it was drawn over — chrome
   over content, then the Today photograph — and both times it stayed on three
   of the four tabs. It is a property of the surface: `glassMaterial`'s `bar`
   context, held by `material.test.ts` in both palettes.
7. **Design around the thumb zone.** Primary actions sit comfortably reachable
   near the bottom; secondary actions can sit higher.
8. **Use typography to create hierarchy instead of relying on containers.**
   If a box is doing the work a type scale should do, remove the box.
9. **Bottom navigation is persistent app furniture — and it floats.**
   Amended 2026-09-06, reversing "not a floating card. Opaque, anchored,
   unrounded, part of the frame." It is a translucent capsule inset from the
   edges with content scrolling beneath it. *Furniture* still governs the rest:
   it does **not** resize on scroll, and it carries **no** selection pill — both
   were prototyped and rejected. See `DECISIONS.md`, 2026-09-06.
10. **Every element must justify its presence.** If removing it makes the
    interface clearer, remove it.

**Every control answers the finger, and every affordance is real.** Two rules,
added 2026-09-06 after a sheet shipped with a grab handle nothing dragged:

- **A drawn affordance must do the thing it depicts.** A grab handle means
  swipe-to-dismiss, a chevron means it opens, a switch means it toggles. Drawing
  one and not wiring it is worse than drawing nothing, because it costs a try
  before it teaches you it is a lie.
- **A tap gets an immediate response**, before whatever it triggered arrives.
  `PressableScale` for large targets; a pressed colour or opacity for small
  ones. A control that looks identical during the press reads as dead on any
  action that takes more than a moment.

Before shipping a screen, ask what a thumb would try on it — swipe down on a
sheet, swipe back from a pushed screen, pull to refresh a list, press and hold a
row — and either support it or do not draw the thing that suggests it.

**Screen rules live in modules, not components.** There is no React Native
testing library here (`DECISIONS.md`, 2026-08-24), so a rule inside a `.tsx` is
a rule nothing checks. Put the rule in a module with tests and let the component
call it. This is filed under the capture path in `docs/subsystems.md` because
that is where it was learned, but it applies to every screen.

**The three-foot test — run it before writing any UI code, and again on the
screenshot afterwards.** Look at the screen from across the room and name what
you notice first, second and third. If everything competes, the hierarchy is
wrong and the fix is composition, not more styling. Record the answer in
`EDIT_LOG.md` for any screen you build or change.

## 4. Batch status (keep this current)

**The shipping app is `mobile/`** — Expo, also built to web for Cloudflare
Pages, and since 2026-09-09 the only application in the repository. Batches 5–7
below say "(web)" because they were built in a legacy Vite tree, `frontend/`,
which nothing deployed and which was deleted along with its section of
`docs/subsystems.md`. **Their screens were rebuilt in `mobile/` and that is
where they live**; the batch lines are kept because their DoD gates are still
open. `git log -- frontend/` is where the old tree went.

- Batch 0 — Foundations ✅
- Batch 1 — Backend infra (auth, DB, storage) ✅
- Batch 2 — Sheet music OCR pipeline ✅
- Batch 3 — Audio analysis core ✅ (pipeline done; threshold tuning against real recordings still pending — see `TUNING_LOG.md`)
- Batch 4 — Async analysis API + calibration ✅ (BackgroundTasks; Celery migration deferred to spec §11 triggers)
- Batch 5 — Frontend foundation ⏳ (shell done in `mobile/`: design tokens locked, primitives, routing, auth/data plumbing; build + lint green. Live magic-link auth + E2E test pending Supabase keys — see `EDIT_LOG.md`. Not tagged `batch-5-done` yet.)
- Batch 6 — Score capture flow ⏳ (capture + OCR-review editor + save built in `mobile/`, **rebuilt to the locked design system** 2026-07-28; build + lint green. Live upload→OCR→save + iPhone camera pending Supabase keys/device — see `EDIT_LOG.md`. Not tagged `batch-6-done`.)
- Batch 7 — Recording + analysis/verdict flow ⏳ (tempo/calibration/metronome, MediaRecorder panel, polling result screen with verdict/annotated-score/trend/per-note built, **rebuilt to the locked design system** 2026-07-28; build + lint green. Live mic→analysis loop pending backend — **the microphone itself now records on a real iPhone**, confirmed 2026-09-13; see §4 and the recording path in `docs/subsystems.md`. Not tagged `batch-7-done`.)
- Batch 8+ — mostly UI/UX → see the §2 gate and the §3 design laws. **Build to
  the tokens and never re-type hexes** — `mobile/src/design/`, which is now the
  only answer. For a long time this line named only the legacy tree's
  `frontend/src/styles/tokens.ts`, and the two palettes shared **no colour but
  white** (measured 2026-09-02), so following it while working in `mobile/`
  built a screen in the wrong palette. Deleting that tree is what finally made
  the instruction unambiguous.

**Honest DoD status.** `git tag` is the answer — **but fetch the tags first, or
it answers with the opposite of the truth.** The session container's clone is
shallow and carries no tags, so a bare `git tag` prints **nothing**, which reads
as "no batch has ever been tagged, so by this file's own Definition of Done
nothing is done". Three are:

    git fetch --tags origin && git tag

That is the same mistake as the three in §1, and here it is this file that
causes it: **before reporting a batch untagged, check whether the tag is on the
remote.** `git ls-remote --tags origin` answers without touching the working
copy. Rule 6's `git tag batch-N-done` also succeeds locally against a name that
already exists on the remote, and the push is then rejected — recoverable, but
the way to not spend a session on it is to look first.

Batches **0, 1 and 2 are tagged and pushed** (`batch-0-done`, `batch-1-done`,
`batch-2-done`, alongside `spec-v1`); **3 and 4 are marked ✅ and are not
tagged**, so by this file's own Definition of Done they are not done; 5 onward
are ⏳. The screens are verified *visually*, not end-to-end.

What each remaining gate is actually waiting on, measured 2026-09-09 rather than
repeated — because "blocked on Supabase keys" had become a blanket claim that
was no longer true of all of it:

**First, about the two `.env` files the entries below describe: in a session
container there are none.** `.env` and `.env.*` are gitignored, so a fresh
clone has `backend/.env.example` and nothing else — no `backend/.env`, no
`mobile/.env`, anywhere in the tree. What those entries say about their
contents is true of the owner's machine, not of the one you are on, and going
to look costs a search that ends in nothing. Two things follow and both are
fine: a web build made here is a **fixtures build by construction**, because
`environment.ts` switches on the presence of all three `EXPO_PUBLIC_*` values
and absence is the safe direction; and `preflight.py --full`'s
`env_moved_aside` has nothing to move, which it handles. Nothing here is
broken — but "the anon key is set in both `.env` files" reads like a file you
can open, and you cannot.

- **The schema** — *not blocked.* See §1. The live project was fully in step
  with the code as of 2026-09-17; every column and table `readiness.py`
  requires is present, and `list_migrations` is how you confirm that rather
  than trusting this line.
- **upload→OCR→save** — *not blocked on keys, and a session got this wrong on
  2026-09-11.* `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` and
  `GEMINI_API_KEY` are empty in `backend/.env`, and that file is **this
  container's scratch configuration, not the deployment's**. The backend runs
  on a managed host that holds its own environment — named with its URL in
  `LOCAL_NOTES.md` — the owner set those keys there, and `GET /v1/ready` on the
  deployed API answered `"ready": true` with an empty `blocking` list. **Ask
  the running service, never the local `.env`** — `readiness.py` exists to be
  asked, and the session container's proxy may refuse that host, in which case
  say you could not check rather than reading the file and calling it an
  answer. Same shape as the two mistakes in
  §1: before calling something unconfigured, check whether the thing that
  actually runs it is configured.
- **Live magic-link auth** — the anon key *is* set in both `.env` files. What is
  missing is a person clicking a link in an inbox, which no session can do.
- **mic→analysis** — *the microphone half is no longer blocked, and was never
  only a hardware problem.* Confirmed recording on the owner's iPhone on
  2026-09-13, after six attempts: the page declared
  `navigator.audioSession.type = 'playback'` at boot and WebKit refuses all
  capture under that category. Five fixes went at the `AudioContext` and the
  constraints because the error name reads as something else — see the
  recording path in `docs/subsystems.md`. **No gate in this repository could
  have caught it**: `navigator.audioSession` does not exist in Chromium and
  every check here is Chromium. What remains is the rest of the loop —
  upload → analysis → verdict against the live backend.

## 5. Before you work on a subsystem, read its section

`docs/subsystems.md` holds what was learned the hard way about five parts of
this codebase: the `mobile/` tree and transcription, the capture path, the
recording path, the API's concurrency, and the dependency advisories that must
not be auto-fixed.

**Read the one section you are about to touch — not the file.** It is ~10,600
words of post-mortem, and it used to sit here, loaded in full at the start of
every session before any work began. That cost a large share of every context
window to deliver, on most turns, nothing relevant; and it made the ~1,450 words
of actual rules above harder to find, which is a failure mode this project has
already paid for at least once — a session read the legacy `frontend/` tree's
conventions as binding for the shipping app, which the archive itself warned
against.

That section is now gone, with the tree, on 2026-09-09: keeping a description of
a dead codebase was the *mechanism* of that mistake rather than a defence
against it. Everything that remains is still true and still worth reading. It is
a reference, not a preamble.

**A comment citing `CLAUDE.md` for a subsystem rule means
`docs/subsystems.md`.** Roughly fifteen comments and test docstrings across the
repository — `tools/`, `backend/`, `mobile/src/`, `.github/workflows/` — cite
this file for rules that moved on 2026-09-06. They were deliberately not
rewritten: touching fifteen files to fix a pointer is how a documentation change
becomes a diff nobody reviews.

**When you learn something the hard way, it goes in `docs/subsystems.md`** —
under the subsystem it belongs to. A rule belongs *here* only if it changes what
a session does before it knows which subsystem it is touching.

# InTempo Edit Log

Newest entries at the top. Format spec: see "Build-time activity logging"
in intempo-combined.md. Every meaningful change goes here — see that
section for what counts as "meaningful."

---

## 2026-08-18 06:45 — Stuck analyses recover while the server is up

**Branch:** `main`. Owner: `/loop improve the app as much as you can` — eighth
iteration. Backend again.

`sweep_stuck_analyses` ran **only in the startup lifespan**. That recovers
exactly one class of failure: the crash you restart after. It does nothing for a
server that stays up — a worker thread killed by the OOM reaper, an `_update` to
`done` that fails, a task that simply never returns — and those rows then sit in
`processing` until the next deploy, which on a stable deployment could be weeks.

The musician's side of that: the record screen polls until the analysis reaches
a finished state, and `processing` is not one. They get no verdict and no error,
for as long as the server stays healthy. A stable deployment made it *worse*.

`_sweep_periodically` now runs for the life of the app, every
`SWEEP_INTERVAL_SECONDS` (5 minutes — half of `STUCK_AFTER`, so nothing waits
more than about fifteen minutes for an answer it is never going to get).

Three details that matter more than the loop:

- **`asyncio.to_thread`.** The sweep is a synchronous Supabase call; running it
  on the event loop would stall every request for its duration.
- **`sweep_once` contains its own failure.** A transient Supabase error must
  cost one sweep, not every sweep for the lifetime of the process — an
  unguarded `await` in a `while True` ends the loop permanently and silently.
- **The task is cancelled on shutdown.** Without it the loop outlives the app
  under a reloader, and each restart leaves another one sweeping.

**Tests:** backend 226 → **230**. The sweep marks only rows past the window and
sets the status the client actually treats as finished; `sweep_once` returns 0
on failure rather than propagating; and the loop **runs more than once** and
stops when cancelled — asserted on a call count, since "it swept" is the one
thing a startup-only sweep also does. Driven with `asyncio.run` rather than
adding an async test plugin for one loop-shaped test.

Also smoke-tested rather than assumed: the server starts, serves, and shuts down
with **no "Task was destroyed but it is pending"** warning, which is what a
failed cancel looks like.

**Rollback:** revert this commit.

## 2026-08-18 06:05 — Writes provision their own user row

**Branch:** `main`. Owner: `/loop improve the app as much as you can` — seventh
iteration. Backend this time.

Supabase Auth and `public.users` are separate tables, and the row in the second
was created on first touch of `/v1/me`. `scores.user_id` and `analyses.user_id`
are foreign keys onto it — so **a create landing before `/v1/me` failed on
`scores_user_id_fkey`** with a 500 that says nothing useful.

The client was asked to prevent this. `useMe`'s docstring said *"keep it the
first authenticated request after sign-in"*, and `TodayScreen` fires five
queries in parallel — so the client was politely asked to win a race it had no
way to control. EDIT_LOG already records the 500 that resulted, which is how the
audit found it.

**The invariant belongs where the constraint is.** New
`current_user_id_provisioned` dependency, used by the three endpoints that
insert a row referencing `users(id)`: `POST /v1/scores`, `POST /v1/analyses`,
`POST /v1/analyses/{id}/corrections`. Reads keep plain `current_user_id` — they
tolerate a missing row and should not pay for a write on every request.

**An upsert, not select-then-insert.** Two requests arriving together would both
see no row and both insert, and the second would fail on the primary key —
which is precisely the concurrency a client firing several queries at once
produces. `ON CONFLICT DO NOTHING` is one round trip with no such window. It
deliberately does not update the email of an existing row: this runs on every
write, and `/v1/me` is where the profile is actually reconciled.

A token with no `email` claim gets an obviously-fake `@unknown.invalid`
placeholder rather than a 500, since the column is NOT NULL and `/v1/me`
corrects it on the next read.

Both client docstrings that asked callers to uphold the old ordering are
rewritten — a rule nobody needs to follow is worse than no rule, because
someone will follow it.

**Tests:** backend 222 → **226**. Four new: the upsert is an upsert with
`on_conflict`/`ignore_duplicates` and not an insert; a missing email claim does
not 500; `POST /v1/scores` provisions before it runs; and **reads do not
provision**, which is the half most likely to rot silently. `tsc --noEmit`
clean.

The 23 tests that failed first time were the fixture's fault, not the code's:
they patch `get_service_client` on the *router* module, and the new dependency
lives in `auth`, so provisioning reached for a real client and tried to open a
network connection. An autouse fixture in `conftest` neutralises it, and
`test_provisioning.py` overrides that where the call is the thing being
observed.

**Rollback:** revert this commit.

## 2026-08-18 05:20 — Screens stop blaming the connection, and the app can't hang

**Branch:** `main`. Owner: `/loop improve the app as much as you can` — sixth
iteration.

### The message existed; nothing showed it

Two iterations ago `apiFetch` learned to say *"Your session has ended. Sign in
again."* Five screens then threw it away and substituted their own hardcoded
line — **"Check your connection and try again"** — for every failure there is.
So the fix was half a fix: the app produced the right sentence and rendered the
wrong one. A musician whose session expired was told to check their wifi, and
so was one whose server had returned a 500.

`describeLoadError` now maps the failure to something true and actionable: the
session ending, a 403, a 404, a 5xx that says *"this is not something you did"*,
and connection as the default. That default is deliberate rather than lazy —
`fetch` rejects with a bare `TypeError` for a dropped connection, a DNS failure
and a CORS refusal alike, so anything that isn't a recognisable `ApiError`
genuinely is "something between here and the server".

`VerdictScreen` was left alone: its copy already covers the case where there is
simply no take, which is not an error, and rewriting it would have made that
wrong.

### A 401 shouldn't be an error message at all

`apiFetch` now signs out when there is no usable token, not just when the server
rejects one. A refresh that failed past recovery leaves a stored session that
cannot work while `onAuthStateChange` may never fire — so the app sat on a
screen showing an error about a session the gate still believed in. Clearing it
returns the musician to sign-in, which is the only thing that actually helps,
and is what "sign in again" was asking them to do by hand.

### The blank-screen hang

`RootNavigator` renders a bare ivory rectangle while auth is `loading`, and
`getSession()` had no timeout — a wedged storage read turned the whole app into
a blank screen with nothing to tap. `SESSION_TIMEOUT_MS` (8s) resolves a stuck
load to `signedOut`, on the same reasoning as `FONT_TIMEOUT_MS` in `App.tsx`:
signing in again is a recoverable annoyance, a blank screen is an outage. It
only ever resolves a *stuck* load, and never overrides `recovering`.

### Making it testable

The stub gained failure injection — `GET /__fail?status=500` makes every
subsequent `/v1/*` answer with that status. Without it there was no way to see
what a screen says when the server is broken, which is exactly the copy most
likely to be wrong and least likely to be exercised.

**Tests:** `tsc --noEmit` and both builds clean. New `verify-errors` suite, 6
checks against a live-ish build: a 500 produces "The server had a problem" and
**not** "Check your connection", and a 401 returns to the sign-in screen rather
than sitting on a broken one. All eight fixture suites re-run: green.

The suite's own "no runtime errors" check failed first time, counting the 500s
it had just injected on purpose; it now ignores exactly the statuses it asked
for.

**Rollback:** revert this commit.

## 2026-08-18 04:35 — Magic-link sign-in

**Branch:** `main`. Owner: `/loop improve the app as much as you can` — fifth
iteration.

The spec asks for "Auth (email + magic link)" and lists *"magic-link login works
end-to-end"* in a Definition of Done. The legacy web frontend had it; the mobile
app never did. It was **unbuildable until the previous iteration** — a link that
signs you in is worthless if it lands on a Supabase page, so this waited on the
redirect work rather than being an oversight.

`sendSignInLink` is now most of it: `signInWithOtp` with the same
`authRedirectUrl()` the reset uses. Following the link fires `SIGNED_IN`,
`useAuthStatus` hears it, and the app replaces the screen — no new state, unlike
recovery, because signing in is exactly what a session already means.

**`shouldCreateUser` stays at its default of true**, so an unknown address gets
an account. The alternative is worse than it looks: with it false, Supabase
errors for an address it doesn't know, and that error is an account-enumeration
oracle a stranger could walk. The cost is a typo'd address creating a stray
account nobody confirms — the trade every passwordless product makes.

`AuthMode` gains `magicLink`, and the "does this mode take a password" test
moved out of `AuthScreen` into `needsPassword()` beside the mode itself, since
two modes now answer no and the screen was deciding it inline.

**Composition:** "Email me a link" sits beside "Forgot your password?" under the
sign-in form — the two things you can ask for from that form, on one line. Both
link modes then offer "Use a password instead", which they needed and the reset
mode never had: it was reachable only from sign-in and its only exit was the
account switcher at the foot, which says the wrong thing.

**Tests:** `tsc --noEmit` and both builds clean. New `verify-magiclink` suite,
14 checks: the affordance is on the sign-in form and the reset one survives
beside it, the magic-link form shows **zero password inputs**, an empty and a
malformed address are both refused *before anything is sent* (asserted on the
request count, not just the message), the real send is observed as
`POST /auth/v1/otp`, the sent screen doesn't offer the confirmation-only
"Send it again", and following a `type=magiclink` fragment reaches the app
rather than the set-password screen. All eight fixture suites re-run: green.

**Not verified:** the native deep link, same as last iteration — `intempo://`
needs a device.

## 2026-08-18 03:50 — The password-reset link now goes somewhere

**Branch:** `main`. Owner: `/loop improve the app as much as you can` — fourth
iteration.

"Forgot your password?" sent a mail saying *"a link to set a new password is on
its way"*, and following that link could not set a password. It landed on the
project's Site URL — a Supabase page — because no `redirectTo` was ever given,
and nothing in the app could have handled the return if it had.

### The one line at the root of it

```ts
// No URL to parse from in a native app.
detectSessionInUrl: false,
```

True of native, and wrong about the platform this build is served on. Supabase
returns from a reset with the tokens in the URL fragment; with detection off
they sat there unread, no session was established, and `PASSWORD_RECOVERY` never
fired. It is now `Platform.OS === 'web'` — the original reasoning survives,
scoped to the platform it was actually about.

### The rest of the chain

- **`lib/authRedirect.ts`** — where a link should come back to. The web origin
  the app is being served from, so a preview build's mail doesn't send people to
  production; `Linking.createURL('/')` on native, which is `intempo://` from a
  standalone build and `exp://` in Expo Go.
- **`scheme: "intempo"`** in `app.json`, so native has a scheme to come back
  through at all. `expo-linking` added as a direct dependency.
- **`redirectTo`/`emailRedirectTo`** on all four mails: reset, sign-up,
  resent confirmation, and email change.
- **`recovering` is a new auth state.** A reset link establishes a real session,
  so the naive reading is "signed in" — which drops someone who came to set a
  password into Today with the thing they clicked for unfinished.
  `RootNavigator` holds it outside the tabs, like the sign-in gate, because it
  is the same kind of thing: the app is not reachable until it is dealt with.
- **`SetPasswordScreen`** — and deliberately **no current-password field**,
  unlike `ChangePasswordScreen`. That screen asks for the old password because
  it is reachable from an unlocked phone on a music stand. Here the proof is the
  link, which went to the address on the account; and asking would be absurd,
  since not knowing it is why they are here. "Cancel" signs out rather than
  letting an emailed link quietly become a session.

Two races closed while wiring it: `getSession()` resolving *after*
`PASSWORD_RECOVERY` would have downgraded the state to plain "signed in", and a
token refresh arriving while the screen is open would have dismissed it
mid-typing. Both now refuse to leave `recovering` except on `USER_UPDATED`,
which is exactly the event the password change emits.

**One thing the Supabase dashboard still needs:** whatever `authRedirectUrl()`
returns has to be listed under **Redirect URLs**, or Supabase ignores it and
silently falls back to the Site URL — which looks precisely like this feature
not working.

**Tests:** `tsc --noEmit` and both builds clean. New `verify-recovery` suite, 10
checks driving a genuine Supabase-shaped recovery redirect — tokens in the
fragment, `type=recovery`: a plain visit still gates on sign-in, the link opens
"Set a new password" rather than the app, no current-password field, a weak
password is refused *with its reason*, a mismatch is refused, the update is
really sent (`PUT /auth/v1/user` observed), and the app is reached afterwards
with the screen gone. All eight earlier suites re-run: green.

Two of my own checks were wrong before they were right. `page.goto` to a URL
differing only in the fragment is a *same-document* navigation, so the app never
reloaded and never re-parsed — the product was fine and the harness was lying; a
real emailed link redirects through Supabase's domain first, which `reload()`
reproduces. And the weak-password assertion was `/\w/`, which would have passed
on any screen at all; it now asserts the actual sentence
("Passwords need at least 6 characters").

**Not verified:** the native deep link. `intempo://` needs a device or a
simulator, and nothing here can open one.

## 2026-08-18 03:05 — `progress` is gone, and "Continue practice" works again

**Branch:** `main`. Owner: `/loop improve the app as much as you can` — third
iteration.

### The bug

`PieceDetailScreen` decided its button label with `progress !== null &&
progress > 0`. `progress` has no backing column anywhere in the schema and
`sources/api.ts` maps it to null — so **against the live API every piece read
"Start practice" forever**, including one recorded fifty times. It only ever
looked right because the fixtures hand-wrote values like `0.62`.

It now reads `lastPracticedAt !== null`: the piece has been recorded against,
which is the question the button is actually asking, and it comes from
`/v1/analyses` on both sides of the seam.

`started` and `hasHistory` had become the same expression, so they collapsed
into one `played` — one fact answering both questions rather than two names for
it.

### The field

Removed entirely — type, both sources, the fixtures, `formatProgressPercent`,
and the `ProgressBar` primitive it was the last caller of.

This is a decision already made, applied to the last place that hadn't caught
up. Today's `PracticeCard` dropped its bar and percentage earlier in the
project, with the note that they "rendered `piece.progress`, which
`sources/api.ts` maps to null with the note that there is no progress concept
anywhere in the schema — so they were fixture-only ornament". Every word of
that applied here too; the piece screen was simply the last one still drawing
it, showing "81%" through a Wohlfahrt study the app has never measured.

What remains on the card is true: the page, when you last played it, and the
action. A recorded piece keeps its "Practiced 2 weeks ago" line.

**If a real measure of progress ever arrives** — the trend across a piece's
recent takes is computable from data the app already has — this is a small
component to write back. What was removed was the *fiction*, not the idea.

**Tests:** `tsc --noEmit` and `build:web` clean. New `verify-progress` suite, 7
checks: a recorded piece says "Continue practice", a never-recorded one says
"Start practice", no percentage appears anywhere on the screen, **no
`progressbar` element exists in the DOM**, and the real practice line survives.
All seven earlier suites re-run: green.

**Rollback:** revert this commit; `ProgressBar.tsx` comes back with it.

## 2026-08-18 02:20 — Import score, the last unbuilt route in

**Branch:** `main`. Owner: `/loop improve the app as much as you can` — second
iteration.

All three ways into the library are real now: photograph it, import it, or type
it in.

`expo-image-picker`, with its photo permission declared in `app.json`. The
screen itself is small on purpose — **picked pages go into the same
`captureSession` the scanner fills**, so the page list, the upload, the naming
step and OCR are the flow that already exists and is already tested. Only the
source of the images differs, and that is the whole feature.

**A button rather than opening the picker on arrival.** On web the picker is a
file input and a browser opens one only inside a user gesture; an effect on
mount is silently ignored. So the tap has to be a real tap — which is also the
better screen, since it says what is about to happen before the system sheet
takes over.

**No permission asked up front.** `launchImageLibraryAsync` asks for what it
needs when it needs it, and picking a specific file grants access to that file
alone. Requesting the whole library on arrival would ask for more than this
screen uses.

Importing calls `captureSession.reset()` first, exactly as opening the scanner
does: importing starts a new piece rather than adding to whatever was
photographed earlier. Cropping is off — a page of music cropped to a square is a
page of music with its music cut off.

`AddPieceScreen` is now just the fork between the two non-camera routes; it used
to carry the "not built yet" placeholder in its own body, which is why it still
owns the route rather than each screen owning one.

**Tests:** `tsc --noEmit` and `build:web` clean. New `verify-import` suite, 8
checks driving the real file chooser: the screen is real rather than a
placeholder, it discloses the one-page limit, the chooser opens and **accepts
multiple files**, two chosen fixtures arrive in the review list as blob-backed
images rather than bundled assets, and Continue lands in the same transcribe
step scanning uses. All six earlier suites re-run: green.

**Known limits, both already on screen:** only the first page is transcribed,
because `POST /v1/scores` takes one `image_url`; and PDFs are not accepted —
the picker is images only, since nothing downstream can rasterise a page.

**Rollback:** revert this commit. `expo-image-picker` and its `app.json` entry
come with it.

## 2026-08-18 01:40 — The camera is real

**Branch:** `main`. Owner: `/loop improve the app as much as you can` — first
iteration, taking the top item off the open list.

The scanner rendered one of four bundled repo images in the viewfinder and
appended **that same image** on the shutter. So every scan produced stock pages
whatever the phone was pointed at — and since last night's work put a real
upload and real OCR behind it, the pipeline was faithfully transcribing a
fixture and filing it under a title the musician had chosen.

`expo-camera` (a direct dependency, with its permission string declared in
`app.json`) replaces it. `ViewfinderPage` keeps its frame and corner brackets
and now wraps a live `CameraView`; the chrome the owner approved is untouched.
Permission is requested on arrival rather than behind a button — the screen is a
viewfinder and cannot show one without it — and `canAskAgain: false` skips the
ask, because the system dialog will never appear again.

**Nothing falls back to a fake page.** No camera, or a refused permission, gets
a plain explanation and the routes that still work. Three distinct messages, not
one: "starting", "needs your camera", and "turn it on in settings" are different
situations, and lumping them together leaves someone tapping a dead shutter with
no idea whether to change a setting or give up and type the piece in.
Substituting a stock image for the page someone believes they just photographed
would flow through OCR into their library under a title they chose — the worst
thing this screen could do.

**"Retake" became real too.** It used to swap in a different bundled image —
visible motion standing in for a photograph. It now drops the page and returns
to the viewfinder, via `goBack` rather than `navigate`, because the scanner is
still mounted underneath and remounting would fire its `captureSession.reset()`
and discard every other page.

### The mirrored preview, measured rather than assumed

The web preview shows the feed mirrored. `mirror={false}` looked like the fix
and **is a no-op**: `ExpoCamera.web.js` applies `scaleX(-1)` on
`native.type === front` alone and ignores the prop, so a machine whose only
camera is user-facing mirrors whatever `facing` says. The prop was removed
rather than left in place implying it did something.

A pixel comparison settled what actually matters: sampling luminance either side
of centre, the preview and the captured file come back on **opposite** sides —
the file is the unmirrored stream. So OCR reads a true page and only the picture
you frame against is reversed. Countering the flip here was rejected: nothing in
the props says whether it was applied, so the counter would mirror a real back
camera on a phone browser — trading a confusing preview on a laptop for a wrong
one on the target device.

**Tests:** `tsc --noEmit` and `build:web` clean. New `verify-camera` suite, 8
checks across two browser contexts: a live 640x480 `MediaStream` playing in the
viewfinder, no bundled fixture anywhere in it, the shutter producing real
blob-backed image data, the page count following, the captures reaching review —
and, with permission withheld, an explanation on screen and **still no stock
page**. All five earlier fixture suites re-run: green.

**Still not verified on a device.** Torch, focus, resolution and the native
permission dialog are all untested — a synthetic 640x480 stream in headless
Chromium is not a phone camera. The web preview is also not the product: it is
where this could be driven, not where it will be used.

**Rollback:** revert this commit. `expo-camera` and the `app.json` plugin entry
come with it.

## 2026-08-18 00:55 — Staff lines run to a common right margin

**Branch:** `main`. Owner approved the fix flagged in the entry below.

A short final system drew a stub staff: the 3-bar score put its closing whole
note on a stave a fifth of the column wide, which reads as a rendering failure
rather than as a line of music ending. Justification could not fix it —
`MAX_JUSTIFY_STRETCH` deliberately refuses to spread one note across a page, and
it is right to refuse.

So `engrave` squares off the **paper** and leaves the **music** alone. Every
system's staff lines now reach the same right margin; notes keep the positions
they were given, and the closing barline stays where the music actually stops,
with the staff carrying on past it — the way pre-printed manuscript paper does
under a written-out exercise. Moving the barline to the margin instead would
invent an empty bar.

Only when there is a column to square off against. Without `maxWidth` there is
no margin to reach, so **Today's warmup preview is untouched**: it passes
`maxNotes` and no `maxWidth`, and must keep its natural width because it is
clipped on purpose.

This is in the engraver, so it reaches the warmup page too — both its systems
are now flush, where the second used to stop short after the closing D.

**Tests:** `tsc --noEmit` and `build:web` clean. New `verify-flush` suite, 5
checks, measured off the rendered SVG rather than eyeballed: every staff line on
the score screen shares one right edge (350px), that edge equals the drawing
width, the warmup is flush too, and the Today preview still reports its natural
259px against a 390px column. All four earlier fixture suites re-run: green.

One assertion was wrong before it was right — I had asserted the Today preview
*overruns* its column. It does not: `maxNotes` caps it well short. The code was
never involved, since the flush change cannot reach a caller that passes no
`maxWidth`; the check now asserts what actually matters, that the preview keeps
a natural width rather than the column's.

**Rollback:** revert this commit; the `flush` mapping is four lines in
`engrave`.

## 2026-08-18 00:30 — Note names off the score screen; the card earns its box

**Branch:** `main`. Owner: *"Remove the note names and fix the piece card."*
Both were items I had flagged for their decision.

### The engraving no longer labels every note

`Stave` gains `showNoteNames`, default **on** — the warmup keeps them, because
that screen is an exercise for a student and the letters teach. `PieceScoreScreen`
turns them off: a letter under every note on repertoire reads as a beginner's
crib.

**Removing them incurred a debt, and it is paid.** `engrave.ts` draws no clef by
deliberate choice, and its own docstring said the note names were carrying the
information a clef would. Take the names away and the same notehead is a
different pitch to a violist than to a violinist — so the score screen now
states it in text: **“Treble clef · 4/4 · 92 BPM”**, which is what a printed
part carries in its top-left corner and belongs on a screen for reading music
anyway. Fifteen labels became one line of real metadata.

`EngraveOptions.nameRow` threads through to `layoutSystem`, so the layout stops
*reserving* the row's height as well as not drawing it — otherwise every system
would have kept a band of empty space beneath it. Measured on the rendered SVG:
15px of slack below the lowest ink, against a 175px drawing.

### The card now depends on having something to group

A card groups the piece's state — its page, how far in you are, when you last
played it — with the action that continues it. On a piece with none of that,
those three had been hidden one by one until the card held a single button: a
box drawn around nothing (§3 laws 3 and 10).

The box is now conditional on `hasState`. With state, the card as before; without
it, the action sits on the page, where it reads as the one thing to do next. A
photographed-but-never-recorded piece still gets a card, because the page crop
*is* state worth grouping with the action — verified, not assumed.

**Tests:** `tsc --noEmit` and `build:web` clean. New `verify-fixes` suite, 10
checks: the clef and time signature are in text, **zero** SVG text nodes remain
in the engraving, no reserved band, a practised piece keeps its card content, an
unpractised one shows no stray percentages, and a hand-entered piece has **no
card-like surface at all**. The three earlier fixture suites re-run: green.

One check failed before it was right, and the reason is worth recording because
it has now caught me three times: it found 8 note names reading
`D,E,F♯,G,A,B,C♯,D` — the D-major *warmup*, not the piece. React Navigation
keeps Today mounted behind a pushed screen, so `querySelectorAll('svg')` picked
its stave. The `height: 0` in the same result was the tell. Both SVG checks now
filter on `aria-hidden` and a non-zero height.

**The short final system** — flagged here first, then approved and fixed in the
entry above. See *Staff lines run to a common right margin*.

**Rollback:** revert this commit. `showNoteNames` defaults to the old behaviour,
so reverting the screen alone restores the previous look.

## 2026-08-17 23:40 — The scan flow is real, and testable on a laptop

**Branch:** `main`. Owner: *"build the scan flow and help me set up the backend keys"*.

### The flow now sends bytes

Every step existed and none of them did anything. `TranscribeScreen` was a
`setTimeout` advancing a bar at 900ms a page; `TranscriptionReviewScreen`'s
"detected" title and composer came from `buildDraft`, a fixture keyed on nothing
but the page count; and "Save piece" navigated to `fixture-wohlfahrt-28`, so
every scan in the app's history "saved" as the same Wohlfahrt study.

- **`lib/scan/uploadPage.ts`** (new) — page → signed upload URL → PUT bytes.
- **`TranscribeScreen`** — the real upload, with real failure states.
- **`TranscriptionReviewScreen`** — rewritten: names the piece and creates it.
- **`hooks/useScan.ts`** (new) — `POST /v1/scores`, which is where OCR runs.

**Naming comes before transcription, and that is not a compromise.** OCR reads
notes: `score_json` has no title or composer field, because a photograph of an
inner page usually shows neither. So there was nothing for the old "detected
details" step to detect and its editable values were invented. The title is the
musician's to give, and `POST /v1/scores` requires it before it will run OCR at
all. The photograph stays on screen while they type — the title is usually
printed on the page they are looking at — and the transcription is checked
afterwards on the piece's own score screen, against a score that exists.

**Only the first page is transcribed, and the screen says so.**
`POST /v1/scores` takes one `image_url` and there is no column, table or
endpoint for a multi-page score. Later pages are not uploaded at all rather than
uploaded and discarded.

**The fixture build refuses up front** rather than trying to upload to
`http://127.0.0.1:8000` and failing with "Failed to fetch", which would read as
a bug in the app. `useTranscribePage` refuses too: there is no fixture
implementation of "read this photograph", and a fabricated transcription is the
single most misleading thing this app could produce.

### The stub API accepts writes, so all of this is verifiable here

`scripts/stub-api.py` was read-only, so nothing in `sources/api.ts` past a GET
had ever run. It now serves `POST /v1/upload/*`, `PUT` to the signed URL,
`POST/PATCH/DELETE /v1/scores` — and **enough Supabase Auth to hold a session**,
because the app is only live when it has both a project and an API host, and
that same predicate turns on the sign-in gate. Without auth the app parked on a
form that could not succeed and no live path ran.

It deliberately does *not* invent OCR output: it returns a fixed three-bar
score. A test that passes against fabricated notes proves nothing.

`POST /v1/scores` against an upload URL nothing was PUT to returns 502, matching
the real backend, so the ordering is actually enforced.

### Three bugs the browser found, two of them mine

1. **`Image.resolveAssetSource` does not exist on react-native-web.** The upload
   died on the only platform this build can be driven on. `expo-asset`'s
   `Asset.fromModule` is the supported cross-platform resolver, and is now a
   **direct** dependency rather than a transitive one, since production code
   relies on it.
2. **Back from a saved piece walked into the finished scan flow.**
   `navigation.replace` swapped out only the review screen, leaving the scanner
   and page list beneath it — and the session had just been cleared, so it was a
   dead end. Now `navigation.reset` to tabs → the new piece.
3. **The stub's CORS preflight didn't name PUT**, so the browser dropped the
   upload with "Failed to fetch" — the stub's bug wearing the app's clothes.

**Tests:** `tsc --noEmit` clean, both builds clean. New `scan-flow` suite, 18
checks, all passing against the live build: the gate appears, sign-in works, the
library comes from the API not fixtures, capture → upload → name → save, and the
observed request sequence is `POST /auth/v1/token` → `POST
/v1/upload/score-image` → `PUT /storage/…` → `POST /v1/scores`. Empty title
refused. The saved piece carries real notation and reports **3 measures** from
its own score. Library 5 → 6. The three earlier suites re-run against a fixture
build for regressions: all green, 38 checks.

**Still not real:** the camera. The viewfinder is a bundled image and the
shutter appends one of four repo fixtures — so what gets uploaded is a stock
page, not what the phone is pointed at. That needs `expo-camera` and a device;
the upload path above is what it will feed. Import score is still a placeholder.
`progress` still has no backing field. Nothing has run against Supabase —
egress here denies `*.supabase.co`.

**Rollback:** revert this commit. The stub is dev-only and touches nothing
shipped.

## 2026-08-17 22:40 — A piece's score screen; the library stops capping at 50

**Branch:** `main`. Owner: *"just keep building what you can"*.

### "Digital score" and "Original pages" now open the piece you opened

Both rows on the piece screen pushed routes that read the in-memory **scan
session** rather than the piece. So every piece in the library showed whatever
was last photographed, under the wrong name; with no scan in flight they showed
"Nothing to review"; and because `CapturedPagesScreen` has a live "Continue"
footer, you could walk from any piece forward into the transcription flow and
land on a hardcoded Wohlfahrt fixture. Found by the audit, and it was the
worst-behaved navigation left in the app.

New `PieceScore: { pieceId, view? }` route and `PieceScoreScreen`, which reads
the piece and renders its own `score_json` through the existing `Stave`
engraver, with the existing `SegmentedControl` toggling to the photograph. The
toggle appears only when both halves exist; a hand-entered piece has neither,
so the piece screen offers no rows at all and the screen says why if reached
directly.

**The engraving does not round rhythm** (`lib/notation/fromScore.ts`).
`engrave.ts` draws four values — whole, half, quarter, eighth — and no rests,
while `score_json` can hold dotted values, sixteenths, thirty-seconds and
rests. The tempting mapping is nearest-drawable: a sixteenth becomes an eighth,
a rest disappears. That would put a rhythmically wrong line of music in front
of a musician and say nothing — and rhythm is the entire subject of this app, so
a stave that misreports it is the one picture it must never draw. Undrawable
notes are **left out and counted**, and `describeOmissions()` says exactly what
was omitted and that playback uses the full score. Today's fixtures are fully
drawable, so nothing is omitted; the honesty is there for when OCR lands.

### The library stops at 50 pieces

`listPieces()` called `listScores()` at its default limit of 50 and the library
rendered exactly that with no indication there was more. `LibraryScreen` filters
the array it is handed, so piece 51 was not below the fold — it was
**unfindable by search**. `listAllScores()` now pages at the endpoint's own
ceiling of 200 until a page comes back short, with a 200-page hard stop so a
misbehaving server cannot spin it forever. Raising the limit to 200 would have
been the same bug at a higher number.

The insights adapter had the same `limit: 200` on its id → title map, where a
miss renders as "Unknown piece" — so a library past the cap would have quietly
started mislabelling its oldest pieces. Also fixed.

**Three-foot test** — `PieceScoreScreen`. First: the serif piece title. Second:
the engraved staff. Third: the Notation/Original toggle. The composer eyebrow
recedes. Correct order — the music is the subject of the screen.

**Tests:** `tsc --noEmit` and `build:web` clean. New browser suite, 10 checks,
all passing: opens the piece you came from and not the scan fixture, composer
eyebrow, no "Nothing to review", no scan-flow Continue footer, an engraving is
drawn, nothing omitted for a drawable score, toggles to the original, back
returns to the piece, and a hand-entered piece offers no score rows.
Three selectors were wrong before they were right — `SegmentedControl` exposes
`tab`, not `button`, and the tab bar is not reachable from a pushed screen
without backing out first.

**Two things left for the owner rather than decided:**

- **`Stave` labels every note with its name** (D, E, F♯ …). That is a teaching
  affordance and right for the warmup; on a screen for reading a transcribed
  piece it is clutter that implies the reader can't read music. `Stave` has no
  opt-out prop. Adding one is small — say the word.
- **A short final system looks like a fragment.** The 3-bar fixture puts its
  closing whole note alone on system 2, and `MAX_JUSTIFY_STRETCH = 1.5` caps how
  far one note will stretch, so it renders about a fifth of the width. Leaving
  the last system unjustified is correct engraving practice, so this is the
  engraver behaving as designed — it just reads oddly at three bars, and real
  scores will hit it far less.

**Still not done:** the scan → transcribe → review → save flow is still mocked
end to end (shutter appends bundled images, `TranscribeScreen` is a
`setTimeout`, "Save piece" navigates to a fixture id); `progress` has no backing
field so the bar, the percentage and "Continue practice" stay fixture-only;
import score is still a placeholder; `PracticeScreen` is still unreachable.
Nothing live was exercised — egress still denies `*.supabase.co`.

**Rollback:** revert this commit.

## 2026-08-17 21:55 — Rename and remove a piece; four correctness bugs from the audit

**Branch:** `main`. Owner: *"continue on the other stuff"*.

### You can now fix or remove a piece

`deleteScore` and `updateScore` had been sitting in `api/scores.ts` since Batch
1 with **no caller anywhere in the app**. You could add a piece and never
correct it or get rid of it — which the manual-add flow shipped an hour earlier
made much sharper, since a typed title is a title with typos in it.

`PieceSource` gains `updatePiece` and `deletePiece`, both implemented on both
sides of the seam. The UI is a `⋮` in the piece header opening the existing
`BottomSheet` with Rename / Remove: rename is the inline `Card`-of-`Input`s
`TranscriptionReviewScreen` already uses, remove goes through the existing
`ConfirmDialog`. No new component and no new visual pattern.

**The fixture refuses the same deletions the backend does.** `analyses.score_id`
is `ON DELETE RESTRICT`, so a piece that has been recorded against cannot be
removed. The fixture source checks `FIXTURE_SESSIONS` and raises the same
refusal — otherwise the sample data would be wrong about a rule that protects
practice history, and there would be no way to exercise that path without a
live database.

The refusal is *not* the backend's sentence. `"score has dependent analyses;
delete those first (soft-delete is V2)"` is right for an API consumer and three
kinds of wrong on a phone — "score" for a piece, "analyses" for recordings, and
an internal roadmap note. `PIECE_HAS_RECORDINGS` in `sources/types.ts` is the
one both sources raise.

### Four bugs from the functionality audit

The audit workflow started last session finished during this one (13 agents,
53 findings flagged both silently-wrong and buildable-now). It ran against
pre-change code, so several findings were already fixed by the 20:40 commit —
notably the piece screen's fake 24-measure playback. Four that were still live:

1. **The server could never clear a composer** — and this was a defect in code
   shipped an hour earlier, since the new rename form lets you empty that
   field. `PATCH /v1/scores` used `if body.composer is not None`, so
   `{"composer": null}` was indistinguishable from omitting it: 200 OK, old
   value still there, no error. Now reads `model_fields_set`, which asks what
   the client actually *sent*. An explicit null title is refused instead — null
   is meaningful for a composer (anonymous, traditional) and not for a title.
2. **Change-password re-authenticated as the wrong person.** It signed in with
   the address `useMe()` returned rather than the session's. On a fixture build
   that is `you@example.com` — so the moment real credentials were configured,
   which happened at 20:40, tapping "Change password" would have attempted a
   sign-in as an address the musician has never heard of. New
   `getSessionEmail()` reads the session, which is the authority on who is
   signed in; the profile row merely describes them.
3. **Signing up with an address that already has an account promised mail that
   is never sent.** With confirmations on, Supabase does not error for this —
   it returns an obfuscated user, and the only tell is an empty `identities`
   array. That read as "awaiting confirmation", so the app said "Follow the
   link and you'll be signed in" and the musician waited forever. Now a
   distinct state whose copy covers both readings without confirming the
   address is taken, since that would hand over the account-enumeration oracle
   Supabase is deliberately withholding. The heading changes too — "Check your
   email" contradicted the line under it.
4. **An expired session was reported as a network fault.** `getAccessToken()`
   returns null when a refresh fails, and `apiFetch` attached the header only
   `if (token)` — so the request went out unauthenticated, the backend said
   "Missing bearer token", and screens rendered "check your connection". Now no
   token means a 401 with "Your session has ended. Sign in again.", and a 401
   *from* the server clears the session so `onAuthStateChange` returns the app
   to the gate instead of leaving every query failing forever.

Also: `PATCH /v1/scores` returned the last unsigned response in the router, so
a rename dropped the piece's thumbnail until the next list fetch. And the
`api.ts` header docstring still claimed `/v1/analyses` was unbuilt and that
nothing signed a download URL — both false since Batch 4. Two of its four
"null" fields are live; it now says so.

**Three-foot test** — the piece screen with the new control. First: the serif
title. Second: the sheet-music banner. Third: the `⋮`, which recedes, as a
secondary action should. The sheet and dialog are existing components and did
not change.

**Tests:** backend 219 → 222 (composer cleared by explicit null; omission
leaves it alone; null title refused). `tsc --noEmit` and `build:web` clean.
Two browser suites against the built app, 28 checks, all passing: the
rename/remove suite (refusal with its reason, empty-title refused, rename
propagates to the library, unrecorded piece deletes, 7 → 6) and the
manual-add suite re-run for regressions (7 → 8).

**Not done:**

- **Import score**, still a placeholder — needs an image-picker dependency.
- **`Digital score` / `Original pages` open the wrong thing.** The audit found
  they read the in-memory *scan session*, not the piece you opened, so from any
  piece you can walk into the scan flow and land on the Wohlfahrt fixture. The
  20:40 commit hides both rows when the piece has no notes or no photograph,
  which narrows it but does not fix it. Real fix needs the scan flow to save.
- **The whole scan → transcribe → review → save flow is mocked**: the shutter
  appends bundled repo images, `TranscribeScreen` is a `setTimeout`, and "Save
  piece" navigates to a hardcoded fixture id. Nothing is uploaded.
- **The library stops at 50 pieces** and search only filters that first page.
- **`progress` has no backing field**, so the bar, the percentage and
  "Continue practice" vs "Start practice" are all fixture-only.
- Nothing live was exercised: this container's egress policy still denies
  `*.supabase.co`.

**Rollback:** revert this commit.

## 2026-08-17 20:40 — Wire the live project; add a piece by hand; stop the piece screen lying

**Branch:** `main`. Owner: *"can you make every basic functionality of the app?"*

The finding that shaped this session: **almost nothing was unbuilt — it was
unconnected.** The backend serves the whole API, the pipeline runs, its tests
pass. What was missing was a database behind it and a switch that could be
turned on without breaking the deployed site.

### The Supabase project is real now

`intempo-dev` (`<project-ref>`) restored from paused, and all four
migrations verified *after* the fact rather than trusted: 7 tables, 7 enums,
RLS on all 7, 13 policies, `users_auth_fk` present, `users.id` default dropped,
both storage buckets present and private (50 MB audio / 10 MB images).
The three `{"success":true}` responses from the first attempt were **not**
evidence — the project went to `RESTORING` immediately afterwards and two
verification queries failed with ECONNREFUSED. The counts above come from a
query run once it reported `ACTIVE_HEALTHY`.

### The fixture switch is now a fact, not a decision

`USE_FIXTURES = true` was a hardcoded constant someone had to remember to flip.
Flipping and pushing it would have broken the live Cloudflare site: the API
base URL defaults to `http://127.0.0.1:8000` and nothing hosts the backend, so
every screen would have failed against a host that exists on one laptop.

New `mobile/src/data/environment.ts` derives `IS_LIVE_BACKEND` from the
presence of all three env vars. `EXPO_PUBLIC_API_BASE_URL` is checked for
*explicit presence* rather than truthiness, precisely because of that localhost
default. `.env` is gitignored, so CI and Cloudflare keep building the fixture
app unchanged — verified by building with the file moved aside.

`useAuthStatus` now follows the same predicate instead of "are the Supabase
vars set". Those two questions differ in a state that can really occur — creds
but no API host — where the old code demanded a sign-in and then served
fixtures, a gate guarding nothing. `isAuthConfigured()` is deleted; two
predicates that agree almost always are worse than one.

### Add a piece by hand — the only route in that needs no camera

Migration `004_manual_scores.sql`: `scores.source_image_url` drops NOT NULL.
NULL rather than a sentinel string, so no reader has to know which strings are
real URLs.

`POST /v1/scores` takes either an `image_url` **or** `clef` + optional
`time_signature`/`bpm_hint`, and rejects a body carrying both — a caller
sending both has misunderstood something, and overwriting what OCR read with
what they guessed is the worse failure. `ocr_confidence` is stored NULL for a
hand-entered piece: the column asks how well OCR read the page, and for a page
never read the answer is "it didn't", not "badly".

The clef is **not** a form field — it comes from the instrument in the profile
(`lib/instrument.ts`). "Which clef is this in" is a question about a page, put
to someone describing a piece from memory.

Also fixed while in there: `POST /v1/scores` returned the one response whose
`image_url` was always null, because it skipped the signing path every other
read uses.

### The piece screen stops claiming things that aren't true

`PieceDetailScreen` reported **"Measure 1 of 24"** for every piece in the
library — `MOCK_MEASURE_COUNT`, a constant — while a `setTimeout` advanced the
number and made no sound. It now schedules the real `score_json` through the
same engine the warmup and record screens use, at the tempo this piece was last
practised at, and the readout follows the playhead (`measureAt`).

Everything on the screen is now conditional on the piece actually having it:
no notes → no transport; no photograph → no image banner and no "Original
pages" row; never recorded → no empty progress bar. A hand-entered piece hits
all four, which is how they were found.

`ListenButton` gained an optional `onProgress`, read through a ref because
`stop` runs from an unmount effect with no dependency list and would otherwise
pin the first render's copy of the prop.

**Three-foot test** — the new *Add manually* screen. First: the serif
"Add manually". Second: the ink "Add to library" block. Third: the four
labelled fields. The action reading louder than the fields is right for a form
— the fields are content and recede; nothing competes. Fields sit on the page
rather than in a card (§3 laws 3 and 10) and the submit follows the established
`TranscriptionReviewScreen` composition rather than a new one.

**Tests:** backend 216 → 219 passed (3 new: the manual path never touches OCR —
deliberately left unstubbed so a regression fails loudly; missing clef → 422;
manual fields alongside an image → 422). `tsc --noEmit` clean, `build:web`
clean, page-background guard passed. 18/18 checks in Chromium against the built
app: validation refusals, create → land on the piece → back skips the form →
library 7 → 8, a transcribed piece keeps its transport and reports **3
measures** from its score rather than 24.

Two of my own assertions were wrong first time and were fixed rather than
accepted: `goBack()` didn't land where I assumed, and a count check passed on a
non-match. A `/*` fragment in the extracted text was my harness walking the
boot-watchdog script's text node, not UI — confirmed against the screenshot.

**Not done, and why — this is the honest part:**

- **Nothing live was exercised end to end.** This container's egress policy
  denies `*.supabase.co` (403 on CONNECT). That blocks the backend's JWKS
  fetch, storage, and every client call, so sign-in → save → record → verdict
  cannot be run here at all. Not a missing key: a blocked host.
- **`SUPABASE_SERVICE_ROLE_KEY` is blank** in `backend/.env`. The management
  API exposes only publishable/anon keys. Left blank on purpose — a dummy value
  would produce Supabase 401s that look like an auth bug, whereas blank hits the
  existing "service-role client is not configured" message.
- **OCR keys are blank**, so `POST /v1/scores` with an image fails at the OCR
  step. Everything else works without them.
- **Import score** is still a placeholder; it now offers "Scan instead" rather
  than a dead end. It needs an image-picker dependency, and everything after
  the picker is the scanner's existing flow.
- **`PracticeScreen` is unreachable** — registered in `RootNavigator`, but
  nothing navigates to it, and it still runs on `MOCK_MEASURE_COUNT`. Left in
  place rather than deleted: that is a product call.
- **The piece card for a hand-entered piece is now a card containing one
  button.** Honest, but arguably §3 law 3. Removing the card is a visual
  restructure and belongs to the owner.

**Rollback:** revert this commit. The migration is separately reversible —
rows created before it all have a `source_image_url`, so the NOT NULL can be
restored once no NULLs remain.

## 2026-08-17 18:55 — Warmup moves above the fact

**Branch:** `main`. Owner: put the warmup above "Did you know".

Today now reads: **the piece you are on → the warmup → the fact → the pieces
worth a look → the last thirty days.** The two things to play sit together at
the top; the fact is the only block that asks nothing of you, and it reads
better once the playing is done.

**What changed:** `screens/today/TodayScreen.tsx` only — the two blocks swapped
and the entrance stagger renumbered to follow the order they are now read in.
No component changed.

One comment needed amending rather than moving with its block: the fact's
docblock explained the serif problem as the lead sitting "directly under a card
whose subject is a piece". That is no longer where it is. The reasoning still
holds — it now sits in the *middle* of the serif run, with the warmup above and
the two suggestions below — so the comment says that instead of a sentence that
had quietly become false.

**Tests:** `tsc --noEmit` clean, `build:web` clean. In Chromium: Start still
opens the warmup page from its new position, the tempo round-trips 72 → 68 with
Listen sounding D major at the new tempo, both suggestion rows and the summary
still reach their destinations, Library and search unaffected. No console
errors.

**Rollback:** revert this commit.

## 2026-08-17 18:30 — Why "Did you know" looked wrong, and the card's identity/state split

**Branch:** `main`. Owner: fix the card collision, and *"that did you know just
looks visually off for some reason"* — no specifics, and the "for some reason"
turned out to be the diagnostic clue.

**Nothing was misaligned.** I measured the rendered type of every run on the
screen and checked the geometry against the tokens: `SectionHeader`
marginBottom 12 → lead at 488 = 476+12; `factText` marginTop 2 → detail at 513;
section marginTop 24 → next label at 573. All exact. A fault you can feel but
not locate is usually a *meaning* error, not a measurement one.

**The cause.** On Today, `pieceTitle` (19/23 Newsreader Medium, ink) renders
five times and three of them name something you can play — the warmup and the
two suggestions. The fact's lead wore that identical style, directly under a
card whose subject is a piece: the position where the eye is most primed to
read "another piece". **Five of the twenty-four leads are outright names of
things** ("The Chaconne", "Il Cannone", "The wolf tone"), and on those days the
block was indistinguishable from a suggestion row.

**What changed:**

- `screens/today/TodayScreen.tsx` — the lead drops from `pieceTitle` to `body`
  (16/24 sans, ink). The label/lead/detail shape the owner chose is untouched;
  only the *voice* changes. Height cost 23 → 24pt; nothing reflows.
- `screens/today/PracticeCard.tsx` — the tempo goes from `metadata`/
  `textTertiary` (byte-identical to the movement) to `metadataSmall`/
  `textSecondary`. **Smaller but darker**, which is the point: the identity
  stack descends 26pt serif ink → 16pt composer → 14pt movement, each rung
  smaller *and* lighter, and the tempo was wearing rung three's exact style. A
  plain rank drop would say "less important"; breaking the ladder's direction
  says "different kind of thing". It also lands byte-identical to the verdict
  beneath it, which is the right grouping — both are practice state.
- `lib/facts.ts` — **nine leads rewritten.** Five were their sentence's own
  opening words ("The Chaconne" over "The Chaconne that ends…"), so the block
  said the same thing twice, six points apart. Four more echoed their sentence
  less obviously.
- Two stale comments corrected: the warmup block was still documented as "last
  on the screen" (it has been third of five since the 15:05 reorder), and
  `facts.ts` still claimed the fact sits "at the foot of Today" (it is second).

**Method.** Nine agents across four lenses — measure/leading, semantic
signalling, vertical rhythm, editorial — each adversarially verified. Two of
the four diagnoses were **refuted by their verifiers and dropped**: setting the
fact in `body` (which would have restored the three-line paragraph the owner
had already rejected, a regression documented in the very file being edited),
and a rhythm fix resting on the false premise that the 33pt inter-row gap is
empty — `TodayRow` draws a hairline rule at its midpoint.

**I corrected the synthesis twice rather than shipping it as written.** It
claimed nine leads are work names; the real figure is five, and I checked each.
It also implied `pieceTitle` is a musical-name token; it is the app's general
block-lead step (`EmptyState`, `ConfirmDialog`, `BottomSheet`, `InsightsScreen`
all use it), so the argument is screen-local perception, not token semantics.
The shipped comment says that.

**Tests:** `tsc --noEmit` clean, `build:web` clean. A new stutter check over
the whole corpus — flagging any lead sharing two or more content words with its
sentence's opening — **caught four echoes I had missed by eye, and one I
introduced while fixing another** ("Haydn settled it" over "was settled by
Haydn"). Now: 24 facts, 24 distinct leads, 0 stutters, none over 30 characters.
Measured after the change: lead 16/24 ink, detail 13/18 secondary, card tempo
13/18 secondary against a 14/20 tertiary movement. Library, search, the warmup
page and every destination re-verified. No console errors.

**Three-foot test:** the card, the Continue button inside it, then the two
block headings. The fact now reads as a note rather than as a fifth piece — the
serif run down the screen is pieces only.

**Honest status:** both edits are hypotheses about perception, verified as
screenshots at 393pt and not on a device. What I cannot check here: whether the
sans lead reads as lead-and-detail rather than as two paragraphs, and whether
smaller-but-darker reads as a category change rather than as an inconsistency.

**Rollback:** revert this commit.

## 2026-08-17 17:20 — "Practiced today" removed, and the fact gets a lead

**Branch:** `main`. Owner: remove "Practiced today", and the "Did you know"
block doesn't fit. Treatment chosen from three options (§2 gate): give each
fact a lead.

**Why it didn't fit, stated plainly.** Every block on Today is the same shape —
a small label, a serif lead, a grey line of detail. The fact was a label over
three lines of grey prose with no lead and nothing to act on: **the only body
copy on the screen.** It read as pasted in rather than composed.

**What changed:**

- `lib/facts.ts` — `Fact` gains a `lead`, and all 24 are written: "Sixty-eight
  quartets", "Before the endpin", "A is not always 440". Short phrases that
  name the subject, in the same programme-note register as the facts. Not
  headlines and not hooks — a fact block that shouts would be worse than one
  that doesn't fit.
- `screens/today/TodayScreen.tsx` — label, serif lead, grey detail. The detail
  drops from `body` to `metadataSmall`, which is what `TodayRow` and the warmup
  use, so the three blocks are now literally the same construction.
- `screens/today/PracticeCard.tsx` — "Practiced today" gone, and with it the
  last of the housekeeping stack. **This also half-fixes the hierarchy
  inversion I flagged yesterday:** the verdict sentence used to sit third in a
  run of three grey lines; it now sits second in a run of two. The card says
  what the piece is, what tempo it is being worked at, how the last take went,
  and stops.

**Three-foot test:** the card, the Continue button, then three identically
built blocks descending the page. Nothing on the screen is now composed
differently from everything else, which was the complaint.

**Tests:** `tsc --noEmit` clean, `build:web` clean. The corpus checked across
the rotation: **24 facts, 24 distinct leads**, none empty, none over 30
characters, none ending in punctuation, every sentence still substantial.
Library, search, the warmup page and every destination re-verified. No console
errors.

**Still not fixed, and still the owner's call:** inside the card, `I. Adagio`
and the tempo line remain set identically though one is the piece's identity
and the other is practice state.

**Rollback:** revert this commit.

## 2026-08-17 16:40 — The daily term is gone; the fact stays

**Branch:** `main`. Owner: remove the term, keep only "Did you know".

**What changed:**

- `lib/terms.ts` → `lib/facts.ts`, with the term machinery deleted:
  `Term`, `TEMPO_TERMS`, `GENERAL_TERMS`, `METRE_TERMS`, `termFromMarking` and
  `termFor`. About sixty lines of curated tempo, expression and metre
  definitions, **recoverable from the commit before this one** if the feature
  is ever wanted back — they are not lost, just not shipped.
- `screens/today/NotesBlock.tsx` — deleted. With the term gone the block was a
  single `<Text>`, and a component that renders one line of prose is ceremony.
  The fact is inlined under a `Did you know` section heading, which is the same
  shape as every other section on the screen.
- `screens/today/TodayScreen.tsx` — heading changed from "Today's term".

The section that carried a heading, a serif word, a definition, a rule and a
second heading is now a heading and a sentence. It sits better as a footnote,
which is what it always was.

**Tests:** `tsc --noEmit` clean, `build:web` clean, no stale references to the
removed module or component anywhere in `src/`. The facts corpus survived the
edit intact: **24 distinct facts across the rotation**, stable within a day and
moving overnight. Library, search, the warmup and every destination
re-verified. No console errors.

**Rollback:** revert this commit; the deleted terms come back with it.

## 2026-08-17 16:10 — The white band above the greeting

**Branch:** `main`. Owner sent a screenshot from their phone: "feel like
there's something off". No specifics, so this is what I could find and prove.

**Found and fixed: the document had no background.** `html`, `body` and `#root`
all computed to `rgba(0, 0, 0, 0)`, so anything the React tree does not cover
falls through to the browser's default white — the strip behind the status bar,
the overscroll region, and the chrome a browser tints from the page. On a
warm-ivory app that is a white band across the top of every screen, which is
exactly what the screenshot shows above "Good evening".

`ScreenContainer` paints ivory *inside* the app. Nothing was painting the page.

**What changed:**

- `mobile/public/index.html` — `background-color` on `html, body`, plus
  `theme-color` for Android and installed PWAs and
  `apple-mobile-web-app-status-bar-style: default` so an installed iOS app gets
  dark glyphs over the ivory rather than a light bar.
- `mobile/scripts/flatten-vendor-assets.mjs` — a guard. That hex is now **the
  one duplicated design token in the app**, because an HTML file cannot import
  a TypeScript module, so the build fails if it stops matching `colors.bg`.
  Drift here is invisible in a diff and obvious on a phone.

**Tests:** `tsc --noEmit` clean, `build:web` clean. Computed styles after the
fix: `html` and `body` both `rgb(247, 242, 233)`, `theme-color` `#F7F2E9`.
The guard was checked in both directions — `colors.bg` edited to a different
value fails the build with `found 0 of 2` and exit 1; restored, it passes. It
also runs on the re-export path where there is nothing to flatten, which was a
bug in my first version of it: the script returned early and the guard silently
stopped guarding. Library, search, warmup and every destination re-verified.
No console errors.

**Not fixed, because it is a design call and not mine to make:** inside the
practice card, "I. Adagio" and "Working at 114 · marked 92" are set in
*identical* styles though one is the piece's identity and the other is practice
state; and the pipeline's verdict — the sentence this whole app exists to
produce — is the **smallest text on the card**, sitting under two lines of
housekeeping. That is a hierarchy inversion and my best guess at the rest of
"something off". Raised with the owner rather than changed.

**Rollback:** revert this commit.

## 2026-08-17 15:05 — Today's two list blocks move to the foot of the screen

**Branch:** `main`. Owner: "Also worth a look" and "Last 30 days" belong at the
very bottom.

Today now reads: **the piece you are on → today's term → the warmup → the
pieces worth a look → the last thirty days.** Today's work first, then the two
blocks you read rather than act on. Both of those are doors to other screens —
a piece, and the Insights tab — so they belong at the foot of this one rather
than between the card and the things you do today.

**What changed:** `screens/today/TodayScreen.tsx` only — the two sections moved
below the warmup and the entrance stagger renumbered to follow the order they
are now read in. No component changed.

**Three-foot test:** the practice card, the Continue button inside it, then the
warmup's notation. Unchanged at the top, which is the part the owner said was
already right.

**Tests:** `tsc --noEmit` clean, `build:web` clean. In Chromium: both moved
blocks still reach their destinations from the bottom of the screen — the two
suggestions to their pieces, the summary to the Insights tab — and Start still
opens the warmup page with the tempo round-tripping 72 → 68. Library and search
unaffected. No console errors.

**Rollback:** revert this commit.

## 2026-08-17 14:35 — The warmup drops to the foot of Today, and loses the ink band

**Branch:** `main`. Owner: the stacking hierarchy on Today isn't there, the top
is fine but the warmup section takes away from it — move it down so the term
and fact come first, and drop the black for the page background with a preview
and a Start button, the way the first iteration looked.

**They were right about the band.** An inverted full-bleed surface directly
under the practice card was not "a second visual event" so much as **a second
focal point competing with the first** — §3 law 4 says two competing focal
points means the hierarchy is wrong, and I logged that tension as an accepted
trade-off two commits ago rather than treating it as the defect it was. The
order compounded it: the one optional thing on the screen was interrupting the
run of blocks about the musician's own repertoire.

**What changed:**

- `screens/today/WarmupPanel.tsx` — the band is gone. Name, focus, the same
  engraved preview on the page background, and a compact ink **Start** on the
  meta row where the first iteration had Listen.
- `screens/today/TodayScreen.tsx` — the warmup moves to last, after the term
  and fact. The screen now reads as a descent: the piece you are working, the
  pieces worth a look, the month, a term, then the warmup.

A side effect worth having: the notation is ink-on-light in both places now, so
tapping Start no longer inverts the music on the way through. The page lifts it
onto a plate, which is a change of paper rather than a change of ink.

**Three-foot test:** the practice card, the Continue button inside it, then the
run of section headings. Nothing below the card competes with it, which is the
first time that has been true since the panel went in.

**Tests:** `tsc --noEmit` clean, `build:web` clean. In Chromium: Start still
reaches the warmup page from its new position at the foot of the screen, the
tempo stepper moved 72 → 68 and Listen sounded D major at the new tempo, and
Today reported the remembered 68. Library, search, suggestions and every
destination re-verified. No console errors.

**Honest status:** verified in the web build against fixtures. **Still not
done:** `PieceDetail` renders a progress bar for a field the backend cannot
supply. **Rollback:** revert this commit.

## 2026-08-17 13:40 — The warmup wraps, and the page stops reading like a web page

**Branch:** `main`. Owner: show the whole warmup by wrapping rather than making
people swipe sideways, leave room for the tempo and text underneath, and
*"remember it's a mobile app so it should not have that style like a website"*.
Structure was put to them as options (§2 gate): **light plate + control bar**,
and **tighten Today's sections too**.

**What was reading as web:** the Warmup page was a left-aligned text column
under a lone back chevron, with its one control — a small centred stepper —
floating mid-page above 500pt of dead ivory. Today's blocks sat 32pt apart,
which reads as separate pages of a document rather than one screen.

**What changed:**

- `lib/notation/engrave.ts` — **rewritten to lay out multiple systems.** Bars
  are packed onto lines and stacked; a bar is never split across a wrap,
  because these are counting exercises and a bar read across a fold is a bar
  miscounted. Adds **justification** — each system stretches to fill the width,
  capped at 1.5× so a short final line doesn't spread four notes across the
  page. Note names are laid out per system rather than by the component.
- `components/notation/Stave.tsx` — draws systems, and gains `scale` and
  `justify`. Names are now SVG text so they travel with their system; a row of
  absolutely positioned labels worked for one stave and would have needed a
  second layout pass for four.
- `screens/warmup/WarmupScreen.tsx` — rebuilt. A nav row rather than a page
  header; the exercise name as content; a **full-bleed ruled plate on
  `surface`** that takes whatever height is left, so a short warmup fills the
  screen with paper instead of leaving a band above the controls; and a
  **control bar** holding the tempo and Listen. Notation draws at 1.25×.
- `components/primitives/ScreenContainer.tsx` — `footerTone="surface"`, so a
  footer that is a control area you work in reads differently from a footer
  that holds a single action.
- `screens/today/*` — sections 32 → 24pt apart, the panel tighter still at
  20pt, and `TodayRow` grown to a 60pt list row rather than a paragraph with a
  chevron.

**Three-foot test (Warmup):** the music, then the tempo, then Listen. The
notation is now unambiguously the subject of the screen, which it was not when
it sat as a strip between two paragraphs.

**Tests:** `tsc --noEmit` clean, `build:web` clean. The engraver's suite was
rewritten for the new API — 40 assertions, all pass: staff positions on all
four clefs unchanged, **bars never split across a wrap**, systems stack without
overlapping, the box covers the last system, justification widens a system to
exactly the target width and never past it, a short final system is not
over-stretched, beams still break at barlines and across a wrap, ledger counts
and stem sides unchanged. In Chromium: the warmup renders as two justified
systems with the whole exercise visible and no horizontal scroll; the tempo
stepper moved 72 → 68 and Listen sounded D major at the new tempo; the Today
panel reported the remembered 68. Library, search, suggestions and every
destination re-verified. No console errors.

**Honest status:** verified in the web build against fixtures. Unproven on a
device: whether 1.25× notation is readable from a music stand, and whether the
plate/control-bar split holds on a short screen like an SE. **Still not done:**
`PieceDetail` renders a progress bar for a field the backend cannot supply.

**Rollback:** revert this commit. The engraver rewrite is the only part that is
not additive; its old single-system behaviour is what you get by omitting
`maxWidth`.

## 2026-08-17 12:05 — Warmup becomes a page, and Today gets an ink panel

**Branch:** `main`. Owner: call it the warmup, make it a page you open with a
name and a Start button on Today, and *"the today looks kind of bland right
now"*. The visual treatment was put to them as three options (§2 gate); they
chose the ink panel.

**What changed:**

- **Renamed throughout.** `lib/excerpt.ts` → `lib/warmup.ts`, `Excerpt` →
  `Warmup`, `excerptFor`/`excerptScore` → `warmupFor`/`warmupScore`. In
  `engrave.ts`, `ExcerptNote` → `StaveNote` — it is a notation input, not a
  product noun, and naming it after the one feature that uses it was already
  wrong. Code vocabulary now matches the product's.
- `screens/warmup/WarmupScreen.tsx` — new, pushed on the root stack. Full-size
  notation, the focus line, a tempo stepper and Listen. A page because working
  from notation needs it readable from a stand and the tempo is something you
  set once and play against; neither fits under a two-line preview.
- `screens/today/WarmupPanel.tsx` — new. A **full-bleed ink band**, the only
  dark surface on Today: label, name, focus, the first bars engraved in cream,
  and Start. No new colours — `actionBg`/`actionText`/`onDarkMuted` already
  exist as the palette for full-bleed dark surfaces and the camera scanner uses
  the same three. **The notation is the only ornament, and it is real:** the
  actual opening bars of the actual warmup, not a decorative flourish.
- `components/notation/Stave.tsx` — a `tone` prop so one engraver serves both
  grounds, and `maxNotes`, which truncates **at a barline** where it can. A
  preview ending mid-bar reads as a rendering failure rather than an extract.
- `components/primitives/PrimaryButton.tsx` — a `tone="light"` variant: cream
  fill, ink label, for a button on a dark ground. The same button seen against
  the opposite surface, from the same token pair.
- `components/practice/TempoStepper.tsx` — **extracted** from the Record
  screen, which now uses it. Two steppers that disagree about their step size
  or their limits is the sort of drift nobody notices until a musician does.
- Route `Warmup` added; `ExcerptBlock` deleted.

**Why the panel fixes "bland".** Today ran card → type → more type, with one
visual event in the whole screen. The inverted band gives it a second, and it
earns its place by carrying information rather than decoration — it also marks
the warmup as a *different kind of thing* from the piece above it.

**Three-foot test:** the practice card, then the ink panel, then the Start
button inside it. The rows below recede properly. Two focal points, but they
are sequential rather than competing — you read down the screen, and the
second one is a surface, not a rival card.

**Tests:** `tsc --noEmit` clean, `build:web` clean. Driven in Chromium against
the built bundle: the panel renders the engraving in cream and truncates at the
bar (8 notes, exactly one bar); Start opens the page; the tempo stepper moved
72 → 68 and **Listen sounded D major at the new tempo**; going back, the panel
reported 68 rather than the authored 72. The Record screen still shows "Target
tempo" and its 92 BPM after the extraction. Library, search, the suggestion
rows and every other destination re-verified. No console errors.

**One defect found and fixed:** the panel first showed `warmup.bpm` — the
tempo it was *written* at — so slowing the warmup down on the page left Today
still claiming 72. It now reads the same remembered tempo the page does, which
is keyed into `practiceTempo` by the warmup's id, so a warmup you slow down is
remembered exactly the way a piece is.

**Honest status:** verified in the web build against fixtures. Unproven on a
device: whether cream notation on ink holds up in sunlight, and whether the
band reads as a surface rather than as a very dark card at arm's length.
**Still not done:** `PieceDetail` renders a progress bar for a field the
backend cannot supply.

**Rollback:** revert this commit; the rename is mechanical and the panel,
page and stepper are additive.

---

## 2026-08-17 10:30 — A daily excerpt for your instrument, and a term with a fact

**Branch:** `main`. Owner: *"last take is basically cont practice"* — correct,
and by construction. `getCurrentPiece()` resolves the piece through the newest
analysis and `getLatestTake()` returns that same analysis, so against the real
backend the two blocks name the same piece **every time**. The fixtures had
hidden it by disagreeing with each other. Their idea for the replacement, which
is better than any of the four I offered: a term and a fact together, plus a
short excerpt for the instrument they play.

**What changed:**

- `lib/notation/engrave.ts` — new, pure. Turns pitches into staff positions,
  stems, beams, ledger lines and barlines. **Draws no clef**; `DECISIONS.md`
  has the reasoning, and the note names printed under the staff carry what a
  clef would say.
- `components/notation/Stave.tsx` — new. Renders that with `react-native-svg`.
  The sharp is drawn as four strokes rather than set as `♯`: the glyph lands on
  the system font stack and Android often has no character for it.
- `lib/excerpt.ts` — new. Three exercises per instrument, hand-authored, all in
  first position, each stating what it trains. Rotates by date so it is the
  same excerpt all day and on every device.
- `lib/terms.ts` — new. The term comes from the markings on **your own score**
  where OCR read one — tempo marking first, then time signature, then a general
  list. The fact is a 24-entry corpus rotating daily.
- `data/preferences.ts`, `data/types.ts`, `screens/profile/ProfileScreen.tsx` —
  `instrument`, with a control in the profile. Flagged as coming when the
  Listen feature landed; now it is needed.
- `screens/today/ExcerptBlock.tsx`, `NotesBlock.tsx` — new blocks.
- `screens/today/PracticeCard.tsx` — carries the last take's verdict sentence.
- `screens/today/TodayScreen.tsx` — "Last take" section removed.
- `data/sources/fixtures.ts` — **fixture bug fixed.** The current piece and the
  sample take named different pieces, which contradicts what the API adapter
  actually does and is what disguised the duplication.

**The excerpt can be heard but not recorded**, and that is deliberate: a take is
analysed against a score row in the backend, and an exercise the app authored
has no such row. A record button here would analyse against the wrong music.

**Three-foot test:** the practice card, the Continue button inside it, then the
stave. The excerpt is the second thing you see and asks for nothing, which is
right for something optional. The term and fact close the screen as a footnote.

**Tests:** `tsc --noEmit` clean, `build:web` clean.

- `engrave` — 28 assertions. Every line of all four clefs (treble E4·G4·B4·D5·F5,
  bass G2·B2·D3·F3·A3, alto F3·A3·C4·E4·G4, tenor D3·F3·A3·C4·E4), ledger counts
  above and below including the no-ledger case just outside the staff, stem
  directions and which side of the notehead they attach to, a sharp not moving
  its note, beams breaking at barlines, whole notes carrying no stem. All pass.
- `excerpt` — every excerpt in every rotation checked for range, clef, flats the
  engraver cannot draw, and **bar lengths**. All pass, and the check found two
  real bugs in my own corpus first: the scales left a three-beat bar, and the
  string crossings were barred every two beats instead of four.
- In Chromium against the built bundle: notation renders — beams, ledger lines
  and stem directions all correct on screen. `Listen` sounded the violin excerpt
  as **D4 E4 F♯4 G4 A4 B4 C♯5** and, after switching to cello in the profile,
  the same scale exactly an octave lower — **D3 E3 F♯3 G3 A3 B3 C♯4** — at 60
  oscillators for 15 notes × 4 harmonics. Every destination re-verified. Library
  unaffected. No console errors.

**Honest status:** verified in the web build against fixtures. Unproven:
whether the notation reads well at arm's length on a real phone, and whether
three excerpts per instrument is enough before the rotation feels short. The
fact corpus repeats after about a month, which is why it is a footnote.
**Still not done:** `PieceDetail` renders a progress bar for a field the
backend cannot supply.

**Known side effects:** the fixture Bach piece is now "practiced today" rather
than two days ago, so Library shows it under "This week" with today's date.
That is the fixture becoming self-consistent, not a display change.
**Rollback:** revert this commit.

---

## 2026-08-17 08:15 — Today gets its card back, and three blocks of real content

**Branch:** `main`. Owner: *"I don't think this is a good today. Keep the
continue practice in a box like you did last time and maybe add a piece of
content or few below."* Blocks chosen by the owner from four options — all
four. Ideas were put to them before anything was built (§2 gate).

Fair rejection. Removing the card killed the resemblance to Library but left
one piece, one sentence and a lot of air — and *bare* was the original
complaint. The card is back and is the only one on the screen.

**The rule that keeps this from becoming Library again**, now written into
`lib/today.ts` and `DECISIONS.md`: **nothing on Today may name a piece without
saying why it is on the screen.** Each row carries its reason on the line under
the title. The old library preview failed that test, which is exactly why it
read as a duplicate.

**What changed:**

- `screens/today/PracticeCard.tsx` — the box, restored. Same construction as
  the card deleted this morning, with one difference: **no progress bar and no
  percentage.** They rendered `piece.progress`, which the API maps to null. The
  working tempo takes their place.
- `screens/today/TodayRow.tsx` — the suggestion row. No thumbnail, on purpose:
  a sheet crop beside a title *is* the Library row.
- `lib/today.ts` — new, pure. Picks the two suggestions and dedupes them
  against the card and the last take.
- `data/sources/types.ts`, `api.ts`, `fixtures.ts` — `getLatestTake()` added to
  the `TakeSource` seam, both sides. No new endpoint: the API adapter sorts the
  analyses it already fetches for Insights.
- `data/hooks/useLatestTake.ts` — new.
- `components/skeletons/PieceSkeletons.tsx` — `ContinueSkeleton` mirrors the
  card again rather than the panel it briefly replaced.

**The screen now reads:** greeting · Continue practicing (card) · Last take ·
Also worth a look · Last 30 days. Every block hides itself when its data is
absent, so a new account with one piece and no analyses sees the card and
nothing else — the truth about a new account, not a screen of empty furniture.

**Three-foot test:** the card, then the "Continue practice" button inside it,
then the rows below. The rows recede, which is what "one dominant focal point"
means when there are four blocks on a screen.

**Tests:** `tsc --noEmit` clean, `build:web` clean. `suggestionsFor` checked
against 8 cases — card and last take both excluded, on-tempo pieces never
called "worth attention", never-practiced beating long-ago, alphabetical ties,
a one-piece library suggesting nothing, attention and neglected never
colliding, singular session wording — all pass. In Chromium against the built
bundle: all four sections render, no piece appears twice, and every
destination was confirmed — last take → that take's verdict screen, both
suggestions → their pieces, the summary → the Insights tab, the card →
the recorder. Library re-checked and unaffected. No console errors.

**Two false alarms I chased, both my harness rather than the app** — worth
recording because the trap will recur:

1. I read `navigate('Insights')` and the avatar's `navigate('Profile')` as
   silently broken. They are not. **React Navigation keeps inactive tab screens
   in the DOM** (marked `aria-hidden`), so `document.body.innerText` returns the
   whole app and the first match wins regardless of what is on screen. A
   screenshot I had already taken showed Insights rendered correctly. Verified
   properly by reading the accent colour off the focused tab.
2. The same thing then made the Library grouping look broken — "Not practiced
   yet" appeared as a heading out of order. It was Today's Paganini row,
   through the same hidden-DOM leak. The check now excludes anything under an
   `aria-hidden` ancestor.

**Honest status:** verified against fixtures in the web build. The last take
and the two insight-derived blocks are wired to real data paths, but **no real
analyses exist yet**, so what they say in production is unproven. Today now
fires four queries where it fired two — free on fixtures, two extra round trips
against the API. **Still not done:** `PieceDetail` renders a progress bar for a
field the backend cannot supply.

**Rollback:** revert this commit.

---

## 2026-08-17 06:40 — Today and Library stop being the same screen

**Branch:** `main`. Owner's report: Today feels bare, and it and Library don't
look much different. Direction chosen by the owner from four options
(§2 gate): differentiate both.

**The diagnosis was worse than the report.** All three tabs were one
composition — serif title, then a stack of white rounded cards, one per piece,
each with a title, a composer, a gold bar and a metadata line. Today's bottom
two-thirds was the top of Library, three rows shorter, from the same
`PieceCard`. Two things nobody had reported fell out of the comparison: the
gold bar encoded **progress** on two screens and **signed deviation** on a
third, and the progress it encoded **doesn't exist** — `sources/api.ts` maps
`progress` and `movement` to null. Live, these screens got barer, not richer.
Full reasoning in `DECISIONS.md`.

**What changed:**

- `screens/today/TodayScreen.tsx` — rewritten. The library preview is gone.
  The greeting moved to the eyebrow and the piece took the 36pt title; at 36
  against 26 the salutation had been outranking the only thing anyone opens
  the screen for. The action is pinned to the footer, in the thumb's reach.
- `screens/today/ContinuePanel.tsx` — new, and deliberately **not a card**: a
  full-bleed sheet strip, the piece's own recent verdict, the working tempo.
- `screens/library/PieceRow.tsx` — new. An index entry: thumbnail, title, one
  metadata line, a hairline rule. No card, no bar.
- `lib/library.ts` — new, pure. Groups the repertoire by recency.
- `lib/format.ts` — `daysSincePracticed` extracted and shared, so a heading and
  the row under it cannot disagree about which week something is in;
  `formatLastPracticedShort` for the metadata line.
- `lib/tempo.ts` — `formatWorkingTempo`. `practiceTempo` has stored an absolute
  BPM per piece since yesterday and it was visible **only** on the Record
  screen; you had to open a take to find out where you left off.
- `components/pieces/PieceCard.tsx`, `FeaturedPieceCard.tsx` — **deleted**.
  Nothing else used them.
- `components/skeletons/PieceSkeletons.tsx` — rebuilt to mirror the new shapes.

**Design notes.** No new patterns, no new tokens. Two structural calls: Today
uses the type scale for hierarchy instead of a border (§3 laws 3 and 8), and
Library uses rules instead of cards because a library is the one screen where
density is the point — you are scanning forty titles to find one.

Searching flattens the groups. "This week" over a set filtered by a word is a
heading about the wrong thing.

**Three-foot test.** *Today*: the piece title, the sheet-music band, the
Continue button — and nothing else competes, which is the first time that has
been true of this screen. *Library*: the word Library, the run of piece titles,
then the group headings. The two now share no silhouette.

**Tests:** `tsc --noEmit` clean, `build:web` clean. `groupByRecency` checked
against boundaries (0/6/7/27/28 days) and a sweep over 0–90 days asserting the
heading and the row's own label never contradict each other — all pass. Driven
in Chromium against the built bundle: groups render (`This week`, `Earlier this
month`, `Not practiced yet`), search flattens them to none and reports
"2 pieces found", no-match state and Clear search work, a row still opens the
piece, Today still reaches the recorder. No console errors.

**Two defects found in the loading state and fixed** — both only visible with
an artificial fixture delay, which is why they had gone unnoticed:

1. The greeting rendered as a 36pt title while pending and a 14pt eyebrow once
   loaded, so it **shrank to a third of its size** as the data landed. It is
   now the eyebrow in every state.
2. The skeleton's sheet strip bled off the left edge only. `Skeleton` defaults
   to `width: '100%'`, so negative margins slid the block sideways instead of
   widening it. Fixed with `width="auto"` and `alignSelf: 'stretch'`.

The strip's vertical position across the transition went from **66pt out to
10pt out**. It cannot be exact — how many lines a title takes depends on the
title — and the skeleton file now says so rather than claiming pixel-parity.

**Honest status:** verified visually and interactively against fixtures in the
web build. Today's practice sentence is real data through `PracticeInsights`,
but **no real analyses exist yet**, so what it says in production is unproven.
**Not done:** `PieceDetail` still renders a progress bar for a field the
backend cannot supply — same defect, different screen, outside what was asked
for here.

**Known side effects:** Today shows one piece and no list, so starting a
different piece means the Library tab. Deliberate — see `DECISIONS.md`.
**Rollback:** revert this commit; the deleted card components come back with it.

---

## 2026-08-17 05:10 — The metronome now exists

**Branch:** `main`. Chosen from "start anywhere you like", because this was the
largest thing in the app that was **stored, displayed, toggleable and connected
to nothing.** `metronome_mode` has been written onto every take since Batch 4,
shown on the Record screen, switchable in the profile, and sent to the backend.
Nothing has ever ticked, flashed or buzzed. A take submitted with
`metronome_mode: "haptic"` was telling the pipeline something untrue.

**What changed:**

- `lib/metronome/beats.ts` — pure. A time signature becomes beats-per-bar *in
  quarter notes*, matching `scheduleScore`'s unit, so the accent and the
  reference playback agree about what the BPM on screen means. `6/8` is 3.
  `9/8` is four and a half quarters, so it returns null and every beat is
  struck the same — the OCR's literal `"unknown"` lands in the same place. A
  metronome that is plain beats one that puts "one" in the wrong place.
- `lib/metronome/clock.ts` — drift-corrected beat clock for the visual and
  haptic modes. Beat times are `start + index × period`, never accumulated.
  Fires a loop rather than one beat per wake-up, so a backgrounded tab doesn't
  lose count.
- `lib/metronome/click.web.ts` — the audible click, booked against
  `AudioContext.currentTime` with a lookahead window. Why it doesn't share the
  clock above is in `DECISIONS.md`.
- `lib/metronome/click.ts` — the native click. **Unverified, and worse than
  the web one**: it re-strikes two pre-rendered players from the JS clock, so
  it carries jitter the browser build doesn't. Said plainly at the top of the
  file.
- `lib/metronome/useMetronome.ts` — mode, tempo and take phase in, beat out.
  Runs only while recording. Surfaces `silent`, for the case where the mode is
  haptic and haptics are switched off in the profile.
- `screens/record/BeatIndicator.tsx` — the visual mode: one mark per beat in
  the bar, the current one filled.
- `screens/record/RecordScreen.tsx` — wires it in. In visual mode the beat row
  replaces the metronome toggle at the same height, so nothing above moves when
  a take starts.

**Design notes (no new patterns — existing tokens only).** A row of marks
rather than one thing flashing, because a flash says *that* a beat happened and
this has to say *which*: someone glancing up mid-phrase is looking for their
place in the bar. The fill is ink on the downbeat and gold elsewhere — gold is
already this app's active state and ink is its strongest value, so "one" reads
darkest from a music stand without a second colour system. Nothing animates: a
transition would put the visible change *after* the beat, which is the exact
error being measured.

**Three-foot test (Record, mid-take):** the piece title, then the record
button, then the timer. The beat marks are fourth and peripheral, which is
right — they are for glancing at, not for looking at. Hierarchy unchanged from
the locked version of this screen.

**Tests:** `tsc --noEmit` clean, `build:web` clean. `beatsPerBar` checked
against 16 cases including `6/8`, `9/8`, `2/2`, `"unknown"`, null and junk —
all pass. Then measured in Chromium against the built bundle with a fake
microphone, driving the real UI (Today → Continue practice → toggle → record):

| | measured | expected |
|---|---|---|
| Visual, beat-to-beat at 92 BPM | 651 ms | 652 ms |
| Audio, worst click-to-click error on the audio clock | **0 s** | 0 s |
| Accent period, 4/4 | every 4th | every 4th |
| Click pitches | 1000 / 1600 Hz | plain / accent |
| Booked ahead of sounding | 0.08–0.24 s | lookahead, not per-beat |

Counting before the take: none. Counting after Stop: none. Clicks booked but
not yet sounded when the take ends: discarded with the context. The visual row
is absent in audio mode and vice versa — the modes are exclusive. No console
errors in any run.

**One defect found and fixed in the process:** `accessibilityValue` does not
reach the DOM on react-native-web — the `aria-valuenow`/`aria-valuemax` I set
came back null. The same class of gap as `accessibilityState` on this screen.
Rather than re-spell it in ARIA, the row is no longer a progressbar at all: a
live region announcing a position ninety-two times a minute would be unusable,
and a musician who can't see this has the haptic and audio modes. It carries
one static label instead.

**Honest status:** the web build is verified end to end. **The native build is
not, and cannot be here** — no simulator, no device. What needs a person:
whether the native click's jitter is audible, and whether 12pt marks read from
a music-stand distance. Neither is answerable from a screenshot.

**Known side effects:** none. The Record screen's layout is unchanged when the
metronome is off, which is still the default. **Rollback:** revert this commit;
`lib/metronome/` is self-contained and the Record screen's diff is additive.

---

## 2026-08-17 04:05 — The tab bar sat on the home indicator (my regression)

**Branch:** `main`. Reported from a real iPhone: the tab icons had almost no
room above the bar you swipe to exit the app.

**It was mine, from two commits ago.** When I added `mobile/public/index.html`
to carry the boot watchdog, I copied Expo's default viewport meta — which does
not include `viewport-fit=cover`. Without that attribute iOS reports every
`env(safe-area-inset-*)` as **0**. `react-native-safe-area-context`'s web
provider measures those exact values (confirmed in
`NativeSafeAreaProvider.web.js`), so `insets.bottom` came back 0, and the tab
bar fell through to its floor instead of the 34pt home-indicator inset.

Worth naming: the tab-bar code was never wrong, and I had verified it — with
insets simulated. The defect was one HTML attribute, upstream of everything I
had tested, in a file I wrote for an unrelated reason.

**What changed:**

- `mobile/public/index.html` — `viewport-fit=cover` on the viewport meta, with
  a comment saying why it is load-bearing so nobody trims it back to the Expo
  default. Verified it survives `expo export` verbatim into `dist/index.html`.
- `mobile/src/navigation/tabBarMetrics.ts` — `TAB_BAR_MIN_PADDING_BOTTOM`
  12pt → 16pt (`spacing.md` → `spacing.lg`). This is only ever a floor; where
  a device reports an inset, the inset still wins. It applies on hardware with
  no home indicator, where matching the 12pt above the icons left the labels
  reading as though they were falling off the frame.

**Tests:** `tsc --noEmit` clean, `build:web` clean. Measured in Chromium at
393×852 against the built bundle, driving the provider's real path by setting
the hidden probe's padding:

| | `paddingBottom` | bar height |
|---|---|---|
| No inset reported | 16px | 75pt |
| 34pt home indicator | 34px | 93pt |

The bar stays flush to the viewport bottom in both (`rect.bottom` 852 =
`innerHeight`). Today's scroll content grew 812 → 816, which is the 4pt of
extra floor arriving through `useTabBarHeight()` — the content inset tracking
the bar, as it should.

**Three-foot test (Today, re-run):** unchanged — the greeting, then the
practice piece, then the library. The tab bar is not in the first three things
you notice, which is the whole point of it.

**Known side effects:** none beyond the 4pt. **Rollback:** revert this commit;
the two changes are independent of each other.

---

## 2026-08-17 03:20 — Practise slower, and hear it first

**Branch:** `main`. Owner's feature. The two design calls were put to them
first: **absolute BPM saved per piece** (not a percentage of the marked tempo),
and playback of **the actual notes** rather than a click — with an instrument
choice to come later, from the profile or onboarding.

**Two things this landed on that were not what they appeared to be.** The
metronome was a stored preference and a line of text with **no implementation
at all** — nothing has ever flashed or ticked. And the Record screen ignored
the piece entirely, opening at a hard-coded 96 BPM while `bpm_hint` sat unused
in the score. "Play it slower" meant nudging ± away from an arbitrary number.

**The constraint that shaped it.** §4 is unambiguous: anything through the
speaker while recording lands in the microphone as phantom onsets and corrupts
the analysis. So listening is a step *before* the take, and starting a take
silences it. That is enforced, not documented — see the verification below.

**What changed:**

- `lib/score/schedule.ts` — pure: a score and a tempo become notes with times
  and frequencies. The same walk `alignment.build_timeline` does server-side,
  kept deliberately parallel so a note the app plays at 2.5s is the note the
  pipeline expects at 2.5s. Ties fold into one sounding note; re-striking a
  tied note is exactly the error a musician would hear. Repeats are **not**
  followed, and that's recorded in the file.
- `lib/score/voice.ts` — the instrument seam. One reference voice today, keyed
  by name so adding cello later is an entry rather than a restructure. A clean
  tone on purpose: a synthesised near-miss of a cello is worse than something
  that obviously isn't one, because the near-miss invites the comparison.
- `lib/scorePlayer.web.ts` — Web Audio, every note scheduled up front against
  `audioContext.currentTime`. Timers drift tens of milliseconds over a minute,
  which is the same order as the deviations this app measures; a reference
  that wanders would be worse than none.
- `lib/scorePlayer.ts` — native. No Web Audio and `expo-audio` plays files
  rather than synthesising, so the piece is rendered to PCM, written to a WAV
  in the cache (`expo-file-system`, added), and played. Rendering up front puts
  the timing in the samples where the JS thread can't perturb it.
- `lib/audio/wav.ts` — split into `encodeWavBytes` and `encodeWav`; uploading a
  take wants a `Blob`, writing one to a device wants the bytes.
- `data/practiceTempo.ts` — per-piece BPM, local like `preferences`,
  validated on read so an old or corrupt value can't put the recorder outside
  the range the backend accepts. Resolution order: what the musician chose,
  then the score's marking, then a fallback — their choice outranks the score,
  the score outranks a guess.
- `Piece` gains `markedBpm` and `score`. Both nullable: OCR often can't read a
  tempo marking off a phone photo, and listings don't fetch the notes.
- `ListenButton` on the Record screen, under the tempo. A progress line inside
  the control's own border rather than a second timer — the screen already has
  a tempo and a clock.

**Tests run:** `tsc` clean, web export built, driven in Chromium.

- **The pitches are right**, which is the thing worth checking: instrumenting
  `createOscillator` gives 294 / 330 / 370 / 392 / 440 Hz — D4, E4, F♯4, G4,
  A4 — and 36 oscillators for 9 notes × 4 harmonics.
- Tempo seeds from the piece: **92**, the fixture's `markedBpm`, not the old
  hard-coded 96.
- Two taps of Slower → 88, and still 88 after leaving the screen and coming
  back. Remembered.
- **Audio-bleed guard verified**: start a take mid-playback and the playback
  `AudioContext` reports `closed` while the recorder's own reports `running`.
  A closed context cannot make a sound.

**A wrong reading I nearly believed.** The first bleed test counted live
oscillators via `onended` and reported 32 still sounding — apparently a
serious bug. `onended` never fires after `context.close()`; the oscillators
were already dead. Re-tested against context state, which is the only thing
that actually decides whether audio can reach a microphone.

**Known side effects / things to watch:**

- **The native player has never made a sound.** No simulator, no device. It
  typechecks against `expo-audio`'s and `expo-file-system`'s documented APIs
  and that is all that can be said for it.
- Repeats are ignored. A repeat that doubles a preview's length is more
  surprising than useful, but a musician playing a repeated section will hear
  the playback stop early.
- The fixture pieces all share one three-bar demo score, so every piece
  currently sounds the same. Real scores arrive with OCR.
- **The metronome still does nothing.** This feature gives the beat a reason to
  exist — the same clock drives both — but the visual and haptic modes remain
  unbuilt.
- `expo-file-system` is a new native dependency, used only by the native
  player.

---

## 2026-08-17 02:15 — Motion and skeletons

**Branch:** `main`. UI work, requested by the owner, with the two aesthetic
calls put to them first per §2: skeletons that **mirror each screen's real
layout**, and motion limited to **entrances plus press feedback**.

**Library choice: none.** Everything here is opacity and transform, which
React Native's built-in `Animated` runs on the native driver. Reanimated is for
gesture-driven and layout animation, and this is neither — so no new native
dependency, and no risk to the web build.

**A constraint worth recording:** the usual iOS skeleton shimmer is a moving
gradient, and §3's design laws ban gradients. Skeletons pulse opacity instead.
Quieter, and it suits a screen whose only job is to say "nearly there".

**What changed:**

- `design/motion.ts` — one easing curve (`EASE_OUT`, decelerating; nothing
  eases *in*, because a UI element that accelerates away from rest reads as
  sluggish in exactly the frames being waited on), plus stagger, rise distance,
  press scale, and the skeleton pulse.
- `components/motion/FadeIn` — fade with an 8pt rise. Mount-only: content that
  re-animates on every refetch flickers at someone reading it. Under reduced
  motion it renders plainly rather than running a zero-duration animation,
  which would still start at opacity zero for a frame.
- `components/motion/PressableScale` — press-in instant, press-out eased. That
  asymmetry is iOS's: the response has to feel like it happened *under* the
  finger while the release can settle. Takes function children like
  `Pressable`, so a control that already swaps a colour gains scale without
  being restructured.
- `primitives/Skeleton` + `SkeletonText` — the fill is `colors.border`, not a
  grey: on warm ivory a neutral grey reads as cold and foreign. Placeholders
  are hidden from screen readers rather than announced as a dozen unlabelled
  boxes. `SkeletonText` rags its last line, which is the difference between
  reading as text and reading as a stack of bars.
- `components/skeletons/` — Today (featured card **and** the library section
  below it), Library, Insights, Verdict. Measurements are copied from the real
  components — a 56pt banner, a 56×40 thumbnail, `MeasureRow`'s 24/78 columns —
  so nothing moves when content lands.
- Rows on Today, Library, Insights and the verdict's measure list now stagger
  in at 30ms, capped at six so a forty-row library doesn't cascade.
- `PieceCard` and the record control give under the finger; the record button
  gets more (0.94) because it's the one control reached for without looking.

**Three-foot test:** unchanged, and deliberately. Motion here doesn't touch
static hierarchy — Today still reads featured card, then library, then tab bar.
The skeleton is the same composition in placeholder form, which is the point:
the shape is legible before a word has loaded.

**Tests run:** `tsc` clean, web export built, driven in Chromium at 393×852.

- Skeletons observed by temporarily delaying the fixture sources 4s, then
  reverted. Screenshots of Today, Library and Insights match their loaded
  layouts block for block.
- Pulse verified live: opacity sampled 0.45 → 0.76 across 450ms.
- **Reduced motion verified**: 0.45 → 0.45, static at the dim end, and content
  renders immediately with no fade.
- **Today's frozen reference intact**: scroll height 812, greeting top 16 —
  the same numbers as the golden-screen entry.
- No element left stuck part-way through a fade.
- Card press: `matrix(0.97, …)` while held, back to rest on release.
- No console errors on any screen.

**Known side effects / things to watch:**

- The skeletons hard-code measurements from the components they mirror. When
  one of those changes shape its skeleton has to follow, or the layout will
  jump again. The constants are named after their component to make that
  obvious, but nothing enforces it.
- Verdict's skeleton assumes twelve measure rows. Being wrong by a row costs
  nothing; being wrong about the shape would move the page under someone's
  eyes.
- Native-stack already gives real iOS push/pop with the interactive back-swipe
  **on a device**. On the web build there is still no screen transition — that
  was the option not taken, and it remains available.
- `LoadingState` is now used only by the screens without a bespoke skeleton
  (Profile, Record, Practice, PieceDetail).

---

## 2026-08-17 01:10 — The blank page: Cloudflare skips `node_modules`

**Branch:** `main`.

**Found it, and the evidence was arithmetic.** `dist` holds 27 assets. The
build log said `Uploaded 12 files`. Exactly 15 files sit under a directory
called `node_modules`. 27 − 15 = 12.

Cloudflare Pages silently skips anything under `node_modules` in the build
output. Metro names an exported asset after the path of the module that
imported it, so all four typefaces were at
`dist/assets/node_modules/@expo-google-fonts/…` and all four 404'd. `useFonts`
never resolved. `App.tsx` gated the whole app on `fontsLoaded` behind a plain
ivory `<View>` — **the blank page was the app**, sitting in its loading state
forever.

It is also why the boot watchdog stayed silent: React had mounted, `#root` had
a child, and by every check the watchdog makes nothing was wrong.

**Two fixes, because one of them should exist regardless.**

1. `mobile/scripts/flatten-vendor-assets.mjs` renames `dist/assets/node_modules`
   to `dist/assets/vendor` and rewrites the references in the bundle. Wired
   into `npm run build:web`, which the root build script now calls, so local
   and CI can't drift. It exits non-zero if it moves files but rewrites nothing
   — a rename without a rewrite is the same failure, wearing a success message.
2. `App.tsx` stops waiting forever. `useFonts`'s error is honoured and a
   5-second timeout backs it up. A font that 404s or hangs now costs the
   typeface, not the interface. Wrong typeface beats no interface, and an app
   should never be blank because of a decorative resource.

**Tests run:** built and served locally.

- All four fonts 200 from `/assets/vendor/…`, `Newsreader_400Regular` computed
  on the greeting. Zero files under `node_modules` in `dist`; 27 assets for
  Cloudflare to upload rather than 12.
- Every `.ttf` forced to 404: the app renders — "Good evening / Continue
  practicing / Sonata No. 1 in G minor…" — where it previously showed nothing.

**Known side effects / things to watch:**

- We now string-rewrite a built artifact, which breaks quietly if Expo changes
  the export layout. The non-zero exit is the guard.
- `assets/vendor` is a made-up path. Nothing else depends on it, but a future
  Expo version that emits its own `assets/vendor` would collide.
- The 5-second font timeout will fire on a genuinely slow connection and render
  a frame in fallback faces before the real ones swap in. That is a flash of
  wrong typography on a bad network, in exchange for never being blank.

---

## 2026-08-17 00:30 — A boot watchdog, because a white page says nothing

**Branch:** `main`.

The first Cloudflare deploy came back blank. The build log was clean end to
end — right commit, patch applied, 2586 modules bundled, `Success: Your site
was deployed!` — and the same artifact, built from a fresh clone of `main`,
renders correctly when served locally. Same result in Chrome and Brave, so not
a browser. That left no way to tell a missing bundle from a crashed one without
the owner's devtools, which is a bad place to be.

**Two things came out of it.**

**1. `_redirects` was being rejected, and was protecting nothing.** The log:

```
Parsed 0 valid redirect rules.
  - #1: /*    /index.html   200
    Infinite loop detected in this rule and has been ignored.
```

That is the rule Cloudflare's own SPA docs give; their current parser refuses
it. And it was guarding a door that doesn't exist — there is no `linking`
config on `NavigationContainer`, so the URL never changes. Driving the built
export and reading `page.url()` at each step gives `/` throughout, across every
tab and a pushed screen. Removed, with `docs/pages-spa-fallback.md` recording
what to put back when URL routing lands and that it must be checked against the
build log rather than assumed from the docs.

**2. `mobile/public/index.html` is now checked in, carrying a boot watchdog.**
Expo uses `public/index.html` as the shell when present and still injects the
hashed `<script>` and favicon into it — verified before relying on it. The file
otherwise matches what Expo emits byte for byte, so nothing about the app
changes.

The watchdog runs before the bundle and covers the three ways a boot can fail
silently:

| Failure | What it now says |
|---|---|
| Bundle 404s | `The app bundle failed to load.` + the URL |
| Bundle served as HTML (the SPA-fallback trap) | `The app crashed while starting. SyntaxError: Unexpected token '<'` |
| Nothing threw, nothing mounted | `The app did not start.` + a live re-fetch reporting the bundle's HTTP status and `Content-Type` |

All three exercised in Chromium by intercepting the bundle request, plus a
healthy boot to confirm it stays silent — Today renders, scroll height 812
against the frozen reference, `#root` has one child, no console errors.

Deliberately plain: no fonts, no design tokens, no framework. It has to work in
exactly the conditions where everything else didn't.

**Known side effects / things to watch:**

- The shell is now ours to maintain. If Expo changes its default template — the
  reset styles, the `#root` element — this file won't follow. It is short and
  commented for that reason.
- The watchdog's 8-second timer is a guess at "long enough that a slow 3G load
  isn't reported as a failure". A 3.3 MB bundle on a bad connection could
  exceed it and show a false alarm on top of an app that then mounts fine.
- This makes the failure *legible*; it does not fix the deploy. The cause is
  still unknown at the time of writing.

---

## 2026-08-16 23:55 — Free-tier quota; Cloudflare setup written down properly

**Branch:** `main`.

**`docs/deploy-cloudflare-mobile.md`** now opens with a field-by-field setup
for a new Pages project from `main`, rather than the older instructions written
when `mobile/` didn't exist there. Recommended shape: root directory empty,
build command `npm run build`, output `mobile/dist`, `NODE_VERSION=22`. The
root-directory alternative is kept in a fold, with the trap spelled out — under
the v2 strategy the output path is relative to the root directory, so `mobile`
+ `mobile/dist` sends Cloudflare looking for `mobile/mobile/dist`.

**Free-tier quota — Batch 8's first half.** `users.tier` has been on the row
since Batch 1 and nothing counted or enforced anything.

- `services/tier_limits.py` — `month_bounds`, `count_analyses_this_month`,
  `usage_for`, `tier_of`. Calendar month per the spec, not a rolling 30 days:
  it resets on the 1st for everyone, which is the version a musician can
  predict without being told. UTC, because the server doesn't know their
  timezone and a window inferred from a device clock can be gamed by changing
  the clock.
- `POST /v1/analyses` refuses the fourth with `403 {code: "tier_limit", limit,
  used, tier, resets_at}`. Structured rather than prose because the client has
  to act on it, and parsing a sentence to decide whether to show a paywall is
  how copy changes become bugs. Checked **before** the insert, so a refused
  analysis leaves no row and doesn't itself count toward the month.
- `GET /v1/me` gains `analyses: {used, limit, remaining, resets_at}` so a
  client can show "2 of 3 used" without first being refused. A paywall that
  only appears at the moment of refusal ambushes someone who has just finished
  playing. Best-effort — `/v1/me` is also first-touch provisioning, and failing
  it over a usage counter would lock someone out on their very first request.
- Paid tiers skip the count query entirely; `limit` is `null` rather than a
  large number, so "unlimited" is a value rather than something to recognise.
  `student_via_teacher` is unlimited too — their teacher is paying, and
  limiting them bills the studio twice.

**Deliberately not built: billing.** Batch 8 specifies Stripe Checkout, and
Apple requires in-app purchase for digital subscriptions, so an iOS-first app
can't simply take that route. Counting and enforcing needs none of it resolved,
and shipping this half now means the limit is real before there's anything to
sell. The decision is the owner's and it's still open.

**Tests run:** `216 passed` (was 203; +13). The quota tests use the stateful
fake rather than MagicMock chains, because what's worth testing is that N
inserted rows produce a count of N and the (N+1)th request is refused — a mock
that returns what it's told proves only that the code reads its own arrangement
back. Covers month boundaries including December and a leap February, last
month's analyses not blocking this month, another user's not counting, the
structured 403, no row left behind, and pro never refused.

**Two things the fake was missing, now added:** `.gte()` and
`select(count="exact")`. The count is of everything matching *before* any
limit, which is what PostgREST returns — a count that shrank to fit a page
would make the quota silently wrong.

**A bug this turned up.** `count_analyses_this_month` used `int(count)` on
whatever the client returned. `int()` on a `MagicMock` is `1`, so an
unconfigured mock reported a brand-new account as having already used one
analysis. Now `isinstance(count, int)` with a documented fallback to counting
rows — anything that isn't already an integer is a client that didn't answer
the question, and coercing it invents a number.

**Known side effects / things to watch:**

- **Failed analyses count against the quota.** A pipeline run costs the same
  whether it succeeds, so this is the defensible reading — but someone whose
  three attempts all failed on a bad microphone has had no value from the
  month. Worth revisiting once there are real failure rates.
- Nothing in the app shows the counter or handles the 403 yet. Both are UI and
  sit behind the §2 gate.
- `FREE_MONTHLY_ANALYSES = 3` is the spec's number, in one place, not scattered
  through the router.

---

## 2026-08-16 23:10 — On `main` now; Pages caching; the verdict-corrections endpoint

**Branch:** `main` — the owner asked for development to move here so updates
are visible without a PR round trip. `claude/mobile-frontend-rebuild-vay1tg` is
merged and done with.

**The deploy.** PR #3 merged, so `main` carries the whole app at `f3cb2f3`. The
`intempo` Pages project's check has come back green on the last two commits.
Verified the exact Cloudflare command from a clean tree on `main` before
merging — `rm -rf mobile/node_modules mobile/dist && npm run build` at the repo
root — exits 0, applies the `expo-audio` patch via `postinstall`, writes a
4.9 MB `mobile/dist`; the export was then served and driven in a browser with
no console errors.

`mobile/public/_headers` added. Everything under `_expo/static/*` and
`assets/*` carries a content hash in its filename, so those are `immutable` for
a year — the JS bundle alone is 3.3 MB and was being re-fetched on every visit.
`index.html` is the one file whose name never changes, so it must always
revalidate; a stale copy pins a browser to a deleted bundle and the app fails
to boot on a URL that looks fine.

**Two Pages projects are failing and neither is this app's.** There are now
three — `intempo` (green), `front`, and `i`. The other two report failure in
the same second they start, which means the build never ran: a configuration
error, usually a root directory that doesn't exist on the branch. They red
every commit, which makes the checks list useless for spotting a real failure.
Recorded in the deploy doc; their logs are only in the Cloudflare dashboard.

**`/v1/analyses/:id/corrections`** — the §7.5 feedback loop. The table and its
RLS policy have existed since Batch 1; only the endpoint was missing. §7.5
calls this the moat and says to ship it from day one, and the reasoning holds:
the onset-detection algorithms are public, labelled bowed-string onset data is
not. It is also the only route out of where Batch 3 is stuck — thresholds are
untuned because tuning needs a human ear on real recordings, and this is how
ears reach recordings at any scale beyond one person's afternoon.

- POST takes a whole take's corrections in one request. Twenty-four measures
  should not be twenty-four round trips.
- Both verdicts are stored, the app's and the musician's. Keeping only the
  correction would lose what it was correcting, which is the comparison the
  dataset exists to make.
- `unsure` is an accepted answer. §7.5 warns that many corrections come from
  disagreeing with the concept rather than catching a misfire, and someone who
  genuinely can't remember is more useful in the data than someone who guessed.
- Appends rather than replaces. Two different opinions about the same measure
  are both data; the second is later, not truer.
- GET is owner-scoped so a client can show a measure as already corrected. The
  table has no SELECT policy at all — the only other reader is the
  service-role retraining pipeline.
- Someone else's analysis is a **404**, not a 403, matching the rest of the
  API: an id that isn't yours is an id that doesn't exist.

**Tests run:** `203 passed` (was 192; +11). Route ordering checked explicitly —
`corrections` shares the `/analyses` prefix and must not shadow
`GET /v1/analyses/:id`; both resolve.

**Known side effects / things to watch:**

- **Nothing calls this yet.** The verdict screen has no "this was wrong"
  control, and adding one is UI work behind the §2 gate.
- The `2000`-character comment cap and the `200`-corrections-per-request cap
  are chosen, not derived. Both are generous for the shape of the interaction.
- I still can't load the deployed site from here — the sandbox proxy refuses
  `CONNECT` to `pages.dev` with a 403. Everything above is verified locally and
  from GitHub's view of the Pages check, not from the live URL.

---

## 2026-08-16 22:30 — Score images are displayable; last-practiced is real

**Batch:** backend gap-closing, toward `USE_FIXTURES = false`.
**Branch:** `claude/mobile-frontend-rebuild-vay1tg`

Two of the four null fields in `sources/api.ts` are now backed. `upload.py`'s
own docstring has always said "reads happen later through `/v1/scores/:id`
… which sign download URLs" — that was the contract; nothing implemented it.

**Backend — `scores.py`:**

- `ScoreResponse` gains `image_url` and `image_url_expires_at`: a download URL
  signed at read time, good for an hour. `source_image_url` stays and is
  documented for what it is — the signed *upload* URL, expired minutes after
  the upload, never usable for display.
- `_object_key_from()` recovers `<user>/<uuid>.<ext>` from the stored URL,
  since signing needs the key and only the URL was kept. The four storage URL
  shapes now live in one tuple that both this and `_assert_image_url_owned_by`
  read, so a new shape is added once. Deriving is safe because the assertion
  has already refused anything else; storing the key on the row would be
  tidier and is the right follow-up, but it needs a migration and a backfill.
- Signing is **batched** — a library of forty scores is one storage call, not
  forty — and **degrades to no image** on failure. A list of scores with no
  thumbnails is a usable screen; a 500 is not.

**Client — `sources/api.ts`:**

- `thumbnail` is the signed URL. Still nullable: signing can fail, and
  `ScoreThumbnail` already falls back to its ruled-staff drawing.
- `lastPracticedAt` needed **no backend change at all** — `/v1/analyses` has
  existed since the vocabulary fix. One extra request for the whole library
  rather than one per piece: the list is newest-first, so the first row naming
  a score is that score's most recent take.
- `getCurrentPiece` now means "most recently *played*", from the newest
  analysis, rather than "most recently added". It falls back to the newest
  score for someone who has never recorded, which is the only sensible thing to
  offer them.

**Tests run:** `192 passed` (was 185; +7 covering key extraction from all four
URL shapes, a foreign URL, the batched call count, the degrade path, the
bucket-prefixed echo, and an error entry).

Then the part that actually proves it. `mobile/scripts/stub-api.py` serves the
real response shapes over HTTP; with `USE_FIXTURES` flipped to false and
`EXPO_PUBLIC_API_BASE_URL` pointed at it, the app was driven in Chromium:

- Four real score images loaded from signed URLs — all eight `<img>` elements
  reported `naturalWidth: 1200`, so they decoded, they didn't just get a src.
- Today's featured card is the Bach Sonata with "Practiced today", not the
  newest-added score — `getCurrentPiece` reading the analyses list.
- Library shows "Practiced 3 days ago" on the Wohlfahrt, and nothing on the
  Suite, which has no analysis. The null case renders as absence.
- Request log exactly as designed: `/v1/analyses?limit=1`, `/v1/scores/:id`,
  `/v1/scores`, `/v1/analyses?limit=200`, `/v1/me`, then the four images.
- No failed requests, no page errors.

`USE_FIXTURES` is back to `true` and the fixture build re-exported — the real
backend isn't deployed and there are no Supabase keys.

**Known side effects / things to watch:**

- **Two fields are still null: `movement` and `progress`.** `movement` has no
  column and no `score_json` field. `progress` has neither, and it also has no
  definition — what counts as progress on a piece is a product decision, not a
  schema one. Both need answering before `USE_FIXTURES` can flip for real.
- Signing adds one storage round trip to every `/v1/scores` read, including
  callers that never render an image. Worth measuring against a real project
  before optimising; the alternative (a separate endpoint) costs the client N
  requests instead.
- The stub validates nothing and enforces no auth. It is a fixture with an HTTP
  interface, not a mock of the backend's behaviour.

---

## 2026-08-16 21:40 — Batch 3 tuning dashboard

**Batch:** 3 (audio analysis core) — the tuning appendix's step 2.
**Branch:** `claude/mobile-frontend-rebuild-vay1tg`

First backend work since the merge. The appendix is explicit that the readout
comes before any threshold change, and it wasn't built — so `TUNING_LOG.md` had
one entry, the untuned baseline, and no way to produce a second.

**What changed:**

- `backend/app/services/diagnostics.py` — `analyze_with_diagnostics()`. The
  same functions `analyze()` calls, in the same order, with the same config
  object, keeping the intermediate state instead of discarding it: detected
  onsets, the expected grid, DTW's raw mapping, what fuzzy matching matched and
  dropped, per-note deltas, and a peak envelope for drawing. Peak rather than
  mean — an attack is one or two samples wide and averaging a bucket flattens
  exactly the transient this is about.
- `backend/tuning_dashboard/` — FastAPI + Jinja2, two pages. `/` is one clip in
  detail; `/overview` is all six at the current parameters, which is what makes
  the appendix's regression rule cheap enough to follow. Plots are inline SVG
  computed in Python: no CDN to be offline from, no bundle, reload is instant.
- Per-request parameter overrides (`?onset.delta=0.05`) so three candidates can
  be compared without editing `config.toml`. Nothing is written back.
- A "paste this into the tuning prompt" block, formatted exactly as §4's prompt
  pattern wants it. §4's rule is that every round quotes real numbers from a
  named clip; the fastest way to make that happen is to have them already
  formatted.
- `fixtures/audio/` — `manifest.json` describing all six clips with the score
  and tempo each is played against (a grid that doesn't match the take is real
  arithmetic about the wrong thing), a README saying exactly what to record, and
  `make_synthetic.py` for stand-ins until then.

**Two bugs I introduced and fixed, both found by looking rather than assuming:**

1. **Mistyped parameters were silently ignored.** `_overrides` filtered the
   query string to known tunables, so `?onset.detla=0.05` rendered a completely
   convincing page for a parameter that never moved — the worst thing a
   measurement tool can do, and the exact failure a comment in the file claimed
   to prevent. Now anything that isn't page state is treated as an intended
   override and an unknown name is a 400.
2. **Deviation bars drew on the wrong side of the axis.** The heading says up is
   late, and the rushing clip's all-negative deltas were drawing upward. SVG's y
   grows downward, so the arithmetic inverts — caught on the first screenshot.

**Tests run:** `185 passed` (was 166; +19). `test_diagnostics.py` pins the
property the whole tool rests on — diagnostics and `analyze()` agree on status,
verdict, quality, counts, trend and every per-note delta. `test_tuning_dashboard.py`
covers overrides, the 400 on a typo, both routes, and the bar direction in both
directions, read back out of the rendered SVG geometry.

Driven in Chromium at 1280×1400: both pages render, no console errors, and the
overview table read back as data.

**Known side effects / things to watch:**

- **The six recordings still don't exist, and that is the whole blocker.** The
  synthetic stand-ins have exact known onset times and none of what a threshold
  has to survive — bow noise, room reflection, a bass's slow attack, string
  ring. Every clip that came from one is labelled `synthetic` in the UI.
- `config.toml` is untouched. No threshold moved, and none should until there
  is real audio.
- The generator's first version cut its decay envelope off at a non-zero value,
  which is a step, which is a transient — it produced 2× detections that looked
  exactly like a real over-detection problem. Recorded in `TUNING_LOG.md`
  because the same thing will happen with a hard-edited real clip.
- No hover-to-read on the charts, which server-rendered SVG gives up. The
  numbers table carries the same data, and it's the thing that gets pasted.
- `*.synthetic.wav` is gitignored (5.6 MB, deterministic). The real six are
  deliberately **not** ignored — the appendix says commit them.

---

## 2026-08-16 20:45 — Unprocessed input — and a correction to the entry below

**Batch:** Frontend rebuild — Record + Verdict flow.
**Branch:** `claude/mobile-frontend-rebuild-vay1tg`

**The correction first.** The entry below reported an open gap: that iOS auto
gain could not be turned off because `expo-audio` exposes no way to reach
`AVAudioSession`'s `.measurement` mode. That is wrong. `AudioStream.start()` in
`node_modules/expo-audio/ios/AudioStream.swift` opens every stream with
`session.setCategory(.record, mode: .measurement)` — the exact mode that asks
the system for no input processing. **iOS was already correct.** I inferred the
gap from the JavaScript type surface, where `AudioMode` has no mode field,
instead of reading the native source that was sitting in `node_modules`.

**The gap that does exist is on Android.** Reading `AudioStream.kt` in the same
pass: it opens `AudioRecord` on `MediaRecorder.AudioSource.MIC`, the platform's
general-purpose source, which runs through whatever input chain the OEM
applies. Automatic gain reshapes attack envelopes, and attack envelopes are
what the onset detector measures — so Android takes would have been quietly
less accurate than iOS ones, with nothing anywhere saying so.

**What changed:**

- `patches/expo-audio+57.0.3.patch` — `resolveAudioSource()` picks
  `UNPROCESSED` where the device reports
  `PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED` and `VOICE_RECOGNITION` where it
  doesn't; `MIC` is no longer used. On top of that,
  `AutomaticGainControl`, `NoiseSuppressor` and `AcousticEchoCanceler` are
  explicitly disabled on the capture session, since some devices attach them
  regardless of the source. The effect objects are held for the life of the
  stream and released in `stop()` — a garbage-collected `AudioEffect` takes its
  setting with it and the processing returns mid-take.
- `patch-package` added, wired to `postinstall`.
- `lib/audioRecorder.ts` — dropped both `setAudioModeAsync` calls. Now that the
  Swift has been read it's clear `AudioStream` owns the session end to end:
  `start()` sets category and mode, `stop()` deactivates with
  `notifyOthersOnDeactivation`. A second opinion from the JS side could only
  race it. The module doc now states the real position on each platform.
- `DECISIONS.md` — the old entry carries the correction rather than being
  edited to look right, and a new entry covers patching over forking.

**Tests run:** `npx tsc --noEmit` clean. Patch verified by deleting
`node_modules/expo-audio` and reinstalling: `expo-audio@57.0.3 ✔`, and the
patched source is present afterwards. `npx expo export` for iOS and web. The
web capture re-run against a fake device after removing the session calls —
still a clean WAV (PCM, mono, 16-bit, 44100/88200/2, riffSize 262180 and
dataSize 262144 exact against 262188 bytes, 2.97 s, peak 32767).

**Known side effects / things to watch:**

- **The Kotlin has never been compiled.** There is no Android toolchain here.
  What is verified is that the patch applies to a clean install; the first
  Android build is the real test and should be run as a build before it is run
  as a take.
- The patch must be re-made on every `expo-audio` upgrade. `patch-package`
  fails the install loudly when upstream moves, which is the behaviour worth
  having here — a silent revert would mean thresholds tuned against processed
  audio.
- Worth sending upstream; a measurement-grade source is the right default for
  a raw-PCM stream API.

---

## 2026-08-16 20:05 — Audio capture — the record button is real

**Batch:** Frontend rebuild — Record + Verdict flow.
**Branch:** `claude/mobile-frontend-rebuild-vay1tg`

The last stubbed feature. `lib/audioRecorder.startRecording()` threw; it now
records. See `DECISIONS.md` for why raw PCM rather than either platform's
recorder — the short version is that Android's `MediaRecorder` cannot emit PCM
at all, and a lossy codec smears the transient this pipeline measures.

**What changed:**

- `lib/audio/wav.ts` — the shared encoder. Int16 chunks → a canonical 44-byte
  PCM WAV. Little-endian written explicitly through `DataView` rather than by
  overlaying an `Int16Array`, which would take the platform's endianness and
  produce noise on a big-endian device.
- `lib/audio/types.ts` — `Recorder`, `Recording`, three typed errors, and
  `MAX_TAKE_SECONDS`.
- `lib/audioRecorder.ts` (native) — `expo-audio`'s `AudioStream` at int16/48k
  mono, believing `stream.sampleRate` back from the hardware. Buffers are
  copied on arrival because the native side may reuse them. Releases the audio
  session on stop.
- `lib/audioRecorder.web.ts` — `AudioWorklet` over `getUserMedia` with the
  three voice-processing constraints off. The processor batches 32 quanta
  (~85 ms) before posting, instead of 375 messages a second, and transfers
  the buffer rather than copying it. `stop()` asks the worklet to flush before
  disconnecting, so the end of the last note isn't lost.
- `data/sources` — a `TakeSubmissionSource` seam beside the read sources.
  Capture is real on both sides of `USE_FIXTURES`; only the destination
  changes. The screen no longer imports a fixture id.
- `RecordScreen` — awaits the recorder before starting the timer, so the clock
  agrees with the file; guards a double-tap from opening a second microphone;
  cancels on unmount so leaving mid-take releases the mic; and on failure
  returns to the top with the tempo still set.
- `app.json` — the `expo-audio` config plugin, with a microphone usage string
  and background modes off.

**New user-facing copy** (for review — four sentences, all failure states):
permission refused, no microphone/API, a silent take, and a failed upload. Plus
one line on "Listening back" when a take hits the 15-minute cap.

**Tests run:** `npx tsc --noEmit` clean. `npx expo export` for both web and
iOS. Then the real thing, in Chromium with `--use-fake-device-for-media-stream`
— a genuine `getUserMedia` capture through the worklet, with the resulting WAV
read back byte by byte:

| field | value |
|---|---|
| RIFF / WAVE / `fmt ` / data | all present |
| audioFormat | 1 (PCM) |
| channels / bits | 1 / 16 |
| sampleRate / byteRate / blockAlign | 44100 / 88200 / 2 |
| riffSize, dataSize | 263972 and 263936 against a 263980-byte file — both exact |
| duration from the header | 2.99 s for a 3.0 s take |
| signal | peak 32767, non-silent — real samples, not a zeroed buffer |

Permission refusal tested separately with `--deny-permission-prompts`: the
screen returns to ready, keeps the tempo, and shows the sentence. No page
errors in either run.

**Known side effects / things to watch:**

- **The native voice-processing gap is real and open.** On web the three
  constraints are enforced; on native `expo-audio` gives no way to reach
  `AVAudioSession`'s `.measurement` mode, so iOS may apply auto gain — which
  reshapes attack envelopes. This must be closed before thresholds are tuned
  against native recordings.
- Verified on web only. The native path is written against `expo-audio`'s
  documented `AudioStream` API and bundles for iOS, but no simulator or device
  exists in this environment — it has never actually run.
- Uncompressed audio is ~96 KB a second. A three-minute take is about 17 MB.
- No unit-test harness exists in `mobile/`, so `wav.ts` is covered by the
  byte-level browser assertion above rather than by a test that runs in CI.

---

## 2026-08-16 19:15 — Record — an even vertical rhythm

**Batch:** Frontend rebuild — Record + Verdict flow.
**Branch:** `claude/mobile-frontend-rebuild-vay1tg`

Lifting the control exposed how lumpy the spacing under it already was. Two
causes, both structural:

1. **`body` was `justifyContent: 'center'` with a fixed 40pt gap.** Centring one
   block in leftover space means the two voids around it are whatever is left
   over — they aren't chosen, they're a remainder. Now `space-evenly`, so the
   interval above the tempo group, between it and the timer, and below the timer
   are one measure that scales with the screen.
2. **The container's standard 24pt bottom padding was landing under the timer.**
   That padding exists for content ending above a tab bar; here the footer owns
   the bottom edge, so it was pure extra air in exactly the gap that had to
   match the others. Cancelled on this screen with `paddingBottom: 0` in
   `contentStyle`.

Measured gaps between the four blocks, 393×852 with a 34pt indicator:

| | before | after |
|---|---|---|
| Title → Target tempo | 100 | **92** |
| Metronome → timer | 41 | **80** |
| Timer → control | 121 | **97** |

Spread went from 80pt to 17pt. The residual 17 is the two paddings that belong
to their own components — `PageHeader`'s 12pt below the title and the footer's
16pt above the action — and cancelling those would mean negative margins
fighting two shared primitives, which is worse than a gap that is 20% larger
before the action zone.

Checked at four sizes; the rhythm compresses proportionally and nothing
collides:

| | title→tempo | metronome→timer | timer→control | circle centre from bottom |
|---|---|---|---|---|
| 393×852, 34pt indicator | 92 | 80 | 97 | 150 |
| 393×852, flat top | 112 | 102 | 117 | 132 |
| 375×667 (SE) | 51 | 39 | 56 | 132 |
| 430×932 (Max) | 118 | 108 | 123 | 150 |

**Tests run:** `npx tsc --noEmit` clean, web export rebuilt, all four sizes
driven in Chromium and screenshotted.

---

## 2026-08-16 18:55 — Record — the control lifted into the thumb zone

**Batch:** Frontend rebuild — Record + Verdict flow.
**Branch:** `claude/mobile-frontend-rebuild-vay1tg`

Owner: the record control sat too low for a phone. It did — the safe-area inset
below it only guarantees clearance of the home indicator, which is a different
question from where a thumb rests. One `marginBottom: spacing['4xl']` on the
control, no other change.

Measured at 393×852, before → after:

| | web (no indicator) | device (34pt indicator) |
|---|---|---|
| Circle centre from bottom | 90 → **132** | 108 → **150** |
| As a fraction of screen height | 0.106 → **0.155** | 0.127 → **0.176** |
| Label bottom from edge | 16 → **56** | 34 → **74** |

Both land at roughly a sixth of the screen up, which is where a thumb sits on a
phone this size. The block above it (tempo, metronome, timer) is centred in the
remaining space, so it rises with the control rather than opening a gap.

**Tests run:** `npx tsc --noEmit` clean, web export rebuilt, both insets driven
in Chromium and both states screenshotted.

---

## 2026-08-16 18:40 — Record + Verdict — sign-off fixes

**Batch:** Frontend rebuild — Record + Verdict flow.
**Branch:** `claude/mobile-frontend-rebuild-vay1tg`

Four owner-requested fixes before locking both screens. No redesign: the
composition, tokens, type and navigation are as approved.

- **One information system per state on the measure list.** Words by default on
  every row; tapping selects a row, which warms to the page colour edge to edge,
  firms its number from tertiary to primary ink, and swaps the word for the
  figure. Only one row at a time, and tapping another moves the selection. To
  let the tint reach the card edges, the row now owns its own horizontal gutter
  (the wrapper's `paddingHorizontal` is gone) and the hairline moved onto an
  inner view, so dividers stay inset while the selection runs full width.
- **Start versus stop is now unmistakable.** The idle control was a black disc
  with a white dot, which reads as a stop button before anything has started.
  Idle is a microphone glyph over the words "Start recording"; recording is a
  filled square over "Stop recording". The label is inside the `Pressable`, so
  it's part of the target rather than a caption under it.
- **The dev message is gone.** "Recording needs an audio module that isn't
  installed yet…" was development information on a shipped screen. Removed; the
  control now behaves as though recording works and lands on the fixture take.
  `CAN_RECORD` stays in `lib/audioRecorder` for code that has to branch on it,
  with a comment saying it is not for the interface.
- **The metronome line toggles.** Tapping switches between off and the last
  mode that was on (`visual` when there's no earlier choice — an audio click
  through the speaker is the one mode that would end up inside the recording).
  It writes the same device preference the Settings screen does. Locked during
  a take alongside the tempo, since the mode is recorded onto the take.

**Three-foot test (Record):** first the piece title, second the black control
with its label, third the 96 BPM reading. The empty middle is doing the work —
nothing was added to it.

**Tests run:** `npx tsc --noEmit` clean; web export rebuilt and both flows
driven in Chromium at 393×852.

- Measure rows: zero figures visible on arrival; after tapping 6 exactly one
  row shows a figure, its background is `rgb(247,242,233)` = `colors.bg`, and
  the tint spans 351 of the card's 351px. Tapping 9 moves it.
- Record: no dev copy anywhere in the rendered text. Metronome toggles
  `Metronome off` → `Visual metronome`, and is `pointer-events: none` with
  `aria-disabled` while recording.
- Verdict-colour quarantine re-swept after the row refactor: Today, Library,
  Insights and Profile all report 0 elements carrying the three values.
- Today re-measured and unchanged: scroll height 812, content padding 94px
  against the 71pt bar.

**Known side effects / things to watch:**

- The metronome label uses ARIA props (`aria-checked`, `aria-disabled`) rather
  than `accessibilityState`. react-native-web maps `accessibilityState.disabled`
  but silently drops `checked`, so the web build was announcing a switch with no
  state. Both spellings land in the same place on native.
- When on, the label reads the mode name ("Visual metronome") rather than
  "Metronome on", because Settings already names four modes and one word of
  state would lose which. Flagged for the owner.
- The label is gold in both states. Gold is the app's tappable-text language
  (links, "See all"), so it signals the line does something; the word carries on
  or off. This is the one place gold isn't an active-state marker.

---

## 2026-08-16 18:02 — Verdict screen — practice-feedback refinement pass

**Batch:** Frontend rebuild — Record + Verdict flow.
**Branch:** `claude/mobile-frontend-rebuild-vay1tg`

**What changed** (refinement only — no redesign, no new visual patterns, no
token changes):

- **Headline back to charcoal.** It was taking `verdictColorFor(worstBand)`, so
  a take with one severe measure put a red sentence on the screen at 36pt,
  which reads as an error rather than as feedback. `PageHeader`'s `titleColor`
  prop is gone with it — nothing else ever set it, and a coloured screen title
  everywhere else would be decoration.
- **Take-specific wording.** `formatTakeVerdict(measures)` in `lib/tempo.ts`
  replaces `formatTendency(verdict)` on this screen. One recording can't see a
  habit, so "You tend to rush" is now reserved for Insights, where there are
  sessions to average. A take says where it went wrong instead — "You rushed in
  the middle", "You dragged towards the end" — from the midpoint of the
  off-tempo measures, with drift that never left the slight band getting the
  gentler "Tempo drifted ahead".
- **The trend chart explains itself.** `TrendLine` now carries its own axes: a
  54pt gutter naming Ahead / Target / Behind against the rule, and measure
  numbers at each end of the plot so a bump on the line can be found in the
  list below. The absolutely-positioned Ahead/Behind labels and the sentence
  "The rule is the target tempo. The take starts on the left." are deleted —
  they were saying what the chart now says.
- **Legend above the measure list**: `Behind ← Target → Ahead`. Laid out on the
  row's own columns (exported as `MEASURE_COLUMNS` from `MeasureRow`) so the
  arrows sit over the bar, not over the middle of the card — measured at
  x 72–267, which is the bar exactly.

Kept as they were: the measure words, the verdict colours on bars and words,
`Record again` primary over `Back to the piece` secondary, spacing, type, card
style, navigation.

**Three-foot test (Verdict):** first "You rushed in the middle" — charcoal, the
only serif on the screen; second the red run of measures 5–8 in the list, which
is the same fact as the headline, in the same place the headline points to;
third the black `Record again`. Before this pass the red headline and the red
rows competed for first, which is the hierarchy fault §3 law 4 describes.

**Tests run:** `npx tsc --noEmit` clean. `npx expo export --platform web` and
the flow driven in Chromium at 393×852:

- Headline `rgb(20, 17, 14)` = `textPrimary`, 36pt.
- Legend 13pt `textTertiary`, box x 72→267 against a bar column of 72→267.
- Prose line gone; axis labels present once each.
- Safe areas, simulated with a 34pt home indicator by overriding the inset
  probe's `env()` padding: footer `padding-bottom` tracks it at 34px (16pt
  floor without one), secondary button ends 34pt above the screen edge, and
  with all twelve measure rows expanded the last row clears the footer by 24pt
  and "Tap a measure for its timing" by 55pt. Nothing hides under the actions.
- `formatTakeVerdict` checked against nine hand-built takes (empty, all on
  tempo, slight-only both directions, rush/drag at start, middle, end,
  throughout, and a single-measure take).

**Known side effects / things to watch:**

- A one-measure take reports "throughout", since one measure is its whole
  extent. Correct but blunt; worth revisiting if very short takes are common.
- The wording still comes from the client. The pipeline's own sentence
  (`take.headline`) sits under it and is the better source once it covers every
  case — two sentences describing the same take is one more than the screen
  needs.
- Verified in a browser, not on a device. No mic, so the take is still the
  fixture.

---

## 2026-08-16 00:31 — Today screen — final refinement pass (golden screen)

**Batch:** Frontend rebuild, phase 3 sign-off.
**Branch:** `claude/mobile-frontend-rebuild-vay1tg`

**What changed:** polish only — no new visual patterns, no redesign. Date eyebrow removed from Today; top spacing rebalanced. Featured card 318→298pt (6.3%) via tighter internal vertical spacing (horizontal gutters left alone so the title doesn't crowd the border). Library titles 20→19pt, which lets "60 Studies for the Violin, Op. 45" set on one line. Library thumbnails standardised to a fixed 56×40 box, `cover` + `contentPosition: center`, centred against the text block. `textSecondary` and `textTertiary` darkened centrally. New `sectionAction` type token (13pt sans regular) so "See all" keeps the gold but stops competing with the section heading.

**Real bug fixed:** Today's scroll content sat behind the tab bar. `ScreenContainer` had a flat 40pt bottom padding against a bar that is 71pt before the home-indicator inset. First fix used `BottomTabBarHeightContext`, which turned out to report React Navigation's 49pt default rather than measuring our custom `tabBar` — still 22pt short. Now `navigation/tabBarMetrics.ts` derives the height from the same tokens `BottomTabBar` lays out with, and both consume it; the context is used only to detect whether a bar is present (absent on Practice, pushed above the tabs).

**Tests run:** `npx tsc --noEmit` clean. Browser render measuring computed boxes: card 298pt, all library rows 78pt, all three thumbnails exactly 56×40, scroll content padding 94pt against a 71pt bar, last card clears by 94px, no console errors.

**Known side effects / things to watch:**
- `textTertiary` moved from ~2.6:1 to ~4.6:1 on the page background. It now clears WCAG AA for the 14pt metadata step; it previously did not.
- `pieceTitle` at 19pt sits just below the 20–22pt the owner named, and inside the 19–22 band in their original brief. Called out for sign-off.
- Still not run on a simulator or device — no macOS or Android emulator here.

---

## 2026-08-15 06:27 — Mobile frontend rebuild — design system, primitives, Today screen

**Batch:** Frontend rebuild, phases 2–3 (supersedes the Batch 9 RN scaffold plan).
**Branch:** `claude/mobile-frontend-rebuild-vay1tg`
**Commit (after this edit):** `feat(mobile): design system, shared primitives, and Today screen` — hash resolvable from branch history.

**What changed:**
- `mobile/` scaffolded from `create-expo-app` (Expo SDK 57, RN 0.86.2, React 19.2.3, TS 6.0). Previously an empty placeholder README.
- `mobile/src/design/` — colour, spacing, radius, typography, and motion tokens. Newsreader (serif) + Inter (sans), two weights each, imported per weight rather than from the package root.
- `mobile/src/components/primitives/` — Text, ScreenContainer, PageHeader, SectionHeader, Card, PrimaryButton, SecondaryButton, ProgressBar, MetadataRow, EmptyState, LoadingState.
- `mobile/src/components/pieces/` — ScoreThumbnail (with a ruled-staff fallback), FeaturedPieceCard, PieceCard.
- `mobile/src/data/` — wire types mirroring `backend/app/models/` and `score_schema.py`; API modules for `/v1/me`, `/v1/scores`, `/v1/upload/*`; Supabase session helper; a `PieceSource` seam with fixture and API implementations; TanStack Query hooks.
- `mobile/src/navigation/` — bottom tabs (Today, Library, Insights, Profile) with a custom tab bar, plus a root stack for full-screen flows.
- `mobile/src/screens/` — Today built in full; Library, Insights, Profile, Practice are explicit placeholders.
- `mobile/assets/fixtures/` — four public-domain score crops copied from `fixtures/scores/` for use as fixture thumbnails.

**Why:**
The design direction in spec §3.5 was retired by the project owner and replaced with a new brief (serif/sans pairing, warm ivory and antique gold, editorial rather than Linear-leaning). The rebuild targets React Native rather than the web frontend. Phases 2–3 only: the Today screen is the golden screen and the rest of the app waits on its approval, so no other screen inherits an unapproved visual system.

**The data problem this works around:**
Today's hierarchy needs progress, a last-practiced line, a "current" piece, and score thumbnails. None exist behind the API — `scores` has no progress or movement column, `/v1/analyses` is unbuilt, and score images sit in a private bucket with no read endpoint. Every screen therefore reads through `data/sources/PieceSource`; `sources/api.ts` implements the real mapping and returns `null` for each unbacked field, and `sources/index.ts` selects fixtures for now. Flipping one boolean moves the app onto live data without touching a component.

**Tests run:**
- `npx tsc --noEmit` → clean.
- `npx expo export --platform ios` → bundles successfully; four font files (919 KB total) and four fixture images included.
- Not run on a simulator or device — no macOS or Android emulator in this environment, so nothing here is visually verified.

**Known side effects / things to watch:**
- **`scores.source_image_url` is unusable for display.** `POST /v1/scores` only accepts the signed *upload* URL for `image_url` (the `public_url` the upload endpoint returns is a bare bucket path with no scheme, which `_assert_image_url_owned_by` rejects with a 400), and that signed URL expires after `SIGNED_URL_TTL_SECONDS` = 5 minutes. Displaying a score image needs a signed-download endpoint that does not exist. Flagged, not fixed — backend work is outside this rebuild's scope.
- Tab bar labels use the 13pt `sectionLabel` step because the brief's type scale has nothing smaller. A dedicated ~11pt step would suit better; that is a design-system change and needs the owner's sign-off.
- `Input`, `SearchField`, `Modal`, and `BottomSheet` are named in the brief but deliberately unbuilt — nothing calls them yet.
- Dark mode is not implemented; `app.json` pins `userInterfaceStyle: light`. Never specified either way.
- `npx expo install` cannot reach `api.expo.dev` through this environment's proxy, so dependencies were installed with plain `npm install`. Versions were not checked against Expo's SDK-compatibility table.

**Rollback:** the whole change is additive under `mobile/` plus this log entry. Reverting the commit restores the empty placeholder; nothing in `backend/` or `frontend/` was touched.
## 2026-07-28 — Tap-target and header fixes (measured, not eyeballed)

**Branch:** claude/next-steps-3p2zhk
User reported controls felt unclickable and the top looked unorganised. Both
correct. I had been judging touch targets by eye; measured them instead against
the 44×44 minimum.

**Measured before → after** (390×844):

| Control | Before | After |
|---|---|---|
| "Add" in header | 70×**34** ❌ | removed |
| "See all" | 44×**21** ❌ | 60×**44** ✅ |
| Piece title link | 114×**22** ❌ | merged into 165×**185** card ✅ |
| Favourite star | ~23px ❌ | 44×**44** ✅ |
| Tab items | 98×63 ✅ | 98×**70** ✅ |

- **Header reorganised.** "Add" floated beside a two-line text block, aligned to
  neither line — that was the disorganisation. Removed from Today entirely: it
  belongs with the library, and the Library screen already has it one tap away
  via the tab bar. The header is now a clean two-line block.
- **Whole card is one link.** The crop and the title were separate targets, the
  text one only 22px tall. The favourite button moved to an absolute overlay on
  the crop, since a `<button>` nested in an `<a>` is invalid and the clicks
  would fight. Verified the star toggles without navigating.
- **Tab bar given weight**: icons 22→25px, min-height 58px, target 63→70px.
  It measured acceptable before but read thin.

**Verified:** lint + build green; every visible control on Today now passes
44×44; favourite works without navigation; no console errors.
**Process note:** the design laws mandate a three-foot test but nothing forced
measuring ergonomics. Worth adding a tap-target check to the UI routine.
**Rollback:** revert this commit.

## 2026-07-28 — Today refined: hero card with an integrated action

**Branch:** claude/next-steps-3p2zhk
Refinement, not a redesign. Visual language (warm ivory, charcoal, muted ochre,
serif/sans pairing, sheet crops) deliberately unchanged.

**Reversed yesterday's `PracticeBar`.** It solved thumb reach but created a
worse problem: the action was detached from the piece it acted on, so the user
had to connect a title at the top with a button at the bottom. My own
three-foot test had already flagged it out-shouting the content. Deleted; the
bottom is navigation only again.

- **Hero card.** `Continue practicing` is now a real card — title (26/28px
  serif), composer · movement (16px sans), progress with a serif percentage,
  last-practiced, and a **"Continue practice →"** action *inside* it. This is
  the one place law 3 justifies a card: the focal point plus its own action.
- **Header compressed and softened**: small sans greeting over the serif screen
  title, "Add" reduced to a compact control.
- **Typography restricted** per the brief. Serif now only for screen titles,
  composition names and the progress figure. Section headings became sentence
  case sans 14px (`CONTINUE PRACTICING` / `YOUR LIBRARY` were shouty); composer,
  metadata, buttons and navigation are all sans.
- **Library simplified**: dropped the date from every card (secondary — belongs
  on the piece screen), leaving title · composer · percent. Added `shortTitle`
  to the data model and used it in the grid.
- `All 6 →` became `See all`.

**Deviation from the brief, deliberate.** The spec asked for 20–22px library
titles, but at two columns on a 390px screen that forces exactly the awkward
wrapping the brief complains about — the first attempt broke "Cello Concerto
No. 1" as "No." / "1". Settled on 17px with `text-wrap: balance` and shorter
grid titles, which keeps the serif prominent and sets these on one line. Flagged
rather than silently ignored.

**Three-foot test:** *first* the hero card, *second* the Continue action inside
it (reads as one object, not a competitor), *third* the library grid. Correct.

**Known trade-off:** "Continue practice" now sits ~36% down the phone rather
than in the thumb zone (law 7). That is the brief's explicit choice — proximity
to the piece over reach — and worth revisiting if it annoys in real use.
**Verified:** lint + build green; mobile 390×844 and desktop 1440px
screenshotted; no console errors.
**Rollback:** revert this commit.

## 2026-07-28 — Fix the thumb zone on Today (design law 7)

**Branch:** claude/next-steps-3p2zhk

**The violation:** "Practice" is the primary action but sat ~33% down the phone
screen, furthest from the thumb, while the reachable bottom held only
navigation. Backwards for a mobile-first practice app.

**Fix — new `layout/PracticeBar.tsx`, rendered by `AppShell`, not by the page.**
Law 9 says a persistent action is app furniture, so it belongs in the frame:
flush above the tab bar, same opaque surface and hairline, no floating card.
This also sidesteps a trap logged earlier — `fixed` inside the animated outlet
re-anchors to the transformed wrapper rather than the viewport.
- Mobile only (`lg:hidden`); a pointer reaches anywhere, so desktop keeps the
  action inline in the Continue row where its context is.
- Only on `/`; it is Today's action, not global chrome.
- Carries no piece metadata (law 10) — the screen above already says what
  you're practising, so repeating it would be decoration.

**Measured:** primary action moved from ~33% to **86% down** a 390×844 viewport.

**Three-foot test, and the second problem it caught.** After the first pass the
answer was: *first* the black Practice slab, *second* the piece title. That
inverts the intended hierarchy (what am I practising → practise it) and breaks
law 4. Rebalanced rather than shipped:
- Strengthened the focal point — the sheet crop now shows on mobile too
  (was `hidden sm:block`), and the title went 18px → 21px.
- Lightened the action — bar padding and button height reduced.
- **Now reads:** first the piece (crop + serif title), second Practice, third
  the library grid. Correct.

**Other law work in this pass:** `PieceGrid` cards swapped `border` for `ring-1`
so the crop's own white edge does the separating (laws 3/6 — less container,
more content).

**Verified:** lint + build green; confirmed the last visible card clears the bar
when scrolled to the bottom (650 vs 725), the bar is absent on Library, and
desktop shows no bottom bar; no console errors.
**Still open:** law 1 (native-first rather than responsive-web-adapted-down)
and the three ⚠️ flow screens, which remain unassessed against the laws.
**Rollback:** revert this commit.

## 2026-07-28 — Adopt binding design laws; audit current screens against them

**Branch:** claude/next-steps-3p2zhk

Added the user's ten design laws to **`CLAUDE.md` §3** (binding, above the
component conventions), plus the mandated **three-foot test** with a standing
requirement to record its answer here for any screen built or changed.
Renumbered Batch status to §4.

**Flagged `frontend/DESIGN_SYSTEM.md` as partly superseded.** It still
prescribed the pre-redesign "engraver's manuscript" look — heavy cream, gold
surfaces, serif everywhere, rounded cards, a phone-width column on desktop —
which was deliberately removed. Same failure mode as the stale Figma file: a
future session would have executed it faithfully and undone the redesign. Its
*process* guidance (one screen at a time, screenshot critique loop) still holds.

### Three-foot test on the current screens

**Today** — first: the piece title *Cello Concerto in B Minor*. Second: the
black **Practice** button. Third: the library grid. That reads correctly for
the intended hierarchy (what am I practising → practise it → my pieces).

**Library** — first: the grid of sheet crops. Second: the filter row. Third:
the page title. Also correct; the music dominates.

### Violations found, not yet fixed

- **Law 7 (thumb zone) fails on mobile.** "Practice" is the primary action but
  sits in the upper third of the phone screen, furthest from the thumb, while
  the reachable bottom area holds only navigation. This is the most substantive
  gap and needs a composition change, not a style tweak.
- **Law 1 (native-first)** is partly unmet: the layout is still a responsive
  web page that adapts down, rather than a phone design that adapts up.
- **Law 3/6** mostly holds now, but `PieceGrid` cards still carry a border +
  rounded corner that the crop itself could imply.
- The three ⚠️ flow screens (capture / recording / verdict) have not been
  assessed against the laws at all; they retain phone-column compositions,
  bordered panels and a large Deep Spruce surface.

No UI code changed in this entry: recording the laws and the audit first, per
the §2 gate.
**Rollback:** revert this commit.

## 2026-07-28 — Composition refinements: density, navigation, hierarchy

**Branch:** claude/next-steps-3p2zhk
Refining the redesign rather than replacing it. Direction (palette, serif,
sheet crops, minimal borders) kept as-is.

1. **Compressed the top.** `h1` 34/42px → 24/27px and the sub-paragraph is gone
   (decorative). Section gaps 12/14 → 8. The current piece is now above the
   fold instead of below a display headline.
2. **Continue practicing is one block** — thumb, title, composer/movement,
   progress and action on a single row at 58px tall, gaps tightened.
3. **Removed "+ Add" from that row** so nothing competes with Practice.
4. **Navigation is destinations only.** "Add" was an action masquerading as a
   tab. Now: **Today · Library · Insights · Profile**, matching the intended
   hierarchy (what am I practising → practise it → my pieces → my progress).
   Desktop `TopNav` mirrors it. Adding a piece is an explicit "+ Add piece"
   control in the screen header (mobile) and the top bar (desktop).
5. **Library density** — crops `aspect-4/3 → 16/10` (~17% shorter), row gap
   tightened. Two columns on mobile kept; Home now renders 8 pieces so desktop
   fills two rows, with `limitOnMobile` hiding the overflow below `md` so a
   phone isn't a long scroll.
6. **Bottom nav is opaque** (`bg-paper`, no translucency) — sheet music no
   longer reads through it.
7. **Removed `PreviewBadge`** and its mount. No developer UI in the product.
8. **Piece titles down a step** — grid 16→15px, continue row 21→18px, page
   headings 30/36 → 24/27px. Functional rather than magazine.
9. **Ochre confined to active states, progress and favourites.** Removed the
   amber composer eyebrow (decoration); active nav and filter underlines now
   carry it, which is a meaningful state.

**Verified:** lint + build green; desktop 1440px and mobile 400px screenshotted;
confirmed the mobile grid renders exactly 4 cards while desktop shows 8; no
console errors.
**Note:** `docs/deploy-cloudflare.md` still describes the preview badge, which
no longer exists. Left for a follow-up rather than expanding this diff.
**Rollback:** revert this commit.

## 2026-07-28 — Ground-up UI redesign: editorial workspace, real desktop layout

**Branch:** claude/next-steps-3p2zhk
User brief: the UI read as an AI-generated "premium app". Rethink hierarchy,
layout, navigation and component structure; keep functionality.

**Information architecture**
- **Desktop is now a real workspace.** New `layout/TopNav.tsx` (sticky, 1240px
  container) replaces the 440px phone column stranded on a desktop canvas.
  `AppShell` is responsive: top nav at `lg`+, bottom `TabBar` below it.
  Chose a top bar over a sidebar because there are three destinations — a
  sidebar would spend 240px of width on three words.
- Home reduced to the three areas asked for: prompt, Continue practicing,
  library. Removed the "Saturday morning" contextual eyebrow (decoration).
- Library gained working filters (kind + favourites) with a live count.
  Filters hide themselves when they'd return nothing.

**Visual system** (`index.css`, `tokens.ts`, `tailwind.config.js`)
- Paper pulled off beige toward warm off-white (`#F7F2E4 → #FAF8F3`); surfaces
  are now true white. Ink to near-black `#171614`.
- **Gold demoted to an accent.** Muted `#C78A3A → #9C7A3C`, and every large gold
  surface is gone — primary actions are ink, not gold slabs.
- Radii `12/18/24/30 → 8/10/12/14`. `shadow-card` reduced to almost nothing;
  structure now comes from hairline borders.
- **Serif is now selective**: piece titles and the practice prompt only.
  Section headings became small sans labels (`ui/SectionHeading.tsx`).

**Sheet music is the visual identity.** New `sheet/SheetCrop.tsx` draws
plausible engraving in SVG — bass clef (it's a cello app), time signature,
barlines, beamed groups, deterministic per seed — replacing beige rectangles
with horizontal lines. Used in the library grid and the continue row.

**Data model.** `demo.ts` now stores `title` and `composer` as separate fields
with `kind` and `progress`, instead of one `"Composer — Title"` string parsed
by each screen. Deleted `splitPiece`. Title outranks composer everywhere.

**Caught in review:** composer names were clipped in every thumbnail (the
`slice` crop cuts ~15 viewBox units per side); the Practice action was stranded
across a 1240px row (capped at 860px); "Add piece" appeared twice on desktop
(page-header copy is now `lg:hidden`).

**Functionality preserved:** all routes, auth gate, OCR upload/review/save,
recording, verdict polling, favourites toggle, reduced-motion gating. Verified
the library filters still work end-to-end in-browser (6 → Favourites 2 →
Etudes 1).
**Verified:** lint + build green; Home / Library / Account / Capture
screenshotted at 1440px and 400px; no console errors.
**Known gaps:** `ScoreThumb`, `Card`, `StubPage` and the record/verdict interior
panels still carry older styling — they're behind flows that need real data to
review properly. **Rollback:** revert this commit.

## 2026-07-28 — Cozier palette, real webfont, tighter copy, no em dashes

**Branch:** claude/next-steps-3p2zhk
User feedback: warmer "paper ivory", less verbose copy, the Playfair + Suisse
pairing, no em dashes, homier feel.

**Typography — this was a real bug, not just taste.** The sans stack was
`-apple-system, "SF Pro Text", system-ui`, which on the user's **Windows**
machine resolved to Segoe UI. They had never seen the intended type.
- Shipped `@fontsource-variable/inter` so the face is consistent everywhere.
- **Suisse Int'l is commercial** (Swiss Typefaces) and can't be bundled. The
  stack is `SuisseIntl, "Inter Variable", Inter, …` — self-host a licensed copy
  declaring `font-family: SuisseIntl` and it takes over with no code change.
- Used `SuisseIntl` without the apostrophe deliberately: `"Suisse Int'l"` is
  valid CSS but **lightningcss fails to parse it** and broke the build. A
  self-hosted face names itself in `@font-face`, so this costs nothing.

**Warmer palette** (index.css + tokens.ts, kept in sync): paper `#F6F4EC →
#F7F2E4`, raised `#FBF9F2 → #FDFAF0`, warm `#F0ECDF → #F1EAD8`, deep `#E7E1D1 →
#E8DFC9`. Ink warmed off pure graphite: `#1C1C1A → #23201A`, with the soft/mute/
faint ramp and hairlines shifted to match. Also swept out stale hardcoded
values still using the old palette (`Badge` info tint, `AnnotatedScorePanel`
note backing, `HomeRoute` staff lines).

**Copy**
- **Home CTA lost its subtext** ("Point your camera at the page…") — now just
  "Photograph sheet music". Rebalanced the card's padding afterwards, since
  removing the line left it visibly bottom-heavy.
- Trimmed the capture headline, storage notice, login, calibration and
  OCR-confidence strings.
- **Removed every em dash from user-facing prose** across 10 files, replacing
  with full stops or `·`. Left them in code comments, and left the `—`
  empty-value placeholders (`Email —`), which are a "no value" glyph rather
  than punctuation.

**Verified:** lint + build green; computed `font-family` confirmed in-browser;
Home and score list screenshotted; no console errors.
**Note:** `DECISIONS.md` records the palette as locked. This supersedes those
specific hex values at the user's direction; the *rules* (amber the only
accent, spruce recording-only, verdict colours quarantined) are unchanged.
**Rollback:** revert this commit.

## 2026-07-28 — Motion + softness pass ("smooth, iOS-style, softer feel")

**Branch:** claude/next-steps-3p2zhk
**Tooling:** `animate` skill (Emil Kowalski) for the easing/spring discipline;
Playwright, capturing **mid-transition frames** rather than settled stills —
a still can't show whether motion works.

**New — `lib/motion.ts`.** Single source for springs, easings and variants, so
timing isn't re-decided per component. Encodes: enters ease-out 200–300ms,
exits ~75% of that, springs where interruptible, transform/opacity only.

**Motion**
- **`AppShell`** now animates its `<Outlet />` — tabbed screens crossfade with
  an 8px rise while the frame and tab bar stay mounted.
- **`SheetScreen`** (new) — capture / record / verdict rise from below on a
  spring, like an iOS modal presentation.
- **Staggered lists** — Home blocks and score-list rows cascade 40ms apart.
- **`.press` / `.press-lg` utilities** in `index.css` — universal press
  feedback. CSS rather than motion components so `Link`s get it too without
  rewriting markup; larger surfaces compress less so the scale isn't a lurch.
- **TabBar** icons spring on select (`springSnappy`).
- All gated on `useReducedMotion()`, plus a `prefers-reduced-motion` block
  neutralising `.press`.

**Softness**
- Radii up one step: `sm 10→12, md 14→18, lg 20→24, xl 26→30`.
- `shadow-card` rebuilt with three stops and lower alpha — light through paper
  rather than a hard drop. Added `shadow-lift` for raised surfaces.

**Caught in review — the whole approach had to be rebuilt.** My first pass put
`AnimatePresence mode="wait"` around `<Routes>`. A mid-transition screenshot
showed a **completely blank frame**: `mode="wait"` unmounts the entire tree,
including `AppShell`, so the tab bar blinked out on every switch. Moving the
transition inside `AppShell` (around the outlet only) keeps the chrome mounted.
Verified by re-capturing the same frame — tab bar solid, rows visibly cascading.

**Trade-off accepted:** flow screens animate in but not out. An exit animation
needs `AnimatePresence` around the router, which reintroduces the unmount
problem. Entrance is the half users notice; documented in `SheetScreen`.
**Known subtlety:** an animated ancestor holds a transform at rest, which
re-anchors `position: fixed` descendants. `PreviewBadge` is deliberately
rendered outside the animated tree. `VisualMetronome` (`fixed inset-0`) sits
inside a full-height route, so its flash is visually identical either way.

**Verified:** lint + build green; mid-transition and settled frames captured for
tab switches and sheet presentation; no console errors.
**Rollback:** revert this commit.

## 2026-07-28 — Switch the preview deploy to Cloudflare Pages (supersedes GitHub Pages)

**Branch:** claude/next-steps-3p2zhk
**Why:** GitHub Pages would have required making the repo public (private repos
need GitHub Pro). Cloudflare Pages builds private repos on its free tier.

Before recommending either, I scanned the repo for exposure: **27 commits, all
refs — no `.env` ever committed, no key-shaped string in any diff.** (Only
`.env.example` files are tracked and their non-blank values are a localhost URL,
PostHog's public host, and a model-name list.) So going public would in fact
have been safe; the user preferred private, which Cloudflare supports for free.

- **Removed `.github/workflows/pages.yml`.** Left in place it would have run and
  *failed* on every push, since Pages was never enabled — red X's on every
  commit for a path we're not using. Recoverable from git history.
- **`frontend/public/_redirects`** — new. `/* /index.html 200`, the SPA fallback.
  Cloudflare only knows about files on disk while React Router owns the routes,
  so a refresh on `/scores` or a shared deep link would 404 without it. Vite
  copies `public/` to the dist root, so it ships automatically.
- **`docs/deploy-cloudflare.md`** — new. The dashboard settings, which can't be
  committed as config: root directory `frontend`, build `npm run build`, output
  `dist`, and `NODE_VERSION=22` (Cloudflare's default Node is the usual cause of
  a failed first build). Also flags that the production branch must be set to
  this branch — `main` is back at Batch 2 and has none of these screens.

**Kept from the GitHub Pages work** (all still useful, and inert here):
`VITE_BASE_PATH` in `vite.config.ts` (unset → `/`, which is what Cloudflare
wants), the router `basename`, the `ProtectedRoute` pass-through when Supabase
is unconfigured, and `PreviewBadge`. Cloudflare serves from the domain root, so
no base-path juggling is needed.

**Verified:** lint + build green; default build emits root-relative asset paths;
`_redirects` confirmed present in `dist/`; served and loaded in Chromium with no
console errors.
**Not verified:** the `_redirects` rule itself — that's Cloudflare-side
behaviour and can't be exercised locally (`vite preview` has its own SPA
fallback, so a passing deep-link test here proves nothing about production).
Worth a refresh on `/scores` once it's deployed.
**Rollback:** delete `_redirects` and the doc; nothing else depends on them.

## 2026-07-28 — GitHub Pages preview deploy (superseded — see the entry above)

**Branch:** claude/next-steps-3p2zhk
**Why:** the user wanted to see the screens in a browser without setting up
Supabase or running anything locally.

- **`.github/workflows/pages.yml`** — builds `frontend/` and publishes to Pages
  on push to this branch (plus `workflow_dispatch`). No secrets used or needed.
- **`vite.config.ts`** — `base` now reads `VITE_BASE_PATH` (unset → `/`), since
  Pages serves from the `/intempo/` subpath. Local dev is unaffected.
- **`App.tsx`** — `BrowserRouter basename={import.meta.env.BASE_URL}` so routes
  resolve under that subpath.
- **SPA fallback** — the workflow copies `index.html` → `404.html`; Pages has no
  rewrite rules, so a refresh on `/scores` would otherwise 404.
- **`ProtectedRoute`** — **now passes through when Supabase isn't configured.**
  This was the actual blocker: with no keys, `status` is `signedOut`, so every
  screen redirected to `/login` and the preview would have shown nothing else.
  When unconfigured there is no session to check and no backend to reach, so
  there's nothing to protect; with keys present the gate is unchanged. A
  production deploy that forgot its keys now fails *visibly* (demo data + badge)
  rather than looping on a redirect.
- **`components/PreviewBadge.tsx`** — new. Renders only in a production build
  with no keys: "Preview — demo data, no backend". Without it, Record and
  Photograph-sheet-music look broken rather than absent.

**Verified:** lint + build green; built with `VITE_BASE_PATH=/intempo/`, served
under that subpath and loaded in Chromium — no `/login` redirect, no console
errors, deep link to `/intempo/scores` resolves. Checked at 1200px and 400px.
**Caught in review:** the badge initially covered the tab bar (hiding Record and
Insights) — repositioned to the desktop gutter, lifting above the tab bar on
narrow screens.

**Honest scope:** this is the UI only. No auth, no upload/OCR, no
mic→analysis — Pages is static hosting and the FastAPI service isn't deployed.
Screens render `lib/demo.ts` seed data.
**Requires one manual step:** repo Settings → Pages → Source = "GitHub Actions".
The workflow fails until that's set. Public repo (or GitHub Pro) also required.
**Rollback:** delete the workflow; the other changes are inert without it.

## 2026-07-28 — Account screen rebuilt to the manuscript system

**Branch:** claude/next-steps-3p2zhk
**Tooling:** locked manuscript system; Playwright via a temp `/preview-account`
route, then removed.

`routes/AccountRoute.tsx` was real but plain (Eyebrow + generic Card + two
labelled strings). Rebuilt:
- **Identity block** — monogram circle from the email's first letter, falling
  back to a Phosphor `User` mark when there's no email; email + plan line.
- **Details rows** — Email / Plan / Version, hairline-separated, matching the
  score-list row language. Plan renders through the **rebuilt `Badge`** (its
  first real usage outside `/showcase`): `primary` for Pro, `info` for Free.
- **Version moved here** from the `Layout` footer, which since the rebuild only
  renders on `/showcase` — Account is the conventional home for it.
- **Sign out** — full-width bordered button with a `SignOut` glyph.
- **Unconfigured-auth notice** — when `supabaseConfigured` is false, says so
  plainly instead of silently rendering em-dashes.

**Deliberately NOT added:** notification toggles, theme pickers, an "Upgrade to
Pro" CTA. None of them have anything behind them — Stripe is Batch 8, and `Me`
only carries `{ id, email, tier }`. A settings screen full of dead controls is
exactly the kind of fake UI we've been removing elsewhere. Add each when its
backing exists.

**Verified:** lint + build green; screenshotted, no console errors. The shot
shows the *unconfigured* state (no Supabase keys in this environment) — the
signed-in state can't be verified in-session.
**Rollback:** revert this commit.

## 2026-07-28 — Score list built (`/scores`) — the last dead end on main nav

**Branch:** claude/next-steps-3p2zhk
**Tooling:** locked manuscript system; Playwright via a temp `/preview-scores`
route, then removed. Layout (rows vs grid vs composer-grouped) was the user's
call — rows chosen.

`routes/ScoreListRoute.tsx` was still `<StubPage>`, so Home's "See all" *and*
the Library tab both dead-ended. Replaced with the real screen:
- **Rows** — staff-line `ScoreThumb`, amber composer eyebrow, serif title,
  `movement · date` meta, favourite star; hairline dividers between rows.
- **Header** — serif "Your library" + a piece count.
- **Favourite toggle reinstated here.** I removed it from Home during the
  rebuild because it didn't belong on a landing screen; managing the library is
  where it does. **Local-only** — there's no favourites endpoint, so it resets
  on reload. Wire alongside `GET /v1/library`.
- **Empty state** — a real one (MusicNotes mark, explanation, "Add your first
  piece" CTA) rather than bare text, since it's the first thing a new user sees
  on this tab.
- Rows link to `/scores/:id/record`, so the list leads somewhere.

**Also fixed:** `/scores/:id` rendered the *entire library* (both routes pointed
at the same stub). It now redirects to that piece's record screen via a small
`ScoreDetailRedirect` — interim until a score-detail screen exists.

**Small refactor:** `splitPiece` ("Composer — Title") was duplicated in
`HomeRoute`; moved to `lib/demo.ts` and both screens now import it.

**Verified:** lint + build green; populated list *and* empty state both
screenshotted, no console errors; star toggle exercised in-browser.
**Known gaps:** reads `lib/demo.ts` seed data; `lastPracticed` is a display
string so there's nothing to sort on — the seed array is already newest-first
and order is preserved rather than faked. **Rollback:** revert this commit.

## 2026-07-28 — Badge rebuilt: kit-style API on the locked palette (de-slopped)

**Branch:** claude/next-steps-3p2zhk

**Why:** the user flagged the verdict badges as reading "ai" — correct. The old
`Badge` was a pastel-tinted pill with a redundant coloured status dot: the most
templated status affordance on the web, and foreign to a paper-and-ink world.

`components/ui/Badge.tsx` rewritten to the `variant` × `appearance` × `shape`
API the user supplied, resolved to the manuscript tokens:
- **`variant`** — primary (amber, the one accent), success / warning /
  destructive (the verdict triad), info (**neutral graphite `ink`, never
  `spruce`** — spruce is the recording surface and must not encode a status).
- **`appearance`** — solid / light / **outline (default)**. Outline is the
  manuscript-native one: paper-warm ground, hairline edge, hue in the text and
  border rather than a fill.
- **`shape`** — **square (default, 10px engraved chip)** / circle (pill).
- **Removed the status dot** entirely — it repeated the text colour and carried
  no information.
- Colours come from `styles/tokens.ts`, not re-typed hexes.
- `tone` ("on"/"mid"/"bad") kept as a verdict-UI shorthand → success / warning /
  destructive, so verdict screens stay in domain language.

`ShowcaseRoute` now documents the full matrix (3 appearances × 5 variants, plus
the circle shape) and keeps a separate "Verdict tones" card for the `tone` API.

**Honest note:** the API can still express the generic look
(`appearance="light" shape="circle"`) — that's a deliberate escape hatch, with
the defaults doing the guiding. I also proposed two more distinctive directions
(pencil margin-marks; Italian tempo terms like *stringendo* / *a tempo*) which
the user didn't take this round; logged in `DECISIONS.md` as the better
long-term direction for verdict UI specifically.

**Blast radius:** none — `Badge` is used only on `/showcase`; no live screen
consumes it yet.
**Verified:** lint + build green; `/showcase` screenshotted, no console errors.
**Rollback:** revert this commit.

## 2026-07-28 — Finish the Phosphor migration; drop Lucide; refresh CLAUDE.md §3

**Branch:** claude/next-steps-3p2zhk

Closes the loose ends called out at the end of the UI rebuild.

**Icon migration finished (`lucide-react` → Phosphor):**
- `components/record/TempoSelector.tsx` — `Minus`/`Plus` (now `weight="bold"`).
- `components/result/PerNoteDetail.tsx` — `ChevronDown` → `CaretDown` (Phosphor's
  equivalent, already used in the record top bar), 18→16px to match.
- `routes/ShowcaseRoute.tsx` — `Plus` in the Button `trailingIcon` demo.
- Dropped the invalid `strokeWidth` props (a Lucide-ism Phosphor ignores).
- **Removed `lucide-react` from `package.json`** — zero references remain in
  `src/` or the lockfile. The app is now single-icon-library.

**Fixed a stale design-system reference:** `/showcase` hard-coded the *pre-lock*
palette (`paper: #EDE8DA`, `ink: #211F1B`) — wrong since the tokens were locked,
and actively misleading on the page whose whole job is documenting the palette.
It now imports `colors` from `styles/tokens.ts`, so it can't drift again.
Verified in-browser: swatches read `#F6F4EC` / `#1C1C1A`, no console errors.

**`CLAUDE.md` §3 rewritten** to reflect reality after the rebuild: a per-screen
status table (4 rebuilt, 3 still pre-rebuild), the Figma mockup link, the five
conventions the rebuild established (Phosphor-only, full-bleed flow screens
outside `<Layout>`, Framer Motion + `useReducedMotion`, `/showcase` sources
tokens, `lib/demo.ts` seed data is deliberate), and a blunt DoD note that no
batch is tagged and every remaining gate needs Supabase keys + a device.

**Verified:** lint + build green; `/showcase` screenshotted with no console
errors. **Known side effects:** none expected — icon swaps are like-for-like and
`CaretDown` is the same glyph family already used elsewhere. **Rollback:**
revert this commit (and `npm i lucide-react` if anything unexpected depended on it).

## 2026-07-28 — Score-capture / OCR flow — rebuilt to the locked design system

**Branch:** claude/next-steps-3p2zhk
**Tooling:** locked manuscript system (no Figma mockup — designed straight to
code per the user's choice); Playwright (global Chromium) via temp
`/preview-capture` (real route) + `/preview-capture-edit` (mock-OCR harness),
then removed.

Brought the last screen still on the old Batch-7 UI onto the rebuilt system:
- **Full-bleed chrome** — moved `/scores/new` out of `<Layout>` (dropping the
  redundant wordmark header/footer) to a 440px column with its own X-close +
  step title, matching the Recording/Verdict flow screens.
- **Capture state** — amber eyebrow + serif lead-in, restyled dashed drop-zone
  (`ImageUploader`) and "Use the camera instead".
- **Processing state** — replaced the progress bar with the manuscript amber
  pulse + "Reading your score…", consistent with the analysis screen.
- **OCR-review (edit) state** — amber low-confidence banner, measure cards, and
  the inline note editor; the invalid-pitch affordance now reads in oxblood.
- **Saved / error states** — restyled with CheckCircle / Warning and the
  rebuilt Button.
- **Icon migration** — `ScoreCaptureRoute`, `ImageUploader`, `CameraCapture`,
  `ScoreEditor` moved from `lucide-react` to Phosphor (matching the rest of the
  app); dropped the invalid `strokeWidth` props. (`TempoSelector`,
  `PerNoteDetail`, `ShowcaseRoute` still import Lucide — out of scope here.)

The OCR plumbing (`useScoreUpload` / `useScoreSave`, upload → parse → save
mutations, validation) is unchanged — this was a presentation pass.

**Verified:** lint + build green; capture and OCR-review states screenshotted
(the review harness used an intentionally-invalid "H5" pitch, confirming the
validation styling). **Known gaps:** live upload → OCR → save still pending
Supabase keys + backend. **Rollback:** revert this commit.

## 2026-07-28 — Verdict screen — verified against Figma + data-driven tip fix

**Branch:** claude/next-steps-3p2zhk
**Tooling:** Figma file `k5IB3714DiusqnAwzkY7pz` as source of truth; Playwright
(global Chromium) via a temp `_PreviewVerdict` harness + `/preview-verdict`
route (rendered `VerdictView` with a mock `AnalysisResult`), then removed.

The Verdict screen was already the closest match to the Figma (the Figma was
built from this component), so this was mostly a verification pass:
- `VerdictView.tsx`: headline bumped **30px → 32px** with `leading-[1.15]` to
  match the Figma type spec exactly.
- **Bug fix (found while verifying the Next-steps tab):** the tip was
  hard-coded to "measure 8" and would contradict the actual verdict. It now
  reads from the data — anchored to the real off-tempo region (`location`)
  and phrased for the drift direction (rush → "ease back", drag → "ease
  toward"; on-tempo gets its own encouraging line).
- Confirmed the annotated score (two systems washed amber + "a touch ahead" /
  "breathe here" margin notes), stat chips, two-tone headline, and the
  spring tab indicator all render as designed.

**Verified:** lint + build green; Score and Next-steps tabs screenshotted
against the Figma. **Rollback:** revert this commit.

## 2026-07-28 — Recording screen — code aligned to its Figma mockup (design→code)

**Branch:** claude/next-steps-3p2zhk
**Tooling:** Figma file `k5IB3714DiusqnAwzkY7pz` as source of truth; Playwright
(global Chromium) via a temp public `/preview-record` route, then reverted.

Restructured `frontend/src/components/record/RecordingPanel.tsx` to the Figma's
hero-tempo composition:
- **Promoted the tempo readout to the hero** — a 64px serif BPM number flanked
  by round ± steppers, with a "BPM · {meter}" caption (meter now shown here).
- **Removed the needle dial and the bow arc** — the Figma surface is cleaner and
  leads with the number; the dial/meter-readout/arc were competing for the eye.
- **Amber-tipped waveform** — new static `IdleWave` bar strip before recording
  (center bars amber), with the live `WaveformPreview` + timer kept for the
  listening state.
- State line is now upright serif (was italic); controls (metronome / red mic /
  bookmark) enlarged to match the mockup's proportions.
- **Kept all functionality:** calibration link, done-state playback + Redo/Analyze,
  5-minute warning, VisualMetronome pulse, mic error surface.

`RecordRoute` and `ScorePanel` unchanged — the top bar + manuscript score panel
(now-playing system washed amber) already matched the Figma.

**Verified:** lint + build green; screenshot of the running page matches the
Figma. **Known gaps:** live mic → analysis loop still pending mic permission +
Supabase/backend on a real device. **Rollback:** revert this commit.

## 2026-07-28 — Home screen — code aligned to its Figma mockup (design→code)

**Branch:** claude/next-steps-3p2zhk
**Tooling:** Figma file `k5IB3714DiusqnAwzkY7pz` as source of truth; Playwright
(global Chromium) via a temp public `/preview-home` route to verify the running
build, then reverted.

Rewrote `frontend/src/routes/HomeRoute.tsx` from the old list-based layout to
match the Figma Home:
- **Greeting** — amber uppercase eyebrow now driven by the live date
  (`weekday + time-of-day`, e.g. "TUESDAY EVENING") over a serif
  "Ready to practice?".
- **Primary CTA** — amber card (Camera icon + "New piece" kicker,
  "Photograph sheet music", subline) linking to `/scores/new`.
- **Resume card** — paper-warm row with a manuscript strip thumb +
  "Pick up where you left off", built from `RECENT_SESSIONS[0]`.
- **Library** — serif section header + "See all", and a 2-up grid of cards
  (manuscript strip art + composer eyebrow + serif title), parsed from the
  "Composer — Title" demo data.
- Added a local `SheetStrip` (CSS repeating-gradient staff lines) that scales
  to any box, replacing per-row `ScoreThumb` on this screen.

Dropped the local-only favorite-star toggle (it wasn't persisted or wired to
anything and isn't in the design). `ScoreThumb` / `Eyebrow` remain for other
screens; only Home stopped importing them.

**Verified:** lint + build green; screenshot of the running page matches the
Figma (and is richer — live eyebrow, 4 cards, the real icon tab bar).
**Known gaps:** all links point at existing routes; the resume/library still
read from `lib/demo.ts` seed data (live `/v1/sessions` + `/v1/library` not
wired yet — pending Supabase keys). **Rollback:** revert this commit.

## 2026-07-28 — Figma mockups — three screens built into a new Figma file

**Branch:** claude/next-steps-3p2zhk (design artifact only — no code changed)
**Tooling:** Figma MCP (`use_figma` via the JS Plugin API), `figma-use` skill,
`get_screenshot` for the verify-after-each-step loop.

Created a new Figma file **"InTempo — App Screens"**
(`https://www.figma.com/design/k5IB3714DiusqnAwzkY7pz`) and built the three
core screens as 390×844 iPhone frames on one board, matching the locked
manuscript design system:

- **Home** — "Saturday evening / Ready to practice?" greeting, amber
  "Photograph sheet music" CTA, a resume card, and a 2-up library grid of
  score cards with mini-staves, over the paper tab bar.
- **Recording** — paper top bar (close / title+movement / menu), a manuscript
  score panel with the now-playing system washed amber, and the Deep Spruce
  recording surface: "Listening…" serif state line, 72 BPM readout with ±
  steppers, amber-tipped waveform, and the oxblood record button flanked by
  metronome / bookmark.
- **Verdict** — two-tone serif headline ("You *rushed a little* through the
  middle."), annotated score with two off-tempo systems washed amber and
  handwritten margin notes ("a touch ahead" / "breathe here"), three stat
  chips, and the result tab bar with Score active.

Palette locked to Paper Ivory / Graphite Ink / Rosined Amber (single accent) /
Deep Spruce (recording surface only) / Cupro Oxblood; type is Playfair Display
+ Inter (grotesque stand-in). Each screen was screenshot-verified in Figma;
the Home grid was trimmed from 4→2 cards so the tab bar sits in-frame.

**Known side effects / honesty note:** this is a static design mockup, not
running code — it's a reference to build the frontend rebuild against, not a
substitute for it. Score/Details/Next-steps tab states on Verdict, and the
calibration + metronome sub-states on Recording, are represented by their
default view only. **Rollback:** delete the Figma file; nothing in the repo
depends on it.

## 2026-07-28 — Verdict / Result screen — rebuilt to the locked design system

**Branch:** claude/next-steps-3p2zhk
**Toolchain (per user request):** `design-taste-frontend` (taste) for the pre-flight
discipline, `animate` (Emil Kowalski) for motion, `frontend-design` principles for
polish, and Playwright (global Chromium) for the screenshot-critique loop. Figma MCP
is connected but not used — there's no InTempo Figma file; the moodboard image is the
visual truth. No "impeccable" skill exists by that name; used `frontend-design`.

**What changed (all under `frontend/`):**
- Added **Framer Motion** (`motion` `^12`) — the app's first motion library, for the
  verdict reveal + shared-layout tab indicator (animate skill's recommended tools).
- `components/result/VerdictView.tsx`: **new.** The moodboard verdict composition —
  eyebrow, two-tone serif headline (amber phrase + graphite location, spring reveal),
  encouraging subhead, and tab-switched content, with staggered entrance (Kowalski:
  ease-out 0.42s enters, spring hero, `useReducedMotion` gate).
- `components/result/AnnotatedScorePanel.tsx`: **new.** Manuscript with the off-tempo
  region washed amber + hand-written margin notes ("a touch ahead" / "breathe here")
  on a faint paper backing so they read as pencil, not clash.
- `components/result/StatChips.tsx`, `TipBox.tsx`: **new.** Three stat chips + the
  pencil-tip box.
- `components/result/ResultTabs.tsx`: **new.** Listen / Score / Details / Next steps
  with a `layoutId` spring indicator (animate skill's shared-layout pattern), Phosphor.
- `lib/analysis.ts`: added `verdictHeadline` (amber phrase + location from the longest
  off-tempo run) and `deriveStats` (tempo range / steadiest bars / longest drift).
- `routes/ResultRoute.tsx`: **rebuilt** — thin polling shell (queued/processing →
  animated "Reading your tempo…"; failed/no-onsets → graceful message + record-again;
  ok → `VerdictView`), full-bleed with its own X-close chrome.
- `App.tsx`: `/analyses/:id` moved **out of `Layout`** (full-bleed). Deleted the
  superseded Batch-7 `VerdictCard.tsx` and `AnnotatedScore.tsx`.

**Critique-loop fix (screenshot vs. moodboard):** the "breathe here" margin note was
overlapping noteheads and reading as a bug — gave both annotations a faint paper
backing and repositioned into the right margin.

**Also:** aligned the copy to the em-dash ban ("You're musical. Let's refine the flow.",
"you're close, trust the pulse.").

**Tests run:** `npm run build` → passes; `npm run lint` → clean. Rendered at 440px via
a throwaway `/demo-verdict` route + Playwright, verified against the moodboard, temp
route removed.

**Rebuild status:** Home ✅, Recording ✅, Verdict ✅. Still old Batch-7 UI:
Score-capture (`/scores/new`) and the Score-list. Those are next.

## 2026-07-28 — Recording screen — rebuilt to the locked design system

**Branch:** claude/next-steps-3p2zhk
**Continues the UI rebuild** (after Home) following `frontend/DESIGN_SYSTEM.md`,
one screen at a time with a screenshot-critique loop.

**What changed (all under `frontend/`):**
- **Palette aligned to the locked hexes** in `src/index.css` + `src/styles/tokens.ts`:
  Paper Ivory `#F6F4EC` and Graphite Ink `#1C1C1A` (were `#EDE8DA`/`#211F1B`).
  This is the DESIGN_SYSTEM.md-locked palette; affects all screens consistently.
- `components/record/ScorePanel.tsx`: **new.** Manuscript notation panel (staff +
  clef + noteheads in the locked palette) with the "now playing" system washed
  in amber. Placeholder until real OCR page crops.
- `components/record/RecordingPanel.tsx`: **rebuilt** to the moodboard Deep-Spruce
  surface — bow/tempo arc (amber dot, animates while listening), serif state line
  ("Ready when you are" / "Listening…" / "Take a listen"), tempo readout with ±
  steppers + a needle dial + meter readout, controls row (metronome toggle / red
  mic record / bookmark), a "set tempo by ear" calibrate link, and the "we'll let
  you know" footer. Phosphor icons throughout. Keeps the working `useRecorder`,
  `VisualMetronome`, `WaveformPreview`, playback + Redo/Analyze.
- `routes/RecordRoute.tsx`: **rebuilt** — full-bleed screen with its own top bar
  (X close / title + movement / more), the ScorePanel, and the RecordingPanel.
  Keeps `useScore`, tempo seeding from `bpm_hint`, calibration flow, submit→poll.
- `App.tsx`: `/scores/:id/record` moved **out of `Layout`** so it's full-bleed
  (no wordmark header/footer) with its own chrome.
- `index.css`: added the `animate-bow` keyframe (offset-path arc travel).

**Critique-loop fixes applied** (screenshot vs. moodboard): removed the redundant
Layout wordmark header/footer (full-bleed now); removed an em-dash from the "Play
at ♩=100" copy (locked-system em-dash ban); back icon → X (close), per moodboard.

**Tests run:** `npm run build` → passes; `npm run lint` → clean. Rendered at
440px via a throwaway `/demo-record` route + Playwright; verified against the
moodboard, then the temp route was removed.

**Still the old Batch-7 UI (not yet rebuilt):** the Verdict/Result screen,
Score-capture screen. Those are the next screens in the locked sequence.

## 2026-07-28 — Home / Library screen — built to the locked design system

**Batch:** UI (Home / Library) — approved by the user before starting, per CLAUDE.md §2. User chose the **phone-frame + bottom-tab** framing over adapting the existing web chrome.
**Branch:** claude/next-steps-3p2zhk

**What changed (all under `frontend/`):**
- **`routes/HomeRoute.tsx`** — rewritten from the two-card placeholder into the moodboard's Home/Library screen:
  - Serif italic greeting (time-of-day aware, name from the signed-in email, "Maia" fallback) with the "barline that breathes" mark + a round monogram avatar linking to `/account`.
  - **Recent Sessions** card — piece title (serif), timestamp, one-line teacher's-margin verdict (amber when there's something to refine, ink when steady), chevron. "See all" → `/scores`.
  - A **manuscript rule** (hairline + centered diamond) separating the two sections — the "barline" motif from the moodboard.
  - **Your Library** rows — manuscript thumbnail, title (sans), movement, "Last practiced …", and an interactive favorite star (Bruch pre-favorited; tapping toggles local state).
- **`components/TabBar.tsx`** (new) — bottom tab bar (Library · Record · Insights · Profile), Phosphor icons, `NavLink` active state in amber (filled icon).
- **`components/AppShell.tsx`** (new) — phone-width (`max-w-[440px]`) column framed against the page ground with the tab bar pinned (`sticky bottom-0`); calls `useMe()` like `Layout`. The tabbed surfaces (Home, Scores list, Insights, Account) now render inside this shell.
- **`components/ui/ScoreThumb.tsx`** (new) — self-contained engraved-paper thumbnail (staff + abstracted clef + deterministic noteheads) in the locked palette, standing in until real OCR page-crops are wired.
- **`lib/demo.ts`** (new) — built-in demo repertoire (Dvořák, Bach, Bruch, Saint-Saëns, Mozart) for Recent Sessions + Library, per the "demo-mode" note in `DESIGN_SYSTEM.md`. Isolated so it swaps cleanly for the real `GET /v1/sessions` + `/v1/library` queries.
- **`App.tsx`** — split routing: tabbed surfaces under `AppShell`, full-viewport flow screens (capture, record, result, showcase) keep the plain `Layout`. Added an `/insights` stub.
- **`package.json`** — added `@phosphor-icons/react` (DESIGN_SYSTEM mandates Phosphor, "never Lucide"; existing screens still use Lucide and will migrate as they're rebuilt).

**Why:** First screen of the fresh UI rebuild against the locked "engraver's manuscript" system. Home is the anchor screen and sets the tab-nav + phone-frame pattern the Recording/Verdict screens will inherit.

**Tests run / verification:**
- `npm run build` → **passes**; `npm run lint` → **clean**.
- Screenshotted the running Home via a throwaway `/preview/home` route (auth-free) + Playwright (playwright-core against the repo's chromium) at 430×932, and ran the DESIGN_SYSTEM critique loop vs. the reference image. Two rounds: added the manuscript rule and tuned the greeting scale. Temp route, screenshot script, and playwright-core all removed before commit (only the Phosphor dep remains in the diff).

**DoD status — honest:**
- ✅ Home/Library visual matches the moodboard (greeting+avatar, Recent Sessions with amber verdicts, Your Library with thumbnails + favorite, bottom tab bar).
- ✅ Favorite star is interactive; tab bar active state works on real routes.
- ⚠️ **Data is demo/seed, not live** — no `GET /v1/sessions`/`/v1/library` endpoints yet, and Home is auth-gated (Supabase keys still pending, same caveat as Batches 5–7), so the signed-in screen isn't exercised end-to-end here.
- ⚠️ Avatar is a monogram, not a photo (no user-photo source yet). Library thumbnails are stylized placeholders, not real score crops.

**Known side effects / watch:** Moving `/account` + `/scores` under `AppShell` removes their top web header in favor of the tab bar — intended. Existing flow screens still use Lucide icons; the app now ships both icon sets until they're migrated (minor bundle cost).

**Rollback:** additive + isolated. `git revert <SHA>` restores the placeholder Home and the all-`Layout` routing; new files (`TabBar`, `AppShell`, `ScoreThumb`, `demo.ts`) are unreferenced after that.

## 2026-07-24 — Batch 7 — recording + analysis/verdict flow (web)

**Batch:** Batch 7 (UI — approved by the user before starting, per CLAUDE.md §2)
**Branch:** claude/next-steps-3p2zhk

**What changed (all under `frontend/`):**
- **Record side** (`routes/RecordRoute.tsx`): loads the score, seeds tempo from `bpm_hint`, orchestrates tempo/calibration/metronome + the recording panel, submits, and navigates to `/analyses/:id`.
  - `components/record/TempoSelector.tsx` — BPM input, ± steppers, tap-tempo, "play it instead" (calibrate).
  - `components/record/CalibrationFlow.tsx` — 2-sec clip → `POST /v1/calibration`; renders the backend's message + octave alternates + retry (all 12 edge-case codes come from the server).
  - `components/record/RecordingPanel.tsx` — MediaRecorder record → live waveform → 5-min cap + 4:30 warning → playback → redo/Analyze, in the spruce environment surface.
  - `components/record/MetronomeToggle.tsx` (off/visual; haptic hidden on web) + `VisualMetronome.tsx` — full-screen amber border flash driven by `useVisualMetronome` (`audioContext.currentTime` lookahead scheduler, **plays no sound**, so it adds nothing to the recording).
  - `components/ui/WaveformPreview.tsx` — canvas waveform from the recorder's AnalyserNode.
- **Result side** (`routes/ResultRoute.tsx`): `useAnalysisPolling` (2s interval, pauses on tab blur, stops at terminal status) → "Analyzing… ~12s" → the payoff.
  - `components/result/VerdictCard.tsx` — the headline verdict (largest text, coloured by direction).
  - `components/result/AnnotatedScore.tsx` — per-measure colour boxes (green/amber/orange/oxblood) + legend, horizontally scrollable.
  - `components/result/TrendChart.tsx` — **on-brand inline SVG** (no chart lib): amber line, dashed zero, faint grid, emphasised peak.
  - `components/result/PerNoteDetail.tsx` — collapsible per-onset ms deltas.
- **Hooks/lib:** `useRecorder.ts` (MediaRecorder + timer + analyser + 5-min cap), `useVisualMetronome.ts`, `hooks/useRecordingApi.ts` (`useScore`, `useAnalysisPolling`, `useCalibration`, `useAnalysisSubmit`), `lib/upload.ts` (`uploadAudioClip`), `lib/analysis.ts` (AnalysisResult mirror + band colours/labels).

**Why:** Batch 7 is the core loop and the app's signature moment — record against a score, get the tempo verdict. `/v1/analyses` is async, so this batch uses the polling loop (unlike the synchronous score OCR in Batch 6).

**Tests run / verification:**
- `npm run build` → **passes**; `npm run lint` → **clean** (fixed two `set-state-in-effect` findings: metronome flash now re-triggers via a `key`-ed CSS animation; tempo seeds during render).
- Rendered the full record setup + verdict screen via a throwaway `/demo-rr` route (mock AnalysisResult) + Playwright: tempo/metronome card, spruce record panel, verdict headline, annotated per-measure boxes, drift trend chart, and per-note detail all render on-brand. Demo removed before commit.

**DoD status — honest:**
- ✅ Record + calibration + visual metronome + submit + result screen (VerdictCard/AnnotatedScore/TrendChart/PerNoteDetail) built and rendered.
- ✅ Polling pauses on tab blur; graceful `alignment_failed`/`no_onsets` and `failed`/`failed_recoverable` states.
- ✅ Calibration surfaces the server's edge-case messages + octave picker (well over 5 of the 12).
- ⚠️ **True end-to-end (real mic → MediaRecorder → upload → analysis → poll → render) is NOT verified** — no mic/Supabase/backend here. Same storage-handshake caveat as Batch 6 (signed read URL for the audio). iOS Safari MediaRecorder (14.3+) needs a device.
- Not tagging `batch-7-done` until the live loop is confirmed.

**Known side effects / watch:** MediaRecorder emits `audio/webm`; the backend decodes via librosa→ffmpeg (needs ffmpeg in the deploy image — already flagged in DECISIONS from Batch 4). Bundle is ~740KB (unchanged concern).

**Rollback:** additive under `frontend/`. `git revert <SHA>` restores the Batch 5 stub Record/Result routes.

## 2026-07-24 — Batch 6 — score capture flow (web)

**Batch:** Batch 6 (UI — approved by the user before starting, per CLAUDE.md §2; "upload-first, camera light")
**Branch:** claude/next-steps-3p2zhk

**What changed (all under `frontend/`):**
- `routes/ScoreCaptureRoute.tsx`: rewritten as the capture state machine — `capture → processing → edit → saved` (+ `error`). Orchestrates upload, the low-confidence banner, the editor, and save.
- `components/score/ImageUploader.tsx`: primary input — file picker with `capture="environment"` (rear camera on mobile, dialog on desktop) + drag-and-drop.
- `components/score/CameraCapture.tsx`: light `getUserMedia({facingMode:"environment"})` live camera with a 4-corner guide, mounted only on a user tap (iOS gesture rule); falls back to the uploader on denial/unavailability.
- `components/score/ScoreEditor.tsx`: editable measures/notes — tap a note to fix pitch (validated against the backend pitch regex) or duration, toggle rest/tie, add/delete notes.
- `components/score/ScorePreview.tsx`: compact read-only render (MVP list view; Verovio engraving stays V2 per spec).
- `components/score/ScoreSaveBar.tsx`: sticky title + Save.
- `components/ui/ProgressBar.tsx` (+ `intempo-progress` keyframe in `index.css`): indeterminate bar for the long OCR request.
- `hooks/useScoreUpload.ts`: `useScoreUpload` (normalize image → presigned PUT → signed read URL → POST /v1/scores) and `useScoreSave` (PATCH /v1/scores/:id). `lib/image.ts`: `toUploadBlob` — `createImageBitmap({imageOrientation:"from-image"})` → canvas re-encode, which bakes in EXIF rotation and strips the tag (the iOS pitfall) and downscales the long edge to 2000px. `lib/score.ts`: TS mirror of `ScoreJson` + duration/pitch helpers.

**Why:** Batch 6 turns a photo into an editable, saved score — the front half of the product loop. Our `POST /v1/scores` is synchronous (OCR returns inline), so there's no polling: the UI shows a "reading your score" state on one long request.

**Tests run / verification:**
- `npm run build` → **passes**; `npm run lint` → **clean**.
- Rendered the full capture + editor UI via a throwaway public `/demo-capture` route (mock parsed score) + Playwright: the dropzone, low-confidence banner, note chips with the inline pitch/duration editor, and the save bar all render on-brand. Demo route removed before commit.

**DoD status — honest:**
- ✅ Capture UI, parsed-score editor, note editing, low-confidence banner, and save flow built + rendered.
- ✅ EXIF orientation stripped client-side; image downscaled before upload.
- ✅ `<input capture="environment">` fallback + a light getUserMedia camera.
- ⚠️ **True end-to-end (real upload → OCR → edit → save → reload) is NOT verified** — needs live Supabase keys + storage RLS, absent here. Also flagged: the upload→/v1/scores handshake assumes the frontend can mint a signed *read* URL (`supabase.storage…createSignedUrl`) the backend can fetch; if the score-images bucket/RLS doesn't allow that, either the bucket policy or /v1/scores (accept object_key + sign server-side) needs a small adjustment. Verify when wiring real keys.
- ⚠️ iPhone Safari camera test needs a real device.
- Not tagging `batch-6-done` until the live path is confirmed.

**Deferred (per §1.3):** crop / brightness-contrast sliders → V1.1; Verovio notation → V2; Cypress E2E → with live Supabase.

**Rollback:** additive under `frontend/`. `git revert <SHA>` restores the Batch 5 stub `ScoreCaptureRoute`; nothing else depends on the new files.

## 2026-07-24 — Batch 5 — web frontend foundation (design system + shell)

**Batch:** Batch 5 (UI — approved by the user before starting, per CLAUDE.md §2)
**Branch:** claude/next-steps-3p2zhk

**What changed (all under `frontend/`):**
- **Design tokens locked** (the "manuscript" direction from the approved prototype — supersedes spec §5's placeholder cream/gold palette; see DECISIONS): `src/styles/tokens.ts` (TS source of truth), `tailwind.config.js` (theme mapped to CSS vars), `src/index.css` (CSS vars + base + focus ring + reduced-motion). Playfair Display embedded via `@fontsource`; body = system SF as the Suisse Int'l stand-in.
- **UI primitives** built to the tokens: `components/ui/Button.tsx` (primary/ghost/stop + button-in-button trailing icon), `Card.tsx` (optional double-bezel), `Eyebrow.tsx`, `Badge.tsx` (verdict tones, quarantined). Plus `components/Wordmark.tsx` (barline-that-breathes).
- **Shell:** `components/Layout.tsx` (header + main + footer), `Header.tsx` (wordmark + auth state), `ProtectedRoute.tsx` (redirects to /login), `StubPage.tsx`.
- **Routing** (React Router v7) in `App.tsx`: `/`, `/login`, `/scores`, `/scores/new`, `/scores/:id`, `/scores/:id/record`, `/analyses/:id`, `/account`, plus a public `/showcase` for design review and a `*` → `/` catch-all. Protected routes gated by auth.
- **Auth + data plumbing:** `lib/supabase.ts` (client; `supabaseConfigured` guard so the app builds/runs without keys), `hooks/useAuth.ts` (session listener + magic-link sign-in/out via Zustand `stores/authStore.ts`), `lib/api.ts` (added `authedFetch` attaching the Supabase JWT), `hooks/useApi.ts` (`useMe` via tanstack-query, hydrates the store), `lib/analytics.ts` (PostHog wrapper, no-op without a key).
- Route stubs (`routes/*Route.tsx`) styled with the primitives; `index.html` title/description/theme-color set; `.env.example` added.
- Deps added: react-router-dom, @supabase/supabase-js, @tanstack/react-query, zustand, lucide-react, @fontsource/playfair-display, posthog-js.

**Why:** Batch 5 is the frontend shell + the locked design system every later UI batch builds on. Auth/routing/data plumbing structured per spec §5; the visual language is the manuscript direction the user signed off on across the prototype iterations.

**Tests run / verification:**
- `npm run build` → **passes** (tsc -b + vite build; one >500KB bundle warning — expected with supabase+posthog+react-query, deferred per "don't optimize early").
- `npm run lint` → **clean**.
- Rendered via `vite preview` + Playwright: captured `/showcase` (palette, Playfair type, buttons, verdict badges) and `/login` (magic-link form + honest "auth not configured" notice, protected `/`→`/login` redirect working). Both faithful to the design system.

**DoD status — honest:**
- ✅ All stubbed routes accessible, no 404s (catch-all redirect).
- ✅ Header shows the signed-in email; logout clears session; refresh persists (Supabase-managed) — built and type-correct.
- ✅ Design tokens established and rendered.
- ⚠️ **Magic-link login end-to-end + the E2E happy-path test are NOT verified** — this container has no Supabase project/keys and no redirect-URL config. Auth is fully wired and compiles; it needs `VITE_SUPABASE_*` + a dashboard redirect allow-list to run live. Not tagging `batch-5-done` until that's confirmed locally.

**Known side effects / watch:**
- Suisse Int'l is a system-SF stand-in until licensed (one line in tokens to swap).
- 711KB JS bundle — fine for MVP; code-split before launch.
- No frontend automated tests yet (CI runs `npm run build` only); the login E2E test lands with the Supabase wiring.

**Rollback:** additive under `frontend/` plus a deps bump. `git revert <SHA>` restores the Batch 0 scaffold; backend is untouched.

## 2026-07-24 — Batch 4 — async analysis API + calibration (BackgroundTasks)

**Batch:** Batch 4
**Branch:** claude/next-steps-3p2zhk

**What changed:**
- `backend/app/workers/analysis_runner.py` + `workers/__init__.py`: **new.** `run_analysis(analysis_id)` — a **sync** function (FastAPI runs sync background tasks in a threadpool, so the CPU-bound `analyze()` never blocks the event loop — the #1 Batch 4 pitfall, handled without `run_in_executor`). Fetches the row → `processing` → downloads audio → loads the score → runs `analyze()` → writes `done` + `result_json` + `alignment_quality` + `finished_at`. Failures (audio unavailable, internal) → `status='failed'` + `failure_reason`, never a silent hang. Body is Celery-shaped for a mechanical Phase-2 migration. Also `sweep_stuck_analyses()` — marks `queued`/`processing` rows older than 10 min `failed_recoverable`.
- `backend/app/routers/analyses.py`: **new.** `POST /v1/analyses` (validates audio_url is the caller's audio-uploads URL + score ownership, inserts `queued`, enqueues `run_analysis` via `BackgroundTasks`, returns `202 {analysis_id, status:queued}`) and `GET /v1/analyses/:id` (owner-scoped poll).
- `backend/app/services/calibration.py`: **new.** Pure `calibrate(y, sr) -> CalibrationResult` implementing the §4 edge cases (too short / too quiet / too few onsets / inconsistent IOIs / out of range / too many onsets / octave-ambiguity alternates / ok). HTTP-free so every branch is unit-tested against a synthesized clip.
- `backend/app/routers/calibration.py`: **new.** `POST /v1/calibration` — thin wrapper; returns `200` with `ok:false + code + message` for expected rejections (a too-quiet clip is a normal outcome the UI toasts, not an HTTP error).
- `backend/app/services/audio.py`: added `load_audio_bytes()` (decode an in-memory storage blob via a temp file). `backend/app/services/analysis.py`: `analyze()` now also accepts a preloaded `(waveform, sr)` tuple so the worker decodes once instead of twice.
- `backend/config.toml` + `services/audio_config.py`: added calibration `min_peak_dbfs` / `min_rms_dbfs` / `octave_ambiguity_threshold` to support the edge cases.
- `backend/app/main.py`: registered the two routers; converted startup to a `lifespan` handler that runs the stuck-job sweeper on boot (replaces the deprecated `on_event`).
- `backend/app/tests/`: **new** `test_analyses_api.py` (enqueue/validation/auth, full queued→done flow via a stateful `fake_supabase.py`, worker-failure path, sweeper) and `test_calibration.py` (edge-case branches + route). `fake_supabase.py` is a small in-memory fake of the supabase-py query surface.

**Why:**
Batch 3's `analyze()` is synchronous and CPU-bound; running it inline would block the request. Batch 4 makes the API return immediately and process in the background, pollable by id — the shape the web/mobile clients need. BackgroundTasks (not Celery) per spec §11: in-process, ships now; Celery migration is triggered later on documented latency/volume/replica criteria (the runner is already structured for that swap).

**Tests run:**
- `cd backend && uv run pytest -q` → **163 passed** (was 144; +19).

**DoD status:**
- ✅ `POST /v1/analyses` returns `analysis_id` before the analysis runs (202, enqueue is two DB calls).
- ✅ Background task completes well under 30s (analyze <15s).
- ✅ Polling shows `queued → processing → done` (worker writes `processing` then `done`; failures write `failed`).
- ✅ Calibration edge cases return correct error/warning codes (see caveat).
- ✅ Failing analyses surface `status='failed'` + reason.
- ✅ Stuck-job sweeper recovers crashed rows on startup.
- ⚠️ **Calibration:** the distinct *response codes* are all implemented and tested, but three of the spec's 12 rows are approximated rather than precisely detected — SNR/background-noise, "player choke" amplitude-variance, and the exact 2×/0.5× octave disambiguation. Documented; safe to refine during audio tuning.

**Known side effects / things to watch:**
- **Single replica only.** BackgroundTasks runs on whichever instance took the POST. A second replica *requires* the Celery migration (spec §11). Documented, not a bug.
- **No retries** on transient failures (network blip fetching audio) — the user retries manually. That's the intended MVP behavior; retries are what Celery is for.
- **Compressed audio needs ffmpeg.** `load_audio_bytes` decodes WAV/FLAC natively; the AAC/m4a the mobile client uploads needs ffmpeg in the deployed image (audioread fallback). Tests use WAV. Flagged in DECISIONS.md.
- `alignment_failed` / `no_onsets` are stored as DB `status='done'` with the pipeline status inside `result_json` — they're *completed analyses that can't be reported*, not server failures. DB `status='failed'` is reserved for exceptions. See DECISIONS.md.

**Rollback:** additive — new routers/worker/service/tests + a config + main.py wiring. `git revert <SHA>` removes it; Batches 0–3 don't import any of it.

## 2026-07-24 — Batch 3 — audio analysis core (`analyze()`)

**Batch:** Batch 3
**Branch:** claude/next-steps-3p2zhk

**What changed:**
- `backend/config.toml`: **new.** All tunable audio thresholds — onset `delta`/`pre_max`/`post_max`/`wait_ms`, double-bass overrides, the tolerance bands (rushing/dragging inner/mid/outer %), rolling-trend window, alignment quality cutoffs (`warn_quality` 0.7, `broken_quality` 0.4), Sakoe-Chiba band radius, and calibration limits. Values are the spec §4 STARTING points, not tuned. Every future change to a number here is logged in `TUNING_LOG.md`.
- `backend/app/services/audio_config.py`: **new.** `tomllib` loader → frozen dataclasses (`AudioConfig` and friends). `load_audio_config()` is `lru_cache`d; `load_audio_config_from(path)` lets tests load alternate files. Nothing in the services hard-codes a threshold — they all read config.
- `backend/app/services/audio.py`: **new.** librosa wrapper (layer 1). `load_audio` (22.05 kHz mono, no normalization), `pre_emphasis`, `high_pass` (scipy Butterworth, double-bass mode), `detect_onsets` (`onset_detect` with config peak-pick params; `wait_ms`→frames converts the pizzicato-ring guard), `estimate_bpm` (beat_track → median-IOI fallback → None) for the §4 calibration flow.
- `backend/app/services/alignment.py`: **new.** (layer 2) `build_timeline`/`compute_expected_onsets` walk the score into expected onset times — honoring rests (advance clock, no onset), ties (`tied_to_next` → no re-attack), and slur interior/boundary flags. `align_dtw` runs a Sakoe-Chiba-constrained `librosa.sequence.dtw` and returns a monotonic detected→expected mapping + a 0..1 quality. `apply_fuzzy_match` resolves many-to-one (extra/false-trigger) and one-to-many (missed) count mismatches. `is_alignment_broken` gates on `broken_quality`.
- `backend/app/services/classification.py`: **new.** (layer 3) `classify_band` (asymmetric rushing/dragging bands → `on`/`slight`/`rush_drag`/`severe`), `compute_deltas` (per-note ms + %-of-beat, origin anchored on first matched note), `rolling_trend` (rush-positive rolling mean, slur interiors excluded), `generate_verdict` (longest same-direction run → BPM-phrased one-liner, never %).
- `backend/app/services/analysis.py`: **new.** `analyze(audio_path, score, target_bpm, *, double_bass=False)` orchestrator returning a Pydantic `AnalysisResult` (`status`, `quality`, `low_confidence`, `verdict`, `per_note`, `per_measure`, `trend`, onset/miss/extra counts). Graceful `no_onsets` / `alignment_failed` statuses instead of exceptions.
- `backend/app/tests/audio_helpers.py` + `test_audio.py` / `test_alignment.py` / `test_classification.py` / `test_analysis.py`: **new.** 37 tests. Synthetic click-track fixtures (deterministic, no WAVs in the repo) exercise onset counts (±2 DoD), expected-onset math incl. rests/ties/slurs, DTW identity + fuzzy match, band boundaries, sign convention, verdict runs, and the full pipeline (ok / no_onsets / alignment_failed, JSON serialization, <15s DoD).
- `backend/pyproject.toml` + `uv.lock`: added `librosa>=0.11.0`, `numpy>=2.4.6`, `scipy>=1.18.0` (pulls numba, soundfile, scikit-learn).

**Why:**
Batch 3 is the app's core — turning a recording + a score into "did you rush or drag?" It's synchronous now; Batch 4 wraps it in `BackgroundTasks`. Every threshold is externalized to `config.toml` precisely because these numbers are wrong until tuned against real recordings — see the DoD note below.

**Tests run:**
- `cd backend && uv run pytest -q` → **144 passed** (was 107; +37).

**DoD status — honest accounting:**
- ✅ `analyze()` runs end-to-end on a fixture pair, well under 15s (test asserts it).
- ✅ Output serializes cleanly (`AnalysisResult.model_dump_json()`, tested).
- ✅ Alignment-broken path returns gracefully (`alignment_failed` / `no_onsets`, no crash).
- ✅ All thresholds externalized to `config.toml`.
- ⚠️ **"All 10 real fixture recordings produce reasonable verdicts (subjective ear check)" is NOT done.** That requires the six-clip corpus + a human ear (see the Batch 3 Tuning Appendix) and is deliberately deferred to the tuning loop. The current config values are the spec's untuned defaults. `TUNING_LOG.md` records this as the starting baseline. The synthetic-fixture tests prove the pipeline is *correct*, not that the *thresholds* are right.

**Known side effects / things to watch:**
- `pre_max`/`post_max=20` (~0.46s peak-pick window) merges onsets closer than ~0.46s — fine at real tempos but it means the pipeline can't resolve very fast passages until those are tuned. Surfaced here so a fast-passage bug isn't a surprise.
- Beat math assumes `target_bpm` is quarter-notes-per-minute and a quarter = 1 beat regardless of the notated denominator; compound meters (6/8) are a documented V2 gap.
- CI now installs librosa + numba; first `uv sync` on CI is heavier. Wheels ship native libs on linux so no apt packages needed.

**Rollback:** the whole batch is additive (six new service/test files + config.toml + a dep bump). `git revert <SHA>` removes it cleanly; nothing in Batches 0–2 imports these modules yet.

## 2026-04-27 22:40 — Batch 2 — lock provider chain, cache real responses, e2e verification

**Batch:** Batch 2
**Branch:** feat/batch-2-ocr-pipeline
**Commit (after this edit):** `d22c163` — `feat(batch-2): lock OCR_PROVIDER_CHAIN to Gemini Flash primary, cache real responses, add fixture-drift test`.

**What changed:**
- `backend/.env.example`: `OCR_PROVIDER_CHAIN` set to `gemini-2.5-flash,claude-sonnet-4-6,claude-opus-4-7`. Comment above documents why this order: Gemini Flash primary (10× cheaper, 2× faster from bake-off v2); Claude Sonnet fallback when Gemini errors or confidence<0.7; Opus last resort. Reference to `docs/ocr-bakeoff/2026-04-27-bakeoff-v2.md` included.
- `backend/.env` (local-only, gitignored): same value applied locally.
- `fixtures/ocr_responses/c786b0e0…json` etc. (5 files): cached real `OCRResponse` JSON for each fixture, keyed by SHA-256 of the image bytes. All 5 produced by `gemini-2.5-flash` on first try (no Claude fallback needed). Each cache file: `{fixture_filename, fixture_sha256, cached_at, ocr_response}`.
- `fixtures/ocr_responses/SOURCES.md`: per-cache provenance table — fixture → sha256 → provider → confidence → measure/note count → cost → latency.
- `backend/app/tests/test_ocr_fixtures.py`: new. 12 cases (2 fixed + 5×2 parametrized over each cache file). Validates each cached response round-trips through current `OCRResponse` + `ScoreJson` schema (catches schema drift), and smoke-checks the parse is real (non-empty measures with notes, OR honest empty-with-low-confidence-and-explanation for the worst-case Beethoven sketches fixture which Gemini correctly returned `measures: []` for).

**Why:**
The bake-off justified swapping the primary from Claude (the spec's default) to Gemini Flash. Caching real responses + a regression test that exercises the current schema against them means future schema changes can't silently break what the providers actually emit — drift gets caught at PR time, not in production. The cache is also a token-cost guard: CI runs Pydantic validation, never calls a real LLM.

**Tests run:**
- `cd backend && uv run pytest -q` → **107 passed in 5.86s** (was 95; +12 new fixture tests).
- Live e2e against the local backend on http://127.0.0.1:8000 (3 runs to characterize Gemini latency variance):
  - All 4 CRUD ops succeeded: POST 201 → GET 200 → PATCH 200 → DELETE 204
  - End-to-end POST `/v1/scores` latency: **10.2s, 11.8s, 13.9s** across three runs
  - **DoD <10s misses on all three runs.** Gemini Flash OCR alone runs 7-14s in real traffic (matches the bake-off variance: 6.7-12.4s); image-download from the signed URL adds ~700ms; DB insert adds ~100ms. Total budget for everything-but-OCR is <500ms; the OCR call is the load-bearing piece.
  - All test data cleaned up (auth user deleted, storage object deleted, public.users CASCADEd via the FK from migration 003).
- Fixture cache costs: $0.0050 + $0.0056 + $0.0054 + $0.0039 + $0.0007 = **$0.0206 total** to populate the 5-file cache. Per fixture: 802-2040 output tokens, 3-12s latency.

**Known side effects / things to watch:**
- **`/v1/scores` POST exceeds the spec's <10s DoD.** Three consecutive runs hit 10.2s / 11.8s / 13.9s. The bottleneck is Gemini Flash OCR latency (7-14s), which is external and unpredictable. Switching primary back to Claude doesn't fix it — Claude Sonnet was 17-29s in the bake-off, much worse. Real fix is moving OCR to a background task (FastAPI `BackgroundTasks` per spec §11) and returning 202 + a polling endpoint instead of 201 + the full result. That work is scoped for Batch 4; surfacing here so it doesn't get forgotten.
- The first e2e run hit a 500 with `scores_user_id_fkey` violation because the test created a Supabase auth user but never called `/v1/me` to provision the `public.users` row. Real clients call `/v1/me` on app open before any other request, so this isn't a code bug — but the e2e script now mirrors that flow with a `/v1/me` call between auth and `/v1/scores`. Worth documenting in client-facing docs eventually.
- All 5 fixtures cached on Gemini's first try — no Claude fallback was exercised. The fallback path is unit-tested in `test_pipeline.py`; the cache is just a real-data sanity check.
- Fixture #05 (Beethoven sketches) cached as `measures: []` with confidence 0.5 and a long `notes_to_human` saying the image is "highly stylized and not easily readable as conventional sheet music." This is a legitimate honest "I can't read this" — the test allows it (smoke check carved out for empty-with-low-confidence-and-explanation).

**Rollback:** `git revert <SHA>` removes the cache + fixture test + env update in one shot. The OCR pipeline keeps working with whatever `OCR_PROVIDER_CHAIN` is set in `.env` (or the default in `app/config.py`).

## 2026-04-27 11:50 — Batch 2 — schema escape hatch + Gemini token cap, disable thinking

**Batch:** Batch 2
**Branch:** feat/batch-2-ocr-pipeline
**Commit (after this edit):** `0346574` — `fix(ocr): allow "unknown" signatures + raise Gemini token cap, disable thinking` (preceded by `c13943c` — `chore(fixtures): swap to user-curated PD images (Bach BWV 1001 + Petter Sketchbook)`).

**What changed:**
- `backend/app/services/score_schema.py`: `time_signature` and `key_signature` now accept `"unknown"` (any case) or `null`/missing. Strict regex (`^\d+/\d+$`) still applies when the model returns a real value. Two new `field_validator`s enforce this. No other field was relaxed.
- `backend/app/prompts/ocr_prompt.txt`: added one Rules line authorizing the model to return `"unknown"` for the time and key signatures specifically when illegible (cropped, handwritten unclear). Explicitly forbids `"unknown"` for other fields so this isn't read as a general escape hatch.
- `backend/app/services/ocr/gemini_provider.py`: bumped `MAX_OUTPUT_TOKENS` from 4000 → 16000 and added `thinking_config=types.ThinkingConfig(thinking_budget=0)` to `GenerateContentConfig`. Verified `ThinkingConfig` API surface against the installed `google-genai 1.73.1` SDK before the change.
- `backend/app/tests/test_score_schema.py`: 7 new cases covering the escape hatch — `"unknown"` (any case) and `null`/missing accepted for both fields, whitespace-only key_signature still rejected (model glitch vs. honest "I can't read this").
- `backend/app/tests/test_gemini_provider.py`: existing happy-path test updated to assert the new `max_output_tokens=16000` and `thinking_config.thinking_budget==0`.
- `docs/ocr-bakeoff/2026-04-27-bakeoff-v1-baseline.md`: prior bake-off renamed from `2026-04-27-bakeoff.md` to preserve the broken-baseline record.
- `docs/ocr-bakeoff/2026-04-27-bakeoff-v2.md`: new report after the fixes.

**Why:**
The first bake-off scored 0/5 for Gemini and 3/5 for Claude. Both failures were infrastructure / schema bugs, not model quality:
- Every Gemini failure inspected was response truncation — Gemini 2.5's thinking tokens count toward `max_output_tokens`, and 4000 ran out before the JSON closed. Disabling thinking + bumping the cap fixes it.
- Both Claude handwritten failures were valid `"time_signature": "unknown"` responses being rejected by our strict regex. The model was being honest about not being able to read the metadata header; the schema lacked the escape hatch. Adding it is the right model — we want to capture "couldn't see" as data, not as a parse error.

**Tests run:**
- `cd backend && uv run pytest -q` → **95 passed in 2.47s** (was 88; +7 schema escape-hatch cases).
- Bake-off v2 results (5 fixtures × 2 providers; details in `docs/ocr-bakeoff/2026-04-27-bakeoff-v2.md`):
  - Claude Sonnet: **5/5 schema pass**, avg conf 0.37, avg latency 18.8s, total cost $0.1432
  - Gemini Flash: **3/5 schema pass**, avg conf 0.92, avg latency 8.8s, total cost $0.0145
  - Gemini's two failures: one HTTP 503 (transient throttling), one `RemoteProtocolError` (server disconnect). Both are independent infrastructure failures, not model behavior.

**Known side effects / things to watch:**
- Schema loosening means `time_signature` / `key_signature` can now legitimately be `null` in stored score JSON. Any downstream code that assumed they're always present (Batch 3 audio analysis would care: target BPM derivation may need a fallback) needs to handle that explicitly. Currently nothing else reads them.
- Gemini's `thinking_budget=0` works on Flash. Pro accepts 0 too per Google docs. If a future Gemini model rejects `thinking_budget=0`, the call will fail — the test pins this contract so the failure surfaces loudly.
- The two Gemini bake-off failures are transient (503 / disconnect). Re-running may produce 5/5. The bake-off retry-with-backoff helps but doesn't eliminate them; preview API capacity for `gemini-2.5-flash` is uneven.
- Confidence comparison is interesting: Gemini reports much higher confidence (0.90-0.95) than Claude (0.05-0.62) on the same fixtures. This may be calibration drift — a Gemini "0.90" might not mean the same thing as a Claude "0.62" — or it may reflect Gemini's actually-better OCR. We'd need a separate ground-truth review of the parsed scores to know.

**Rollback:** `git revert <SHA>` rolls back the schema loosening, the prompt change, and the Gemini config bump in one shot. The v1 baseline report stays as a record either way.

## 2026-04-27 11:35 — Batch 2 — 5 OCR fixture images (PD-only, sourced from IMSLP + Wikimedia)

**Batch:** Batch 2
**Branch:** feat/batch-2-ocr-pipeline
**Commit (after this edit):** `2eb7dde` — `chore(fixtures): add 5 OCR test images sourced from IMSLP + Wikimedia (PD)`.

**What changed:**
- `fixtures/scores/01_simple_printed.jpg` — Wohlfahrt Op. 45 Étude No. 1, first line. From IMSLP `IMSLP19882-PMLP46562` (1880 publication; PD).
- `fixtures/scores/02_medium_printed.jpg` — Wohlfahrt Op. 45 mid-book (around #22–24), single system with slurred sixteenths, accidentals, fingerings.
- `fixtures/scores/03_complex_printed.jpg` — Kreutzer 42 Études No. 2 opening line. From IMSLP `IMSLP01503` (1796 work, early-20th-century PD edition — explicitly NOT the copyrighted Galamian edition).
- `fixtures/scores/04_handwritten_clean.jpg` — Anna Magdalena Bach's manuscript copy of Bach's Cello Suites. From Wikimedia Commons (PD-Old).
- `fixtures/scores/05_handwritten_messy.jpg` — Beethoven sketches for String Quartet Op. 131 (BL Add MS 38070 f.51r). From Wikimedia Commons (PD-Old).
- `fixtures/scores/SOURCES.md` — table of file → composer → work → source URL → license, plus a "substitutions / known imperfections" section and a reproducibility table with exact PDF page indices, render DPI, and crop fractions.

All five JPEGs are 1200 px wide, 85 % quality, between 35 KB and 62 KB each (combined: 244 KB — well under the 500 KB-per-file ceiling).

**Why:**
The OCR bake-off and the Batch 2 regression suite both need a fixed test set. Building the fixtures as a numbered, PD-sourced, document-tracked set means: (a) the bake-off is reproducible against the same images forever, (b) the regression suite for §6 (5 fixture scores parse correctly per Batch 2 DoD) lands with the spec's "3 printed + 2 handwritten" split satisfied, (c) anyone who picks up the project can verify the licenses without spelunking through the git history.

**Tests run:**
- Visual inspection of each cropped JPEG via `Read` tool — confirmed each shows real music notation (not blank pages, covers, or TOC), single staff with at most a small bleed of the next system at the edge (realistic for phone-photo simulation).

**Known side effects / things to watch:**
- Two of the cropped images (#02, #03) include a partial second staff at the bottom edge; #04 shows ink bleed-through from the previous system at the top edge. Tightening the crops further started clipping slurs from the target staff. The OCR prompt asks for "a single line of sheet music" so the model should focus on the dominant staff.
- #05 (Beethoven sketches) is intentionally the worst-case fixture: sparse staves with crossings-out and fragmentary motifs. Both OCR providers may legitimately come back with low confidence and a `notes_to_human` flagging the page as illegible — that's the correct behavior for that input.
- The throwaway `_fetch_fixtures.py` script that produced these files was deleted after generating the images. The reproducibility table in SOURCES.md captures the exact crops so the script can be re-derived if needed.

**Rollback:** `git revert <SHA>` removes all six files. The bake-off CLI will then exit with "no images found in fixtures/scores/" until fixtures are restored.

## 2026-04-26 21:30 — Batch 2 — provider abstraction + Gemini + bake-off harness

**Batch:** Batch 2
**Branch:** feat/batch-2-ocr-pipeline
**Commit (after this edit):** `92a085d` — `refactor(ocr): provider abstraction + Gemini provider + bake-off harness`.

**What changed:**
- `backend/app/services/ocr.py`: **deleted** — replaced with the `ocr/` package.
- `backend/app/services/ocr/__init__.py`: re-exports public API (`parse_sheet_music`, `OCRError`, all four built-in providers, `PROVIDER_REGISTRY`, `get_provider`, `OCRResponse`, `OCRProvider`, `OCRProviderError`).
- `backend/app/services/ocr/base.py`: `OCRResponse` Pydantic model (score + raw_text + model + token counts + cost_usd + latency_ms), `OCRProvider` Protocol, `OCRProviderError` exception, shared `PROMPT` loaded from `prompts/ocr_prompt.txt`.
- `backend/app/services/ocr/claude_provider.py`: `ClaudeProvider` class (one Anthropic call per `parse`, returns `OCRResponse`). Markdown-fence stripping kept defensively. Two registered instances: `claude_sonnet_provider` ($3/$15 per 1M tok), `claude_opus_provider` ($15/$75 per 1M tok). Pricing constants verified against Anthropic public pricing 2026-04.
- `backend/app/services/ocr/gemini_provider.py`: `GeminiProvider` class using `google.genai`. Uses native JSON mode (`response_mime_type="application/json"`) so no fence-stripping needed in steady state. Two registered instances: `gemini_flash_provider` ($0.30/$2.50 per 1M tok), `gemini_pro_provider` ($1.25/$10.00 per 1M tok ≤200k context). Pricing verified live against `https://ai.google.dev/gemini-api/docs/pricing` via WebFetch on 2026-04-26. Counts `thoughts_token_count` toward output tokens (Gemini 2.5 thinking tokens are billed as output).
- `backend/app/services/ocr/pipeline.py`: `parse_sheet_music(image_bytes, *, media_type, providers) -> ScoreJson`. Tries providers in order; first one to return a high-confidence (≥0.7) parse wins; first parseable low-confidence result is the fallback (matches old "low conf > nothing" carve-out per spec §6); only when nothing is parseable does it raise `OCRError`. Default chain reads `settings.OCR_PROVIDER_CHAIN` (env, comma-separated). `PROVIDER_REGISTRY` + `get_provider(name)` for the bake-off CLI.
- `backend/app/routers/scores.py`: updated for the new pipeline return type — was `ocr.score.model_dump()`, now `score.model_dump()` (pipeline returns `ScoreJson` directly, not the wrapper).
- `backend/app/config.py`: added `GEMINI_API_KEY` + `OCR_PROVIDER_CHAIN` (default `"claude-sonnet-4-6,claude-opus-4-7"` to preserve current behavior pre-bake-off).
- `backend/.env.example` + `backend/.env`: same two new env slots, with a comment pointing at `bakeoff/` for context on `OCR_PROVIDER_CHAIN`.
- `backend/pyproject.toml` + `uv.lock`: added `google-genai==1.73.1` (pulls `google-auth`, `pyasn1`, `pyasn1-modules`).
- `backend/app/tests/test_ocr.py`: **deleted** — superseded by the three new test files.
- `backend/app/tests/test_claude_provider.py`: new. 8 cases covering `_strip_markdown_fences` (3), `ClaudeProvider.parse` happy path with token-cost math, fence stripping, invalid JSON, no-content-parts error, no-text error, pricing-constants assertion.
- `backend/app/tests/test_gemini_provider.py`: new. 5 cases — happy path with JSON-mode config verified, thoughts tokens billed as output, invalid JSON raises ValueError, empty response raises OCRProviderError, missing API key raises before SDK call. Also asserts Pro pricing constants.
- `backend/app/tests/test_pipeline.py`: new. 9 cases — first high-conf wins (second never called), first fails validation → second succeeds, provider error → next, low-conf then high-conf returns high, all-low-conf returns first low-conf, low-conf then invalid returns low-conf, all-fail raises `OCRError` with all names in message, empty chain raises, env-driven default chain, unknown provider in env chain raises.
- `backend/app/tests/test_scores_router.py`: updated to drop the `from app.services.ocr import OCRResult` import and inline a plain `ScoreJson` in the OCR stub.
- `bakeoff/__init__.py` + `bakeoff/run_bakeoff.py` + `bakeoff/README.md`: new top-level `bakeoff/` package. CLI: `cd backend && uv run ../bakeoff/run_bakeoff.py [--fixtures-dir … --output … --include-premium --providers a,b,c]`. Discovers all images in `fixtures/scores/`, runs each through the configured provider list, writes a markdown report to `docs/ocr-bakeoff/<date>-bakeoff.md` (per-fixture detail tables + summary table with pass-rate, avg confidence, avg latency, total cost, total measures). Errors per provider don't abort the bake-off — every cell either passes or surfaces its error, so one provider going down doesn't kill the run.
- `docs/ocr-bakeoff/.gitkeep`: tracked dir for generated reports.

**Why:**
The user wants to bake off Gemini Flash vs Claude Sonnet on real fixtures before locking the OCR provider. Spec §11 already calls for "abstraction layer in the OCR module so we can swap to GPT-4V or a fine-tuned model later" — now is the right time to build it. The provider abstraction also gives us the toggle infrastructure (env-driven `OCR_PROVIDER_CHAIN`) for free, so post-bake-off the swap is a one-line `.env` edit, no code change. Refactor was contained: `parse_sheet_music` + `OCRError` keep their public names so the `/v1/scores` router barely changed (one `.score` → bare reference).

**Tests run:**
- `cd backend && uv run pytest -q` → **88 passed in 1.83s**, 0 warnings. Was 72 at end of the prior commit; +16 from the test split (8 Claude + 5 Gemini + 9 pipeline = 22 new — 6 from the deleted `test_ocr.py` since some cases moved to pipeline rather than provider).
- `cd backend && uv run ../bakeoff/run_bakeoff.py --help` → CLI imports cleanly, surfaces all four built-in providers in the `--providers` choices line.

**Known side effects / things to watch:**
- Gemini's `thoughts_token_count` may not be present on every response — handled with `getattr(..., 0) or 0`. If a future Gemini model emits this field with a different name, output-token billing will under-count. Tests pin the current behavior.
- The bake-off script lives at the repo root (not inside `backend/`) so it's clearly project-wide tooling. It works from `backend/` via `sys.path.insert(0, str(BACKEND_DIR))` plus an explicit `load_dotenv(BACKEND_DIR / ".env")`. Running it from anywhere else also works because all paths resolve from `Path(__file__).resolve().parent`.
- The bake-off doesn't hit any provider's `_client` directly — it just calls `provider.parse(...)`, so when API keys are missing the failure surfaces as a clean per-cell error in the report, not a crash.
- Pricing constants are hardcoded in the provider modules. If Anthropic or Google change prices, update the constants — the tests pin the current values to surface drift.
- `OCR_PROVIDER_CHAIN` default is unchanged (`claude-sonnet-4-6,claude-opus-4-7`) so production behavior is identical until the user picks a winner from the bake-off and edits `.env`.

**Rollback:** `git revert <SHA>` rolls back the package, the providers, the bake-off, and the env additions in one shot. Anything still importing `from app.services.ocr import parse_sheet_music, OCRError` (i.e. `routers/scores.py`) keeps working since the public API names are preserved.

## 2026-04-26 20:40 — Batch 2 — /v1/scores router (POST/GET/PATCH/DELETE)

**Batch:** Batch 2
**Branch:** feat/batch-2-ocr-pipeline
**Commit (after this edit):** `e6f6660` — `feat(batch-2): /v1/scores router (POST/GET/PATCH/DELETE) + URL safety + tests`.

**What changed:**
- `backend/app/routers/scores.py`: new. Five endpoints — `POST /v1/scores` (URL-safety check → download image → OCR → persist), `GET /v1/scores` (list, paginated `?limit&offset`, ordered by `created_at DESC`), `GET /v1/scores/:id` (owner-scoped read), `PATCH /v1/scores/:id` (whole-document `score_json` replacement + optional title/composer rename, per spec MVP), `DELETE /v1/scores/:id` (returns 204; FK violation from `analyses.score_id ON DELETE RESTRICT` surfaces as 409 with a clear message). Service-role client used for all DB ops with explicit `WHERE user_id = <jwt sub>` for parity with RLS. URL-safety check (`_assert_image_url_owned_by`) accepts only Supabase URLs whose path starts with `/storage/v1/object/{sign,authenticated,public}/score-images/<user_id>/` — anything else returns 403 *before* downloading. Image download capped at 12 MB / 6s timeout via `httpx`.
- `backend/app/main.py`: added `scores` to the import and `app.include_router` list.
- `backend/app/tests/test_scores_router.py`: new. 13 cases — POST: unauth 401, happy path 201 with insert payload verified, URL-prefix from another user 403, arbitrary external URL 403, OCR failure 422; GET list: returns owner rows; GET one: own 200, unknown 404, "other user's id" 404 (service-role read filters by user_id so RLS-parity holds); PATCH: replaces score_json + ocr_confidence, empty body 400, unknown 404; DELETE: owner 204, unknown 404, FK-violation 409.
- `fixtures/ocr_responses/.gitkeep`: directory tracked. Cached Claude responses keyed by image hash will live here once we have real fixture images + an API key.

**Why:**
The router glues every other Batch 2 piece together. Deliberate design choices: image URLs must be Supabase signed URLs under the user's own folder (so the backend can never be tricked into downloading and OCR-charging on arbitrary URLs); all DB ops use service-role + explicit user_id filter (faster than re-deriving an anon-key client per request, equivalent access semantics); `PATCH score_json` always re-derives `ocr_confidence` from the new payload (so user corrections that bring the score back to high confidence reflect in the row).

**Tests run:**
- `cd backend && uv run pytest -q` → **72 passed in 1.38s**, 0 warnings (one prior `HTTP_422_UNPROCESSABLE_ENTITY` deprecation warning fixed by inlining 422). Was 20 at end of Batch 1 → +52 from Batch 2 (19 schema + 9 ocr + 13 router + 11 from earlier suites still green).

**Known side effects / things to watch:**
- The 12 MB image download cap matches the 10 MB bucket limit with headroom. If we ever raise the bucket limit, raise this too.
- The DELETE → 409 path string-matches Postgres's "violates foreign key constraint" error message. If supabase-py wraps the error differently in a future SDK version, the catch may miss and surface 500 instead. Acceptable risk; the test enforces the current behavior.
- `_assert_image_url_owned_by` enumerates three Supabase storage URL shapes (`/sign/`, `/authenticated/`, `/public/`). Public buckets aren't in our setup but the prefix is allowed for consistency. If Supabase introduces a new URL form (e.g. `/private/`), uploads will fail this check until we add it.

**Rollback:** `git revert <SHA>` removes the router + tests + the main.py wiring. The OCR service and schema (prior commits) remain functional — they're just no longer reachable via HTTP.

## 2026-04-26 20:35 — Batch 2 — OCR service (Anthropic wrapper + Sonnet→Opus retry)

**Batch:** Batch 2
**Branch:** feat/batch-2-ocr-pipeline
**Commit (after this edit):** `84d9386` — `feat(batch-2): OCR service — Claude Vision wrapper + Sonnet→Opus retry`.

**What changed:**
- `backend/app/services/ocr.py`: new. `parse_sheet_music(image_bytes, *, media_type, primary_model, fallback_model) -> OCRResult`. Per spec §6 + Batch 2: try `claude-sonnet-4-6` first, retry with `claude-opus-4-7` on validation failure or `ocr_confidence < 0.7` (passing the failure reason as feedback in the retry prompt). After 2 failures, raise `OCRError`. Markdown fences stripped defensively (the spec calls this out as a known Claude quirk). Module-level lazy `_client` so unit tests monkeypatch without going through the real SDK constructor and CI never needs `ANTHROPIC_API_KEY`.
- `backend/app/tests/test_ocr.py`: new. 9 cases — `_strip_markdown_fences` covers fenced/un-fenced/json-labelled cases; clean Sonnet response → returns ScoreJson with one Claude call; markdown-fenced response → fences stripped; invalid Sonnet JSON → retry to Opus → success (verifies the second call carries "previous attempt failed" feedback in the prompt); low-confidence Sonnet → retry to Opus; both invalid → `OCRError` with both model names in the message; **edge case** — low-confidence Sonnet + invalid Opus → returns the low-confidence Sonnet result rather than raising (per spec's "surface to the user" intent — a parseable parse-with-low-confidence is still better than nothing for the human-correction flow).

**Why:**
The retry-to-Opus path exists because Sonnet is ~3× cheaper and handles printed music well, but handwritten scores need Opus's stronger vision. Trying Sonnet first preserves cost; retrying with explicit feedback gives Opus a hint about what went wrong (much cheaper than re-running blind). The "low-confidence Sonnet beats nothing" carve-out is a deliberate divergence from a strict "both must succeed" reading — see `OCRResult` semantics.

**Tests run:**
- `cd backend && uv run pytest app/tests/test_ocr.py -q` → 9 passed.
- Full suite green at this point too.

**Known side effects / things to watch:**
- The `_client` lazy-init means anything that touches `_get_client()` without monkeypatching it will instantiate a real `Anthropic()` and try to read `ANTHROPIC_API_KEY` from env. Tests stub the module attribute directly to avoid this.
- The retry includes the failure message verbatim in the prompt. If a future failure message contains JSON-like text (e.g. "expected `{'foo': ...}`") Claude may get confused. Acceptable risk for now; revisit if real-world failures surface that pattern.
- `parse_sheet_music` returns `OCRResult` (with model_used + raw_response), not just `ScoreJson`. Callers that only need the score read `result.score`. The extra fields exist for the fixture-caching workflow + future telemetry.

**Rollback:** `git revert <SHA>` removes the OCR service and tests; the score schema (prior commit) keeps working independently.

## 2026-04-26 20:30 — Batch 2 — score JSON schema + externalized OCR prompt

**Batch:** Batch 2
**Branch:** feat/batch-2-ocr-pipeline
**Commit (after this edit):** `22c0678` — `feat(batch-2): score_schema (Pydantic v2) + verbatim ocr_prompt.txt`.

**What changed:**
- `backend/app/services/__init__.py`: new (empty package marker).
- `backend/app/services/score_schema.py`: new. Pydantic v2 models for the score JSON shape from spec §6: `Note`, `Slur`, `Measure`, `Repeat`, `ScoreJson`. All use `model_config = ConfigDict(extra="forbid")` so a Claude response with hallucinated extra keys fails validation and triggers retry. Closed `Literal` enums for `clef`, `articulation`, `dynamics`, `repeat type`, and `duration` (the spec's "..." in duration is enumerated as the standard set: whole/half/quarter/eighth/sixteenth/thirty_second + dotted variants). Pitch validated by regex (`rest` or scientific-pitch like `D3`/`F#4`/`Bb2`). `ocr_confidence` clamped 0–1, `bpm_hint` clamped 20–300, `time_signature` regex-matched to `\d+/\d+`. `Slur.end_note_index >= start_note_index` enforced.
- `backend/app/prompts/ocr_prompt.txt`: new. **Verbatim copy** of spec §6's OCR prompt block (schema + Rules section). Externalized so we can iterate the prompt without redeploying.
- `backend/app/tests/test_score_schema.py`: new. 19 cases — minimal payload accepts; full payload round-trips through `model_dump_json`; `ocr_confidence` boundaries (0, 0.5, 1) accepted; out-of-range rejected; extra fields at every level rejected; pitch regex covers valid (`D3`, `F#4`, `Bb2`, `C-1`, `rest`) and invalid (`H4`, `D#bb4`, `rest!`, whitespace-padded) forms; invalid duration / clef / repeat-type rejected; slur end-before-start rejected; bpm_hint range enforced; measure defaults work.

**Why:**
The schema is the contract every later piece depends on — Claude's output is validated against it, the DB jsonb is shaped like it, and Batch 3's audio pipeline reads from it. Locking it down with strict validation now means Claude hallucinations get rejected at the boundary instead of corrupting downstream code.

**Tests run:**
- `cd backend && uv run pytest app/tests/test_score_schema.py -q` → 19 passed.
- Full suite re-run after later commits.

**Known side effects / things to watch:**
- The `Duration` literal hardcodes the standard set. If a future score uses something exotic (e.g. tuplets, double-dotted), Claude's output will fail validation and retry. Acceptable for MVP — exotic notation is also where Claude struggles most, so failing fast surfaces the issue.
- The pitch regex doesn't cap octave count — `C100` would parse. Postgres-side accent notation (`C##` / `Cbb`) isn't supported (single accidental only); spec §6 doesn't mention double-accidentals so we're fine.

**Rollback:** `git revert <SHA>` removes the schema + prompt + tests. Anything that imports from `app.services.score_schema` (just OCR + scores router after the next commits) goes red.

## 2026-04-26 19:15 — Batch 1 — 003_users_auth_fk migration

**Batch:** Batch 1
**Branch:** feat/batch-1-backend-infra
**Commit (after this edit):** `ba96e55` — `feat(batch-1): 003_users_auth_fk — link public.users.id to auth.users(id) ON DELETE CASCADE`.

**What changed:**
- `backend/app/migrations/003_users_auth_fk.sql`: new. Drops `public.users.id`'s `gen_random_uuid()` default and adds `users_auth_fk: FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE`. Includes a leading `DELETE FROM public.users` guard — safe in dev (table is empty), destructive in production (requires backfill step instead).
- `DECISIONS.md`: new entry at top documenting the spec gap and the fix.

**Why:**
Live verification of /v1/me round-trip uncovered that deleting a Supabase auth user orphans the matching row in `public.users` (and would orphan everything that CASCADEs off it: scores, analyses, assignments). Spec §2 canonical DDL doesn't include the FK that would prevent this; Supabase's standard pattern is to reference `auth.users(id)` with CASCADE. Adding it now in Batch 1 keeps every downstream batch from inheriting the hazard.

**Tests run:**
- Migration applied via the Supabase MCP `execute_sql` (service-role authenticated). No errors.
- `pg_constraint` query confirms the FK is live: `users_auth_fk: FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE` (confdeltype='c').
- `information_schema.columns` confirms `public.users.id` no longer has a default.
- Full re-run of the live `/v1/me` flow with CASCADE confirmation logged in the next entry.

**Known side effects / things to watch:**
- The leading `DELETE FROM public.users` in the migration body would wipe production data if blindly re-applied. Anyone running migrations end-to-end in prod must skip 003 and instead add the FK without the DELETE (after validating no orphan ids exist).
- `public.users.id` is now a hard pointer to `auth.users.id`. Our `/v1/me` provisioning insert sets `id=str(user_id)` (the JWT's `sub`), which is the auth UUID — already correct, no code change needed.

**Rollback:** `git revert <SHA>` removes the file; SQL rollback is `ALTER TABLE public.users DROP CONSTRAINT users_auth_fk; ALTER TABLE public.users ALTER COLUMN id SET DEFAULT gen_random_uuid();`. The orphan-row hazard returns.

## 2026-04-26 18:50 — Batch 1 — switch auth from HS256 shared-secret to JWKS/ES256

**Batch:** Batch 1
**Branch:** feat/batch-1-backend-infra
**Commit (after this edit):** `9ca1f9e` — `refactor(auth): switch from HS256 shared-secret to JWKS/ES256`.

**What changed:**
- `backend/app/auth.py`: full rewrite of `_decode_token`. Now uses `jwt.PyJWKClient(<SUPABASE_URL>/auth/v1/.well-known/jwks.json, cache_keys=True)` to fetch the project's public key, verifies tokens with `algorithms=["ES256", "RS256"]` (RS256 included so a future Supabase upgrade keeps working), keeps `audience="authenticated"`. Added a module-level `_jwks: PyJWKClient | None = None` test hook plus `_get_active_jwks()` helper so tests can inject a stub without monkeypatching the lru_cache.
- `backend/app/config.py`: dropped `SUPABASE_JWT_SECRET` from `Settings` — JWKS replaces it.
- `backend/.env.example`: removed the `SUPABASE_JWT_SECRET=` slot, replaced with a 3-line comment pointing to DECISIONS.md.
- `backend/.env` (local-only, gitignored): same removal so the spot-check no longer flags an unused env var.
- `backend/app/tests/conftest.py`: rewritten. Generates an ES256 keypair once per session via `cryptography.hazmat.primitives.asymmetric.ec`, exposes `make_token` (mints arbitrary ES256-signed tokens with the test private key) and `bad_token` (signed by a *different* key — for negative-path coverage), and an autouse `_stub_jwks` fixture that monkeypatches `app.auth._jwks` to a stub returning the test public key.
- `backend/app/tests/test_auth.py`: rewritten to use the new `make_token` fixture. Old `_make_token` / `SECRET` constants gone. New case `test_signature_from_wrong_key_returns_401` covers the wrong-key rejection path that HS256 tests couldn't.
- `backend/app/tests/test_me.py`, `test_upload.py`: updated to use `make_token`. Mocks for `get_service_client` unchanged.
- `backend/pyproject.toml`, `uv.lock`: added `cryptography>=47.0.0` to `[tool.uv] dev` (was already present transitively via supabase / pyjwt; now declared so removing supabase later wouldn't silently break tests).
- `DECISIONS.md`: new entry "Verify Supabase user JWTs via JWKS / ES256, not HS256 shared secret" — full context, alternatives considered, trade-offs, affected code paths, reversibility.

**Why:**
The user's freshly-created Supabase project ships under the asymmetric JWT system. There is no HS256 "JWT Secret" knob to copy; the only signing-related field on the dashboard is the JWKS `kid` (a UUID). Empirically: `GET /auth/v1/.well-known/jwks.json` returns `{"keys":[{"alg":"ES256","crv":"P-256",...}]}`. Trying to verify an HS256-signed legacy service-role JWT with the UUID-as-secret confirmed `InvalidSignatureError`. The only correct fix is to use JWKS verification — which is also where Supabase is going long-term, so we win twice.

**Tests run:**
- `cd backend && uv run pytest -q` → **20 passed** (was 19; the new wrong-key case adds 1). 0 failures, 0 warnings (the prior `InsecureKeyLengthWarning` from PyJWT goes away under ES256).

**Known side effects / things to watch:**
- First verification per process triggers an HTTPS GET to the JWKS endpoint. PyJWKClient caches the result indefinitely, so steady-state cost is zero. If Supabase's auth host is unreachable on cold start, requests get 401 with "Token validation failed: …" detail — better than failing closed silently.
- Tests now drag in `cryptography` (≈4 MB wheel). It was already installed transitively; this commit just makes the dependency explicit.
- `_jwks` is `None` in production; only the autouse test fixture overrides it. If a future test forgets to use the autouse fixture, the production `_get_jwks_client` path would try to fetch JWKS from `https://test.supabase.invalid/...` — which would fail with a 401 ("Token validation failed: …"), making the test loud rather than silent.
- The `SUPABASE_JWT_SECRET` env var is gone from the project — anyone with a stale local `.env` from before this commit can leave the line in or remove it; it's just ignored.

**Rollback:** `git revert <SHA>` puts everything back: HS256 shared-secret decode, the env var slot, and the prior test fixtures. The DECISIONS.md entry would still describe the divergence, which is fine — it documents the analysis even if we ever reverse course.

## 2026-04-26 18:05 — Batch 1 — auth/me/upload tests + conftest

**Batch:** Batch 1
**Branch:** feat/batch-1-backend-infra
**Commit (after this edit):** `3fb8f40` — `test(batch-1): cover auth, /v1/me first-touch, /v1/upload presign`.

**What changed:**
- `backend/app/tests/conftest.py`: new. Sets `SUPABASE_*` env vars before any test runs so `app.config.Settings` (lru_cached) picks up the test secret. Module-import-side-effect on purpose.
- `backend/app/tests/test_auth.py`: new. 6 cases — missing bearer, invalid token, expired token, wrong audience, non-UUID sub, valid token. All except the happy path expect 401. Uses a tiny FastAPI app exposing only the `current_user_id` dep so tests don't drag in the rest of the API.
- `backend/app/tests/test_me.py`: new. 4 cases — unauthenticated 401, existing-user happy path (no insert called), first-touch provisioning (insert called with the JWT email), invalid JWT 401. Mocks `get_service_client` via `monkeypatch` so no live Supabase touched.
- `backend/app/tests/test_upload.py`: new. 6 cases — both endpoints unauthenticated 401, both endpoints sign correctly with the right bucket name, audio rejects disallowed extensions, audio rejects no-extension filenames, expires_at is in the future. Verifies the `<user_id>/...` prefix in `object_key`.

**Why:**
The test suite locks in: (1) the JWT decoder's audience check (the spec's #1 silent-failure pitfall), (2) first-touch provisioning works exactly once and idempotently, (3) the upload endpoints never let a client write outside its own folder prefix. Mocked Supabase keeps CI fast and deterministic; the live verification step at the end of the batch covers the integration path.

**Tests run:**
- `cd backend && uv run pytest -q` → **19 passed** (2 from Batch 0 + 17 new). 22 warnings, all `InsecureKeyLengthWarning` from PyJWT noting the 30-byte test secret is shorter than the 32-byte SHA-256 minimum — harmless in tests, the live secret will be longer.

**Known side effects / things to watch:**
- The conftest's `os.environ.setdefault` runs at import time. If a future test wants to test the "JWT secret unset" 500 path, it'll need to clear the env before importing `app.config`. The current suite does not exercise that path.
- `test_me.py`'s mock chain mirrors supabase-py's exact `client.table(...).select(...).eq(...).limit(...).execute()` shape. If supabase-py changes that chain, tests break before live calls do — that's the intent.
- Tests were collected from `app/tests/` thanks to pytest's auto-discovery — no pytest config edit needed.

**Rollback:** `git revert <SHA>` removes the test files only — the production code stays intact.

## 2026-04-26 17:55 — Batch 1 — auth, models, /v1/me, /v1/upload routers

**Batch:** Batch 1
**Branch:** feat/batch-1-backend-infra
**Commit (after this edit):** `9e73d4d` — `feat(batch-1): auth, models, /v1/me first-touch provisioning, /v1/upload presign`.

**What changed:**
- `backend/app/auth.py`: new. JWT verification with `audience="authenticated"` per spec's #1 silent-failure pitfall. Three deps: `current_user_id` (returns UUID from `sub`), `current_jwt_payload` (returns full decoded payload — used by /v1/me to read the email out of the token without a DB hit), `current_user` (loads the full users row via service-role client; raises 404 if no row). HTTPBearer is set with `auto_error=False` so missing-header errors return our own 401 instead of a 403.
- `backend/app/db.py`: extended. Now exposes `get_anon_client()` (RLS-respecting, anon key) and `get_service_client()` (RLS-bypass, service-role key). Old `get_client()` retained as alias to anon for the Batch 0 callers.
- `backend/app/models/__init__.py`, `user.py`, `score.py`, `analysis.py`, `assignment.py`: Pydantic v2 models for every table in the canonical DDL except studios + verdict_corrections + sync_events (those land when the relevant batches need them — keeping the model surface minimal for now). `User` mirrors the DB row; `MeResponse` is the public payload returned by /v1/me. `Assignment` model ships even though no MVP endpoint reads/writes assignments — needed so the Batch 12 teacher tier can add endpoints without re-modelling.
- `backend/app/routers/me.py`: new. `GET /v1/me` reads the users row via service-role client (RLS-bypass needed for first-touch provisioning); if absent, inserts with email from the JWT and tier=free, role=student. Returns `MeResponse`.
- `backend/app/routers/upload.py`: new. `POST /v1/upload/audio` and `POST /v1/upload/score-image`. Each takes `{filename}`, validates the extension against an allowlist, builds an object key under `<user_id>/<uuid>.<ext>`, asks Supabase Storage for a signed upload URL (5-min TTL), returns `{upload_url, public_url, object_key, expires_at}`. Bucket constants: `audio-uploads`, `score-images`. Calls `create_signed_upload_url` on the bucket with a fallback shim for older SDK versions.
- `backend/app/main.py`: includes `me` and `upload` routers under `/v1`.
- `backend/pyproject.toml`, `uv.lock`: added `pydantic[email]` for `EmailStr` (pulled in `email-validator`, `dnspython`).

**Why:**
This is the Batch 1 code surface. Auth lives in its own module so /v1/scores (Batch 2), /v1/analyses (Batch 4), and the rest of the API can `Depends(current_user_id)` without circular imports. /v1/me uses the service-role client for first-touch provisioning specifically because a self-INSERT RLS policy on `users` would let the anon key mint rows directly — we want that path gated by the backend so it can validate the JWT first. Upload endpoints sign URLs server-side because Supabase storage doesn't expose presigned uploads from the anon key in a way that's safe to do client-side without leaking the service-role key.

**Tests run:**
- `uv run python -c "from app.main import app; print(sorted({r.path for r in app.routes}))"` →
  `['/', '/docs', '/docs/oauth2-redirect', '/openapi.json', '/redoc', '/v1/health', '/v1/me', '/v1/upload/audio', '/v1/upload/score-image']`. App imports cleanly.
- Real pytest coverage of these endpoints lands in the next commit.

**Known side effects / things to watch:**
- `_sign_upload` calls `create_signed_upload_url` if available, else falls back to `create_signed_url` (download URL — wrong semantics but won't crash). The supabase-py 2.29 shipped here exposes `create_signed_upload_url`, so the fallback is a safety net. If a future SDK upgrade renames the method again, the upload tests will catch it before live traffic does.
- `current_user` dep raises 500 if `SUPABASE_SERVICE_ROLE_KEY` is unset. That's the right failure mode — the backend cannot do its job without it — but local dev needs the env set or every protected request 500s.
- Upload endpoint object keys are always `<user_id>/...` — the storage bucket's RLS policy must require the same `<user_id>/` prefix or any authenticated user could PUT into another user's folder. This dependency is documented in the Supabase ask block of this batch.

**Rollback:** `git revert <SHA>` removes auth, models, and routers cleanly. The /v1/me + /v1/upload endpoints disappear; /v1/health (Batch 0) keeps working.

## 2026-04-26 17:40 — Batch 1 — initial + RLS migrations

**Batch:** Batch 1
**Branch:** feat/batch-1-backend-infra
**Commit (after this edit):** `73b506e` — `feat(batch-1): add 001_initial.sql, 002_rls_policies.sql, pytest-mock dep`.

**What changed:**
- `backend/app/migrations/001_initial.sql`: full canonical DDL from spec §2 — enums, studios, users (with deferred FK), scores, assignments, analyses (with deferred FK back to assignments), verdict_corrections, sync_events, all spec'd indexes, and the `set_updated_at` trigger function applied to every `updated_at` table. Verbatim copy of the spec block.
- `backend/app/migrations/002_rls_policies.sql`: RLS enabled on all seven tables. Policies follow the prose outline at the bottom of §2 (richer than the Batch 1 stub). Notable: users has self SELECT/UPDATE only — first-touch provisioning runs through the service-role key from the backend, not via an anon-key INSERT, to prevent malicious row creation. studios get owner-CRUD + member SELECT; scores get owner-CRUD + studio-member SELECT when `shared_with_studio` set; analyses get owner-CRUD + teacher SELECT via assignment join; assignments get teacher-CRUD + student SELECT/UPDATE (status-graph trigger deferred to Batch 12); verdict_corrections + sync_events are owner-INSERT only with no SELECT policy (service-role retraining/audit pipelines bypass RLS).
- `backend/pyproject.toml`, `backend/uv.lock`: added `pytest-mock==3.15.1` as dev dep for upcoming test suites.

**Why:**
DDL needs to land first so the rest of Batch 1 (auth, /v1/me, upload) has a schema to talk about. Splitting initial schema from RLS into two migration files is a Supabase convention that makes "wait, why is this query empty" investigations easier (you can test with RLS off via service role to isolate logic vs. policy bugs).

**Tests run:**
- None — these are pure SQL artifacts. They'll be applied against the live Supabase project as the manual user step at the end of this batch.

**Known side effects / things to watch:**
- The `users` self-INSERT gap is intentional. Until Batch 1's `/v1/me` handler ships, no user row will get created from the anon key path even with a valid JWT. Anyone hitting `/v1/me` before that handler exists will see a "user not found" path.
- `assignments` student-UPDATE policy currently allows updating any column on the student's own assignment row, not just `status`. The status-graph trigger that locks this down ships in Batch 12; documented here so Batch 12 doesn't overlook it.

**Rollback:** `git revert <SHA>` removes both files. To roll back the live DB, hand-write a `DROP TABLE … CASCADE; DROP TYPE …` in reverse FK order, then re-apply prior migrations. Easier path: Supabase project snapshot before applying.

## 2026-04-26 17:30 — Batch 0 — initial scaffold

**Batch:** Batch 0
**Branch:** main
**Commit (after this edit):** `d8e7fbd` — `docs(edit-log): record Batch 0 scaffold`. Scaffold work itself spans two prior commits:
- `6c0ebd4` — `chore: initial spec, log files, and design preview` (tagged `spec-v1`)
- `c073357` — `feat(batch-0): scaffold backend, frontend, mobile stub, fixtures, CI`

**What changed:**
- `intempo-combined.md`: master spec copied to repo root from the attached source file.
- `docs/intempo-design-preview.html`: rendered design preview committed at the path the spec references.
- `EDIT_LOG.md`, `DECISIONS.md`, `TUNING_LOG.md`: created at repo root with the exact starter headers from the spec's Batch 0 step 2 codeblock.
- `README.md`, `LICENSE`: stub README and MIT license (copyright 2026 "Divine Arbiter of Justice, Daniel").
- `.gitignore`: covers Node, Python, uv, Windows, macOS, Linux, common IDEs, `.env`, and local Postgres data.
- `backend/`: `uv init` scaffold with deps `fastapi`, `uvicorn[standard]`, `python-dotenv`, `supabase`, `httpx`, `anthropic`, `pydantic`, `pyjwt` and dev deps `pytest`, `httpx`. Files: `app/__init__.py`, `app/main.py` (FastAPI app, health router under `/v1`, root returns `{"app": "intempo", "status": "ok"}`), `app/config.py` (env loader), `app/db.py` (Supabase client factory), `app/routers/health.py` (`GET /v1/health` → `{"status": "ok"}`), `app/tests/test_health.py` (TestClient covers root + health), `Dockerfile`, `.env.example`.
- `frontend/`: Vite + React + TypeScript scaffold via `npm create vite@latest`. Tailwind v3 added (`tailwind.config.js` + PostCSS). `src/index.css` rewritten with `@tailwind` directives. `src/lib/api.ts` is a fetch wrapper hitting the backend health endpoint at `VITE_API_BASE_URL` (defaults to `http://127.0.0.1:8000`). `src/App.tsx` calls `getHealth()` on mount and renders ok / not-ok with detail. Default Vite splash assets removed from `App.tsx`; `App.css` deleted.
- `mobile/README.md`: one-paragraph stub — "RN scaffold lands in Batch 9, intentionally empty for now."
- `fixtures/scores/.gitkeep`, `fixtures/audio/.gitkeep`: keep the regression-suite directories tracked while empty.
- `docker-compose.yml`: Postgres-only service per spec (`postgres:16-alpine`, named volume `intempo_pg`, port 5432). No Redis until the Celery migration triggers in §11 fire.
- `.github/workflows/ci.yml`: two jobs — `backend-test` (uses `astral-sh/setup-uv@v3`, `uv sync --all-extras --dev`, `uv run pytest -q`) and `frontend-build` (Node 22, `npm ci`, `npm run build`). Triggers on `pull_request` and `push: branches: [main]`.

**Why:**
This is the foundations batch. The repo, CI, and an empty backend that responds to `/v1/health` plus an empty React app that loads must be in place before any feature work, per Batch 0 of the spec. The spec + log files were committed first (commit `6c0ebd4`, tagged `spec-v1`) so every subsequent commit happens under their rules; the scaffold landed second (commit `c073357`).

**Tests run:**
- `cd backend && uv run pytest -q` → 2 passed (test_health_returns_ok, test_root_returns_app_status).
- `cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8000` → `curl /v1/health` returned `{"status":"ok"}`, `curl /` returned `{"app":"intempo","status":"ok"}`. Process killed afterward.
- `cd frontend && npm run build` → Vite production build succeeded (~492ms, 191kB JS / 4.6kB CSS).

**Known side effects / things to watch:**
- Supabase project provisioning is a manual user step; values are left blank in `backend/.env.example` and added to a local `backend/.env` outside the repo. Anything that imports `app.db.get_client()` will return `None` until `SUPABASE_URL` and `SUPABASE_KEY` are set — Batch 1 endpoints must guard for this.
- Tailwind was pinned to v3 (`tailwindcss@3`) because the spec assumes the v3 init flow (`npx tailwindcss init -p` and `@tailwind` directives in `src/index.css`); v4 reorganised both. If we move to v4 later, log it as its own EDIT_LOG entry.
- Git is set to `core.autocrlf=true` on this Windows machine, so all the freshly committed text files show `LF will be replaced by CRLF` warnings on `git add`. Not a behaviour change at HEAD, but worth knowing if file-mode-sensitive checks land in CI.
- `gh auth login` was run via the device-code flow on this machine; the push step happens once auth completes.

**Rollback:** `git revert c073357` cleanly removes the scaffold; `git revert 6c0ebd4` would also remove the spec/log files but is unlikely to be useful (the project doesn't function without those). To get back to "right after Batch 0," `git checkout batch-0-done`.

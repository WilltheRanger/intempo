# InTempo Decisions

Architectural "X over Y because Z" choices only. Format: date, decision,
alternatives considered, why we picked this. See intempo-combined.md
Operating Principle #5.

---

## 2026-08-17 — Two clocks for the metronome, not one

**Context:** the metronome has three outputs — a row of marks on screen, a haptic tap, and a click. The obvious build is one beat clock fanning out to all three. It is wrong for one of them.

Anything the screen draws or the phone vibrates is already bounded by the frame rate and by how fast a hand can feel a difference; a few milliseconds late is imperceptible. A click is not. The ear places a transient an order of magnitude more finely than the eye places a change, and a metronome that wobbles is worse than none because a musician will play the wobble — into a take this app then measures for timing errors and attributes to them.

**Decision:** `clock.ts` is a drift-corrected JS timer and drives the visual and haptic modes. `click.web.ts` ignores it entirely and books clicks against `AudioContext.currentTime` with a lookahead window, which is the standard Web Audio scheduling pattern. The two run independently, which is safe because `metronome_mode` is an enum — never more than one output at a time.

Both compute a beat's time as `start + index × period`, never by adding a period to the last beat. Accumulating would lose a fraction of a millisecond per beat and be a quarter of a second out by the end of a two-minute take: the app would be measuring its own error and billing it to the player.

**Alternatives considered:**

- *One JS clock for all three.* Rejected on the measurement, not on principle. Booked against the audio clock, click-to-click error came back at exactly 0 seconds. A JS timer driving the same clicks would have carried the scheduler jitter straight into the reference a musician is playing to.
- *Schedule the whole take's clicks up front,* as `scorePlayer.web.ts` does for a piece. Rejected: a take can run fifteen minutes, which is over 1,300 oscillator nodes held for the duration, and the take can be stopped at any moment. The lookahead window books a quarter-second at a time and closing the context takes the rest with it.
- *A native scheduling module,* so the device build gets the same guarantee as the browser. Deferred, not rejected — see the trade-off.

**Trade-off accepted:** the native click path (`click.ts`) re-strikes two pre-rendered `expo-audio` players from the JS clock, so **on a device the clicks inherit JS-thread jitter that the web build does not have.** That is written at the top of the file. It cannot be measured in this environment — there is no simulator or device — so what it needs is a person with headphones judging whether the jitter is audible. If it is, the fix is a native scheduler, not a faster timer.

**Also decided: no count-in.** A take is aligned against the score by what was played, not by when the file starts, so an offset at the top costs the analysis nothing. A count-in the recorder captures as silence is a product feature with its own UI, and inventing one inside a clock module is how features arrive that nobody chose.

## 2026-08-17 — Rewrite exported asset paths after the build rather than vendoring the fonts

**Context:** the first Cloudflare Pages deploy of the mobile app rendered a blank page. The build log was clean end to end and ended `Success: Assets published!`. The cause was in the log the whole time, as a number: `dist` holds 27 assets, `Uploaded 12 files`, and exactly 15 files sit under a directory called `node_modules`.

**Cloudflare Pages silently skips anything under `node_modules` in the build output.** Metro names an exported asset after the path of the module that imported it, so a font from `@expo-google-fonts` lands at `dist/assets/node_modules/@expo-google-fonts/inter/400Regular/Inter_….ttf`. All four typefaces 404'd. `useFonts` never resolved, and `App.tsx` gated the entire app on `fontsLoaded` behind a plain ivory `<View>` — so the app rendered a blank screen, forever, because of a decorative resource.

**Decision:** a post-export step (`mobile/scripts/flatten-vendor-assets.mjs`) renames `dist/assets/node_modules` to `dist/assets/vendor` and rewrites the references in the bundle. Wired into `npm run build:web`, which the root build script now calls, so local and CI cannot drift.

**Alternatives considered:**

- *Copy the four fonts into `mobile/assets/` and import them from there.* Rejected: it fixes the fonts and leaves the eleven `@react-navigation/elements` icons still unreachable, so the same failure returns the next time any dependency ships an asset. It also means the typefaces stop being managed by `@expo-google-fonts` and start being four binaries someone has to remember to update.
- *A Metro config knob.* There isn't one. The destination path is derived from the importing module's location and there is no supported way to change it.
- *Leave it and accept missing fonts.* Rejected — that was the bug.

**Trade-off accepted:** we string-rewrite a built artifact, which is the kind of thing that breaks quietly when the upstream format changes. Mitigated by the script failing loudly: if it moves files but rewrites zero references, it exits non-zero, because a rename without a rewrite produces exactly the failure it exists to prevent and would otherwise look like success.

**Separately, and worth keeping even if the above becomes unnecessary:** `App.tsx` no longer waits forever. `useFonts`'s error is honoured and a 5-second timeout backs it up, so a font that 404s or hangs costs the typeface and not the interface. Verified by forcing every `.ttf` to 404 and confirming the app still renders.

## 2026-08-16 — Patch `expo-audio` rather than fork or replace it, to get an unprocessed input source on Android

**Context:** `AudioStream` is right on iOS — it opens the session in `.measurement` mode, so the system applies no input processing. On Android it opens `AudioRecord` on `MediaRecorder.AudioSource.MIC`, which is the general-purpose source and passes through the OEM's input chain. Automatic gain is the specific problem: it reshapes attack envelopes, and attack envelopes are what the onset detector measures. Android takes would have been quietly less accurate than iOS ones with nothing anywhere saying so.

**Decision:** `patch-package`, on one function in `AudioStream.kt`.

- The source becomes `AudioSource.UNPROCESSED` where the device reports `PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED`, and `VOICE_RECOGNITION` where it does not. `MIC` is no longer used at all.
- On top of the source, `AutomaticGainControl`, `NoiseSuppressor` and `AcousticEchoCanceler` are explicitly disabled on the capture session, because some devices attach them regardless of the source asked for. The effect objects are retained for the life of the stream and released on stop — an `AudioEffect` that is garbage collected takes its setting with it.

**Alternatives considered:**

- *A local Expo module replacing `AudioStream` for Android.* Rejected: it means owning `AudioRecord`, its capture loop, its buffer marshalling and its lifecycle to change one constant, and diverging from upstream's bug fixes forever.
- *An Expo config plugin rewriting the Kotlin at prebuild (`withDangerousMod`).* Rejected: the same string-matching fragility as a patch, with none of a patch's tooling — no clean-file diff, no loud failure when upstream moves.
- *Leaving it and documenting it.* Rejected. This was the state after the previous entry, and it puts a known measurement error into a measurement app.

**Trade-off accepted:** a patched dependency has to be re-made on every `expo-audio` upgrade. `patch-package` fails the install loudly when the context no longer matches, which is the behaviour worth having — a silent revert here would mean thresholds tuned against processed audio. The patch is small, self-contained, and worth sending upstream.

**Not verified.** There is no Android toolchain in this environment, so this Kotlin has never been compiled, let alone run against a microphone. What is verified is that the patch applies cleanly to a fresh `npm install`. The first real Android build is the test, and it should be a build before it is a take.

## 2026-08-16 — Capture takes as raw PCM through `AudioStream` and a web `AudioWorklet`, not through either platform's recorder

**Context:** the mobile app needed real audio capture. The analysis pipeline measures note onsets — where an attack begins, to within milliseconds — and every decision below follows from that one requirement.

**Decision:** record raw PCM on every platform and write the WAV in the client.

- **Native:** `expo-audio`'s `AudioStream`, not its `AudioRecorder`. The stream delivers untouched int16 buffers on both platforms and reports the rate the hardware actually gave.
- **Web:** an `AudioWorklet` over `getUserMedia`, not `MediaRecorder`, with `echoCancellation`, `autoGainControl` and `noiseSuppression` all explicitly false.
- **Both:** one shared encoder, `lib/audio/wav.ts`, so the file the backend receives is byte-identical in structure whichever platform produced it.

**Alternatives considered:**

- *`expo-audio`'s `AudioRecorder`.* Rejected. It wraps `AVAudioRecorder` on iOS and `MediaRecorder` on Android, and Android's has no raw-PCM output at all — the best available is AAC. Lossy codecs smear exactly the transient the onset detector reads, so Android would have been the quietly-degraded platform with nothing in the interface to say so.
- *`MediaRecorder` on web.* Rejected for the same reason: Opus in WebM on Chrome, AAC in MP4 on Safari, both lossy, neither optional.
- *Resampling to 22.05 kHz in the client,* which is the rate the pipeline loads at. Rejected. It would roughly halve upload size, but it moves an irreversible step onto a browser resampler of unknown quality when the server already does it with soxr. The WAV header carries the true rate, so the server gets it right from any device. We pay bandwidth to keep the one lossy step on the machine we control.

**Correction, same day.** This entry originally recorded an open gap on iOS: that system auto-gain could not be turned off because `expo-audio` exposes no way to reach `AVAudioSession`'s `.measurement` mode. **That was wrong, and it was wrong because it was inferred from the JavaScript type surface rather than read from the shipped native source.** `AudioStream.start()` in `node_modules/expo-audio/ios/AudioStream.swift` opens every stream with `session.setCategory(.record, mode: .measurement)` — exactly the mode that asks the system for no input processing. iOS was already correct.

Reading the Android source in the same pass turned up the gap that does exist: `AudioStream.kt` creates its `AudioRecord` on `MediaRecorder.AudioSource.MIC`, the platform's general-purpose source, which runs through whatever the OEM's input chain applies. See the entry below.

Uncompressed audio also costs upload: mono 16-bit at 48 kHz is 96 KB a second, so a three-minute take is about 17 MB. Accepted as the price of a measurable signal. A 15-minute cap (`MAX_TAKE_SECONDS`) bounds memory; when it bites, the "Listening back" screen says so rather than truncating quietly.

## 2026-07-28 — Stay on Supabase; keep object storage swappable so audio can move to R2 later

**Context:** the user asked whether Supabase is the right backend before investing further. Worth noting the framing: Supabase is *not* "the backend" — it supplies auth, Postgres, and object storage. The analysis engine (librosa + DTW, Batch 3) is a separate Python/FastAPI service that no BaaS can host, and that split is unchanged by any vendor choice.

**Decision:** stay on Supabase for auth + Postgres + storage. It fits this workload specifically: the data is relational (users → scores → analyses → per-measure/per-note), RLS enforces per-user isolation at the database for what is genuinely private data (people's practice recordings), and JWKS/ES256 auth + presigned uploads are already built and tested (Batch 1).

Separately, and per the user's own instinct: **plan for audio blobs to move off Supabase Storage** (most likely Cloudflare R2, zero egress) if bandwidth costs bite. Audio files are large and re-fetched on every analysis, so egress is the realistic cost pressure — not storage volume.

**The seam already exists — preserve it, don't pave over it:**
- `workers/analysis_runner.download_audio(url)` is a plain `httpx.get`. It is provider-agnostic *today*. **Do not** replace it with a Supabase SDK call; that would be the single most damaging change to future portability.
- All storage signing goes through one function, `routers/upload._sign_upload(bucket, object_key)`. Keep new signing logic there rather than inlining SDK calls at call sites.
- Known friction if/when the move happens: bucket names `"audio-uploads"` / `"score-images"` are string literals in a couple of modules, and `routers/scores.py` validates score-image URLs against a Supabase-shaped URL pattern.

**Alternatives considered:**
- *Firebase.* Rejected: Firestore's document model fits this relational data badly, and the Python analysis service would still be separate.
- *Clerk + Neon + R2 ("best of breed").* Rejected for now: genuinely good, and Clerk's auth UX beats Supabase's, but it's three vendors and three integration surfaces for a pre-launch solo build.
- *Convex.* Rejected: TypeScript-first and wants application logic in its own functions; awkward against a Python DSP pipeline.
- *Hand-rolled auth on plain Postgres.* Rejected: weeks rebuilding magic links, sessions, and token refresh — the canonical thing not to hand-roll.
- *Refactor storage behind an abstraction layer now.* Rejected: speculative work for a swap that hasn't happened, and it contradicts operating principle "don't optimize early." The natural seam above is sufficient; revisit when there's a real bill to look at.

**Trade-off accepted:** we're carrying a known future migration rather than pre-solving it. That's deliberate — the app has not yet run end-to-end even once, so egress cost is a projection, not an observation. Re-architecting ahead of that evidence would trade working, tested code for a hypothesis.

---

## 2026-07-28 — Badge: adopt the kit-style `variant`/`appearance`/`shape` API, but resolve it to the locked palette with non-generic defaults

**Context:** the user flagged that the verdict badges "look ai" — correctly. The old `Badge` was a pastel-tinted pill with a small coloured status dot: the single most templated status affordance on the web (GitHub labels, Linear, every Tailwind kit), a `bg-*-100/text-*-800` reflex, with a dot that only repeated the text colour. The user then supplied a shadcn-style badge API as the target shape: `variant` (primary/success/warning/info/destructive) × `appearance` (solid/light/outline) × `shape` (circle/square).

**Decision:** implement that full API surface, but (a) resolve every variant to the locked manuscript tokens rather than a generic status ramp, (b) default to `appearance="outline"` + `shape="square"` — an engraved chip on paper-warm with a hairline edge, the hue carried by text and border rather than a colour fill — and (c) drop the decorative status dot entirely. `tone` ("on"/"mid"/"bad") is kept as a verdict-UI shorthand that maps onto `success`/`warning`/`destructive`, so verdict screens stay in domain language.

**`info` resolves to neutral graphite `ink`, never `spruce`.** Spruce is the recording *environment* surface only and must never encode a status (the rule in `tokens.ts`); a green-blue "info" badge would quietly break that quarantine. Future sessions: do not "fix" this by reaching for spruce.

**Alternatives considered:**
- *Keep the pill + dot and just recolour it.* Rejected: recolouring doesn't remove the tell — the shape and the redundant dot *are* the tell.
- *Replace badges with pencil margin-marks or Italian tempo terms* (`stringendo` / `a tempo`), which is more distinctive and more musician-native. Not taken now: the user asked for the kit API, and these would fight it. Still the better long-term direction for verdict UI specifically — revisit when verdict badges actually ship on a screen.
- *Ship only the outline appearance.* Rejected: `solid`/`light` are legitimately useful (a solid amber badge reads well on the spruce surface), and the user explicitly asked for the appearance axis.

**Trade-off accepted:** the API can still express the generic look — `appearance="light" shape="circle"` reproduces close to the pastel pill we just removed. That's deliberate: the defaults guide toward the manuscript direction without forbidding the escape hatch. The guard is the default, not a restriction. Also, `Badge` is currently used *only* on `/showcase` — no live screen consumes it yet, so this was a free rework.

---

## 2026-07-24 — Frontend design tokens: adopt the "manuscript" direction, superseding spec §5's placeholder palette

**Context:** spec §5 (Batch 5) specifies design tokens as "Cream `#fbf4de`, ink `#1a140a`, gold `#8a6212` … same theme as the AP Euro work." That was a placeholder to get the dev moving. Over this session the user explored the visual direction in depth (a ChatGPT moodboard, several interactive prototypes, two design-taste skills), and converged on a distinct "engraver's manuscript" identity.

**Decision:** lock the frontend design system to the manuscript direction, not §5's placeholder: Paper Ivory ground, Rosined Amber as the single interactive accent, Deep Spruce as the recording-environment surface only, a verdict triad (green/amber/oxblood) quarantined to verdict UI and always paired with a label, Playfair Display display serif + a grotesque body (system SF standing in for Suisse Int'l until licensed), radii 10/14/20/26, warm shadows with a lit-edge hairline, and the `cubic-bezier(0.32,0.72,0,1)` "iOS" easing. Tokens live in `frontend/src/styles/tokens.ts`, mirrored as CSS variables in `index.css` and mapped into Tailwind.

This also refines §3.5: §3.5's original "quarantine the verdict colors" rule is kept, but the palette/type themselves evolved (warmer, serif-led) past §3.5's Geist/Linear-leaning starting point. The anti-collision rules are documented in the prototype and the token file.

**Alternatives considered:**
- *Use §5's cream/gold placeholder verbatim.* Rejected: the user explicitly evolved the design beyond it; §5 itself framed the palette as a familiar-to-the-dev starting point, not a mandate.
- *Wait and hard-code colors per component.* Rejected: that's exactly the "every element re-decides taste" failure mode. One token layer is what keeps the UI coherent.

**Trade-off accepted:** the checked-in spec (`intempo-combined.md`) still shows the old palette in §5; the source of truth for *implementation* is now `tokens.ts`. The human owns folding this back into their spec copy if they want the doc to match.

---

## 2026-07-24 — `alignment_failed`/`no_onsets` are DB `status='done'`, not `'failed'`

**Context:** `analyze()` returns a graceful `AnalysisResult` with an internal `status` of `ok`, `alignment_failed`, or `no_onsets` — it does not raise on a bad recording. The DB `analysis_status` enum is `queued/processing/done/failed/failed_recoverable`. The worker has to map one to the other.

**Decision:** any result `analyze()` *returns* (all three internal statuses) is stored as DB `status='done'`, with the pipeline status carried inside `result_json.status`; `alignment_quality` and `finished_at` are set so the DDL's `CHECK (status <> 'done' OR result_json IS NOT NULL AND finished_at IS NOT NULL)` holds. DB `status='failed'` is reserved for *exceptions* — audio couldn't be fetched, score missing, internal error. The client reads `result_json.status` to decide between showing the verdict, a low-confidence caveat, or a "we couldn't match / couldn't hear it, re-record" prompt.

**Why:** an alignment that's too poor to report is still a *successful analysis* — we ran the pipeline and produced a truthful "can't tell" answer. Conflating that with a server failure would (a) lose the quality score and re-record guidance the UI needs, and (b) make `failure_reason` do double duty for "your recording was unusable" and "our server broke." Keeping the two axes separate keeps each field meaningful.

**Alternatives considered:**
- *Map `alignment_failed` → DB `failed`.* Rejected: throws away `alignment_quality`, and the UX for "re-record, we couldn't match it" is different from "something broke, retry."
- *Add new enum values.* Rejected: the DDL is treated as fixed from the build side (same stance as the Batch 1 FK decision); `result_json.status` already carries the nuance without a migration.

---

## 2026-07-24 — Compressed-audio decode (AAC/m4a) depends on ffmpeg in the deployed image

**Context:** the mobile client uploads AAC/m4a (spec §4 — ~2 MB vs ~10 MB WAV). `load_audio_bytes` spills the storage blob to a temp file and calls `librosa.load`. librosa decodes WAV/FLAC/OGG via `soundfile` (bundled libsndfile), but AAC/m4a falls through to the `audioread` backend, which shells out to **ffmpeg**.

**Decision:** treat ffmpeg as a deployment dependency of the backend image, not something the app code can guarantee. Unit tests use WAV so CI needs no ffmpeg. Flagged here and in EDIT_LOG so that "m4a analyses fail in prod but pass in CI" is a one-grep answer, not a mystery.

**Follow-up (not done this batch):** add ffmpeg to the backend Dockerfile / buildpack, and consider transcoding to WAV at upload time (or having the client upload WAV for the short calibration clip) if the ffmpeg dependency proves fragile.

---

## 2026-07-24 — Alignment quality = timing-fit × coverage, with lead-in latency removed

**Context:** Batch 3 needs a single 0..1 `alignment_quality` (spec §7) that gates the "show a warning" (<0.7) and "refuse to report" (<0.4) paths. The obvious metric — normalize the raw DTW path cost — is wrong in two ways.

**Decision:** compute quality as `timing_quality × coverage` where:
- `timing_quality` scores the residual per-note timing error **after subtracting the median detected-minus-expected offset**, so a constant recording lead-in (reaction time before the first note) counts as zero error. A player who starts 200ms after tapping record but then plays perfectly is a 1.0.
- `coverage` = fraction of expected notes actually matched. This catches the degenerate case timing-alone misses: one perfectly-placed onset against an 8-note score scores 1.0 on timing while 7 notes went unheard. Weighting by coverage flags a "played two bars then stopped / wrong page" take as broken.

Separately, `compute_deltas` anchors its origin on the **first matched onset** (not the median), so gradual drift shows up as a growing per-note delta — which is exactly what the rolling trend and verdict key on. Quality and deltas deliberately use different origins because they answer different questions (shape-fit vs. drift-from-start).

**Alternatives considered:**
- *Raw normalized DTW cost.* Rejected: dominated by the constant lead-in offset (a clean take scored ~0.2 and tripped the "broken" gate in testing) and blind to coverage.
- *Median-offset removal for deltas too.* Rejected: it would center a uniformly-rushed performance into "half drag, half rush" and erase the very drift we're trying to report.

**Trade-off accepted:** the quality curve's one magic number (0.5 beats of average residual error = quality 0) lives documented in `_quality_from_cost`; it's a starting anchor meant to be re-shaped during the tuning loop, not a claim of correctness.

---

## 2026-07-24 — Synthetic click-track fixtures for Batch 3 unit tests; real-recording tuning deferred

**Context:** the Batch 3 DoD lists "all 10 real fixture recordings produce reasonable verdicts." That is a human-ear judgement against real audio, and the tests need to run in CI with no WAVs checked in.

**Decision:** split the two concerns. Unit tests use programmatic click-track fixtures (`audio_helpers.synth_click_track`) with attacks at times we control exactly — these deterministically pin down *pipeline correctness* (onset counts, expected-onset math, DTW mapping, band boundaries, verdict runs, graceful failure). The *threshold-tuning* half of the DoD — is `delta=0.07` right, are the bands where a musician's ear puts them — is explicitly left to the tuning loop and `TUNING_LOG.md`, because it can't be answered without the real six-clip corpus.

**Alternatives considered:**
- *Check real recordings into the repo as test fixtures.* Rejected for now: binary bloat in git, and they'd still need the human-ear pass to be meaningful. Belongs with the tuning corpus, not the unit suite.
- *Claim the DoD is fully met.* Rejected — dishonest. The pipeline is correct; the numbers are untuned. EDIT_LOG and TUNING_LOG say so plainly.

---

## 2026-04-26 — `public.users.id` references `auth.users(id)` ON DELETE CASCADE

**Context:** the canonical DDL in spec §2 (rev 14) declares `public.users.id uuid PRIMARY KEY DEFAULT gen_random_uuid()` with no FK to `auth.users(id)`. During Batch 1 live verification we deleted a Supabase auth user via `auth.admin.deleteUser` and observed the corresponding row in `public.users` was orphaned, with no integrity check forcing `public.users.id` to map to a real auth user.

**Decision:** add `003_users_auth_fk.sql` — drops the `gen_random_uuid()` default on `public.users.id` (it was never used; ids always come from `auth.users.id`) and adds `FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE`. Standard Supabase pattern.

**Alternatives considered:**
- *Defer to Batch 12 (teacher tier).* Rejected: every batch built on top inherits the orphan-row hazard, and downstream tables (`scores`, `analyses`, `assignments`) all CASCADE off `public.users.id` — they'd accumulate ghost data tied to deleted auth users.
- *App-level cleanup sweep.* Rejected: trades referential integrity for a polling job that has to stay correct forever. The DB constraint is bulletproof and free.
- *Update the spec itself.* The user owns the spec — they can fold this back into their own copy. We're treating spec rev 14 as immutable from the build side.

**Production note:** the migration's leading `DELETE FROM public.users` is safe in dev (table is empty by construction) but destructive in production. Production adoption requires a backfill step (validate every `public.users.id` matches an `auth.users.id` first, then add the FK without the DELETE). Not in scope for Batch 1.

---

## 2026-04-26 — Verify Supabase user JWTs via JWKS / ES256, not HS256 shared secret

**Context:** spec §Batch 1 and the auth-middleware code stub assume Supabase signs user access tokens with HMAC-SHA256 and a shared secret available at Project Settings → API → JWT Settings → "JWT Secret". `app/auth.py` was originally written that way: load `SUPABASE_JWT_SECRET` from env, `jwt.decode(token, secret, algorithms=["HS256"], audience="authenticated")`.

**What we hit:** the user's freshly-created Supabase project ships under the *new* asymmetric signing system. There is no HS256 shared secret to copy. `GET <SUPABASE_URL>/auth/v1/.well-known/jwks.json` returns an ES256 (Elliptic-Curve P-256) public key with a `kid`. The "JWT Secret" field that the spec references no longer exists; what looks like one in the dashboard is the JWKS `kid` (a UUID identifying which public key to use), not a signing secret. Tokens issued by `supabase.auth` for end users are signed with the corresponding ES256 private key on Supabase's side, and clients verify with the public key from JWKS.

**Decision:** verify user JWTs via `PyJWKClient` against the project's JWKS endpoint, accepting `algorithms=["ES256", "RS256"]`. Drop `SUPABASE_JWT_SECRET` from the env surface entirely. Keep `audience="authenticated"` (the #1 silent-failure pitfall).

**Alternatives considered:**
- *Stay on HS256 + shared secret.* Would require the user to ask Supabase support to flip the project to legacy HS256 mode; not always possible on new projects, and a one-way street back to the old design.
- *Manually fetch and cache the JWKS ourselves.* Reinvents PyJWT's `PyJWKClient`, which already caches in-process. No upside.
- *Verify with the symmetric service-role JWT secret* (since the legacy service-role JWT is HS256-signed). The shared secret behind that token is not the same as the user-token signing key in the new system, so this doesn't actually work; we tested it.

**Trade-offs we accepted:**
- One extra HTTP fetch on first verification per process (the JWKS call). PyJWKClient caches indefinitely; on a hot path it's free.
- JWKS fetch failure becomes a 401 path. Acceptable — if Supabase's auth server is unreachable we'd fail anyway.
- Tests now mint real ES256 tokens with a generated keypair rather than HS256 tokens with a string secret. Slightly more setup; honest decoder coverage.

**Implementation:** see `backend/app/auth.py` (`_get_jwks_client`, `_decode_token`) and the `_stub_jwks` autouse fixture in `backend/app/tests/conftest.py`. `cryptography` is now a dev dep (also already a transitive runtime dep through `pyjwt`).

**Affected code paths:**
- `app/auth.py` — full rewrite of `_decode_token`.
- `app/config.py` — `SUPABASE_JWT_SECRET` removed from `Settings`.
- `backend/.env.example` — env slot removed; comment explains why.
- `backend/.env` (local, gitignored) — env slot removed locally too.
- `app/tests/conftest.py` — generates ES256 keypair, exposes `make_token` + `bad_token` fixtures, autouse-stubs `auth._jwks`.
- `app/tests/test_auth.py`, `test_me.py`, `test_upload.py` — switched to `make_token` fixture; new test `test_signature_from_wrong_key_returns_401` exercises the wrong-key rejection path that the previous HS256 secret-mismatch test couldn't cover meaningfully.

**Reversibility:** if a future project ever runs in HS256 mode, swap `_decode_token` back to use a secret loaded from env. Tests would need their own corresponding swap. Estimated ~30 min round-trip.

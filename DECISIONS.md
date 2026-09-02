# InTempo Decisions

Architectural "X over Y because Z" choices only. Format: date, decision,
alternatives considered, why we picked this. See intempo-combined.md
Operating Principle #5.

---

## 2026-09-02 — A field on the measure over a list of key changes

**Context.** A page can change key, and the schema had one `key_signature` on
the score. Two shapes were available for recording a change: a
`key_changes: list[KeyChange]` alongside `tempo_changes` and `repeats`, or a
nullable `key_signature` on `Measure` alongside `time_signature` and `clef`.

**Decision.** The field on `Measure`.

**Why.** The two existing shapes are not arbitrary — they divide on whether the
thing has *extent*. A `rit.` has no printed end: what stops it is the next
marking or the music, so `tempo_change_spans` derives its extent and a list is
the only honest home for it. A repeat names a span outright. A key signature
has neither: it is printed at a bar and holds until another is printed, which
is exactly what `time_signature` and `clef` already are and exactly how
`meters_in_force` already reads them. Recording it as a list would mean a third
walk to answer "what key is bar 40 in", when two such walks already exist and
agree.

The measure field also survives everything that rebuilds a measure by spreading
it — `MeasureEditScreen`, `join_pages`, `_expand_multiple_rests`, `renumber` —
because they all carry unknown fields. A parallel list has to be shifted by
hand at every one of those points, and `pages.py` and `pipeline.py` already
carry that cost for `repeats` and `tempo_changes`: both offset every
`measure_number` by hand, and getting it wrong attaches a marking to the wrong
bar silently.

**Alternatives considered.**

- *`key_changes: list[KeyChange]`.* Rejected on the above. It also makes the
  common case — a piece that never changes key — carry an empty list through
  every join and trim, where the measure field simply is not there.
- *Re-deriving the key from the accidentals actually printed.* Rejected. It is
  not recoverable: a page in G with no F in it prints no sharp, and a bar of
  chromatic writing in C prints many. The signature is a fact on the page and
  the reader's job is to read it, not to infer it.
- *Storing fifths (an integer) rather than the key name.* Tempting, because
  every comparison here is by signature and `key_fifths` exists to do it. But
  `ScoreJson.key_signature` is a name — read off the page as printed, `"unknown"`
  allowed — and a measure that spoke a different language from the header would
  need converting at every boundary. The name is stored; comparison converts.

**Trade-off accepted.** "Bb major" and "G minor" are one signature under two
names, so every comparison has to go through `key_fifths` / `accidentalCount`
rather than string equality. That is a real footgun — a future `!=` on the
names would report a change the page does not print — and it is why the
comparison is done in one named helper on each side rather than inline.

---

## 2026-09-01 — Grafting two glyphs from an older Bravura, over the alternatives

**Context.** Fermatas needed drawing (`EDIT_LOG.md`, same date). The glyphs are
`E4C0`/`E4C1`, which the shipped subset does not contain. The shipped subset is
Bravura **1.482**; every Bravura reachable from this environment is **1.392** —
the npm packages, the copy vendored by Audiveris on this machine. Steinberg's
own release and the CDNs that mirror it are refused by the egress proxy.

**Decision.** Graft `fermataAbove` and `fermataBelow` from 1.392 into the 1.482
subset with `fontTools.merge`, and add `E4C0-E4C1` to `tools/subset-bravura.py`
so a future regeneration against a real 1.482 ends the special case without
anyone needing to remember it.

**Alternatives considered.**

- *Regenerate the whole subset from 1.392.* Rejected on a measurement: **45 of
  the 76 shipped glyphs differ** between 1.392 and 1.482 — the treble clef,
  every accidental, every flag, three of four noteheads. Two new marks are not
  worth silently redrawing most of the app's notation, and the redrawn version
  is the older one.
- *Draw the fermata as a path.* Rejected. It is the rule this project already
  argued out for the treble clef: hand-approximated notation is the first thing
  a musician notices. A fermata is simpler than a clef, which makes it a
  tempting exception, and the exception is how the rule stops meaning anything.
- *Wait for the owner to supply 1.482.* Rejected as the default but it is the
  real fix, which is why the script and this entry both say so. Blocking a
  correctness fix — a musician being told they dragged a note the page told
  them to hold — on a font-file errand is the wrong trade.

**Why the graft is safe here specifically, and how that was checked.** All six
articulation glyphs (`E4A0-E4A5`) and the augmentation dot are byte-identical
across the two versions while the core glyphs are not: the marks were left
alone in the release that redrew the clefs. The fermatas sit in the same block
as those marks. That is evidence, not proof — no 1.482 fermata exists here to
compare against — and it is the strongest available. The merge was then
verified to alter **zero** previously shipped glyphs and to reproduce both new
ones byte-for-byte from the source.

**Trade-off accepted.** The shipped binary is no longer purely the script's
output, which is exactly the failure mode the script's own docstring warns
about ("a checked-in binary nobody can regenerate is a binary nobody can
update"). Mitigated by writing the divergence into the script itself rather
than a commit message, and by making the regeneration path already correct.

---

## 2026-09-01 — Measure the engraver against the schema, over against the fixtures

**Context:** `tools/engraver-coverage.py` reported **100% of every page in the
corpus**, 0 of 393 notes without a glyph. Four of the schema's forty-six
durations had no glyph at all, and the corpus could not see it: not one of the
ten fixture pages contains a note shorter than a sixteenth. The same tool once
read 5% missing with a worst page of 67% while the first real orchestral part
photographed scored **0%** and rendered as a title and a photograph.

The tool's own header already said why — "every fixture here is a page somebody
chose in order to check something" — and then went on reporting the number that
sentence disowns.

**Alternatives considered:**

1. **Grow the corpus.** The direct reading of the problem, and it does not
   converge: any set of pages is a set somebody chose, and the failure mode is
   precisely the page nobody thought to add. It also costs a real page per gap,
   which is the scarcest thing this project has.
2. **Trust the worst page instead of the average.** Already the rule, already in
   `CLAUDE.md`, and it did not help — the worst page was also 100%.
3. **Measure against the vocabulary the backend is allowed to send.** Taken.
   `score_schema.DURATION_BEATS` is closed, shared with the app, and load-bearing
   on both sides; every value in it can arrive on a real page tomorrow.

**Decision:** coverage is reported against the schema as well as the corpus.
`tools/engraver-coverage.py` prints both tables, and
`mobile/src/lib/notation/durations.test.ts` asserts the app side of it — every
duration draws except a named list of four. `CLAUDE.md` §7b now says to read the
schema table, because a rule that says "read the worst page" was satisfied by a
corpus where the worst page was perfect.

**Trade-offs accepted:**

- **The schema number says nothing about real pages.** A page can be read wrong
  in a hundred ways that have nothing to do with which durations exist. The
  corpus table stays for exactly that reason; this is a second measurement, not
  a replacement.
- **A named exception list has to be maintained.** `DELIBERATELY_UNDRAWN` will
  go stale the day something in it becomes drawable — but it fails loudly then,
  which is the opposite of how the corpus number went stale.
- **It made four values drawable that no page here needs.** The 32nd, the 64th,
  the double dot and the breve cost a wider font subset (25.2 KB → 27.0 KB) and
  a second dot in the renderer. A Kreutzer study is thirty-seconds; a march is
  written with double dots. They are not exotic, they were only absent from the
  fixtures.

---

## 2026-09-01 — One AudioContext for the life of the page, over one per playback

**Context:** the owner reported that Listen works once and not again, on every
screen that has the button. Both web players built an `AudioContext` when they
started and closed it when they finished.

**Alternatives considered:**

1. **A context per playback, closed at the end.** What shipped. It is the
   obvious reading of "acquire, use, release", and it is wrong on the platform
   that matters most here: iOS Safari caps how many audio contexts a page may
   hold and `close()` does not reliably return the slot. The failure is
   invisible — the button toggles, the schedule is built, every oscillator is
   created and started, and nothing comes out — so nothing short of counting
   contexts notices it.
2. **A context per playback, closed more carefully.** Chasing every path that
   can skip the close: a hidden page that never delivers the ending frame, an
   unmount mid-play, an exception. Each is fixable; the set is not closed, and
   every miss is permanent for that page.
3. **One context, created lazily, never closed.** Taken.

**Decision:** `lib/audio/context.web.ts` owns a single context, built on the
first sound and resumed before every play. Web Audio is built for this — a
context is a mixer, not a sound — and the resource being conserved is the thing
iOS actually meters.

**Trade-offs accepted:**

- **A running context costs something when nothing is playing.** Real, and
  small: an idle context with nothing connected does no work beyond holding an
  audio thread. Against it, the leak the old code produced was a context that
  could never be reclaimed at all.
- **Cancellation had to be rebuilt.** The metronome was using `close()` as its
  cancel — a click booked 250 ms ahead must not sound after the take ends — so
  each run now owns a gain node and disconnects it. Same silence, nothing else
  taken down with it. This is the part a future edit is most likely to undo by
  accident, so it is asserted directly.
- **One context is shared between the player and the click track.** They cannot
  be independently interrupted. Nothing wants that: they are the same app
  making sound to the same person, and a metronome another part of the app can
  duck is the failure logged against `interruptionMode` on the native side.

The recorder keeps its own context (`audioRecorder.web.ts`). It is not sharing
a mixer with playback; it is an analyser on a microphone stream with a
different lifetime, and iOS gives recording its own session anyway.

---

## 2026-09-01 — Ship a music font rather than draw notation by hand

**Context:** the owner asked for the transcription to read as a page —
*"instead of writing like how were doing where you scroll and what not. Make
it generate a sort of sheet music page look, like how you see on music score
or flat io."*

The obstacle is real and `engrave.ts` had already named it: *"a clef is a piece
of calligraphy; a hand-approximated treble clef in an app for classical
musicians would be the first thing a reader noticed and the last thing they
forgave."* So it drew **no clef at all**, which was the right call given the
options it had. The same reasoning had kept the key signature off the page:
`key_signature` has been read since Batch 2 and shown only as text, so a piece
in E major was engraved with four accidentals missing from every system.

**Alternatives considered:**

1. **Hand-authored SVG paths for the clefs.** The cheapest, and it is precisely
   the near-miss `engrave.ts` refused. A treble clef is a spiral with four
   centuries of settled proportion; an approximation is legible and wrong, and
   a musician sees it instantly.
2. **Keep drawing nothing.** Honest, and what shipped. It also means the app
   can never show a key signature, which is not a stylistic omission — it is
   music the page contains and the screen does not.
3. **Bundle the full Bravura.** 889 KB for a few thousand glyphs, of which this
   app draws forty.
4. **Bundle a subset of Bravura.** ← chosen. **22 KB.**

**Decision:** `mobile/assets/fonts/Bravura.otf`, subset in-repo by
`tools/subset-bravura.py`, loaded alongside the app's text faces and used by
`Stave` for clefs, key signatures and time signatures.

Bravura is the reference implementation of SMuFL and the font MuseScore ships;
flat.io and MuseScore look the way they do largely because of it. It is SIL
Open Font License 1.1, so it can be redistributed inside an application. The
licence text sits beside the font and the Acknowledgements screen lists it —
a page that credits every MIT package while omitting the one file with an
actual attribution requirement would be backwards.

**Why a font and not paths, beyond the drawing quality.** A SMuFL em is four
staff spaces *by definition*, so `fontSize = 4 * lineGap` renders every glyph
at exactly the right size for that staff, at any scale, with no per-glyph fudge
factor and no second set of numbers to keep in step with the engraver's
geometry. That property is the reason SMuFL exists.

**Trade-offs accepted.** 22 KB of binary in the repository, and a font is not
reviewable in a diff — which is why the subset is produced by a checked-in
script against a named upstream rather than pasted in. A glyph used without
being added to that script's ranges renders as **nothing at all**, silently: a
music font has no tofu box. The codepoint table in `Stave.tsx` says so at the
point where someone would add one.

Noteheads, rests and flags are still drawn by hand and still look right; moving
them onto the font is a further change with its own geometry to re-verify, and
it is not part of this decision.

---

## 2026-09-01 — Record the upload, rather than walking the bucket

**Context:** CLAUDE.md has carried this since 2026-08-24 under its own heading,
and explicitly said what it needed: *"Known hole, unfixed: orphaned uploads. An
upload that never becomes a score row is permanent and unreachable… This
contradicts the rule above it; it needs a lifecycle decision, not a patch."*

The rule it contradicts is *"The photograph is deleted only when a person
accepts the reading."* That rule is about **who decides**, and it is right. It
says nothing about photographs that never became a reading at all, and those
have no path out — no row, so no accept, no delete, and no request a musician
could make about their own file.

Three ordinary things produce one: backing out of the naming screen after the
upload finishes, a save that fails after the bytes land, and a transcribe
retried against a fresh key. None is an error.

**Alternatives considered:**

1. **Sweep the bucket.** List the storage bucket and delete what no `scores`
   row references. Correct, and it scales badly: objects live under
   `{user_id}/{uuid}`, so it is one list request per user folder per sweep,
   forever, almost always to be told there is nothing to do. It also cannot
   state the invariant — it can only keep rediscovering it.
2. **Delete from the client when the musician backs out.** Handles the common
   case and none of the others: an app killed mid-flow, a crash, a lost
   network. It cannot be the only mechanism, and as a second one it is extra
   surface for a case the sweeper already covers.
3. **Create the row first, upload second.** Removes the window entirely and
   reverses the whole capture flow — the scanner uploads pages before there is
   a title to name a piece with, and asking for one first is a worse product to
   fix a storage leak.
4. **Record the upload in a table, and sweep that.** ← chosen.

**Decision:** `pending_uploads` (migration 014). The upload endpoint inserts a
row when it signs a key; the endpoints that consume an object delete it. The
sweeper — already running on a timer for stuck analyses and transcriptions —
deletes objects whose row is older than `UNCLAIMED_TTL_HOURS` (24), and their
rows.

It makes the invariant sayable, which the bucket walk never could: **every
object in these buckets has a row somewhere** — a `scores` row because it
became a piece, an `analyses` row because it became a take, a `users` row
because it became a face, or a `pending_uploads` row because it has not become
anything yet. An object with no row is now a bug rather than a Tuesday.

**Trade-offs accepted.**

- **A day of latency.** An abandoned photograph sits for up to 24 hours. The
  gap between minting a key and creating the row is seconds, so an hour would
  do; a day is chosen because sweeping too early deletes a page somebody is
  still using and sweeping too late costs a few megabytes for a few hours.
- **Bookkeeping that can fail.** `record` never raises: failing to record costs
  a swept object later, and failing the *upload* because the bookkeeping failed
  costs the musician their page. So the invariant is best-effort at the
  recording end — an unrecorded object is exactly as orphaned as before, which
  is no worse than the status quo it replaces.
- **Two orderings that must not be inverted**, and both are tested. A key is
  claimed *after* the row exists, never before, or a failed save strands the
  object — one of the three cases this was written for. And the sweeper removes
  the **object before the row**: a row deleted first leaks its object silently
  and permanently, which is this bug reintroduced one level down.

All three buckets, not just `score-images`. A take's audio and an avatar are
minted the same way and abandoned the same way; only the page had ever been
talked about.

---

## 2026-09-01 — The count-in is audible, and the pre-roll is thrown away

**Context:** the owner asked for a conductor's count-in — *"when they click the
record give them a haptic and tick sound countdown for when to start, just like
how an conductor does when he counts you in."*

The obstacle is real and is why the count-in was silent. `alignment.py` measures
every onset **from the first one it detects**, so a click over the phone's
speaker while the microphone is open does not merely add noise: it becomes the
note the entire take is judged against, and every measure after it is reported
against a timeline that started on a metronome tick. That is the whole reason
the audible metronome mode is named `audio_with_headphones` and is the
musician's own assertion rather than something the app detects.

And the microphone is deliberately already open: `start()` opens the recorder
*before* the count so that no unpredictable hardware start-up delay lands
between "four" and the downbeat, in an app whose subject is exactly where notes
land.

**Alternatives considered:**

1. **Count in before opening the microphone.** Removes the leak completely and
   reintroduces the delay the current ordering exists to avoid — 100–300ms of
   variable latency at the one instant that must not be variable.
2. **Send the count-in and have the backend trim it.** A new field on the take,
   a new contract between two implementations, and the app's word for something
   the server cannot check.
3. **Keep the count-in silent unless headphones are asserted.** What it did.
   Nobody is counted in on speaker, which is most takes.
4. **Discard the pre-roll in the app.** ← chosen.

**Decision:** `Recorder.discardCapturedSoFar()` drops everything captured so far
and keeps recording; the Record screen calls it on the downbeat, at the same
instant it flips out of `counting_in`. The count-in ticks and taps whatever the
take's metronome is set to — including "off", because a count-in is not the
metronome feature, it is how a take starts — and those seconds never leave the
phone.

**Trade-offs accepted.** The clicks are still *recorded*, briefly, so a bug that
failed to call the discard would leak them; the call sits on the same line as
the phase change so that the two cannot drift apart, and `countIn.ts` states the
rule where it is tested. The downbeat's own accent click is inside the kept
audio by one click-length; it coincides with the note the musician plays, so it
adds no onset the alignment does not already expect there. And the take's
metronome is unchanged: after the count, only `audio_with_headphones` clicks,
because that audio cannot be discarded.

---

## 2026-08-30 — A vision model may correct a bar, but may never read a page

**Context:** the chain has been homr alone since 2026-08-24, when the owner
called it — *"run homr only, no backup AI"* — because the vision models had
invented notes: handed a page they could not read, they returned notation nobody
had printed, at a confidence the app drew as a transcription. That decision was
right and the evidence for it is in `config.py` beside `OCR_PROVIDER_CHAIN`.

It had a cost nobody had priced. `confirm.retry_with_arithmetic` re-reads the
bars whose durations do not add up — it names them, asks for those and nothing
else, and splices the answer back over only those bars. It can only ask a
provider that `takes_a_note`, and homr is deterministic with no prompt. So since
that day the branch has logged *"cannot reconsider"* and stopped, on every page
that needed it. The single mechanism this pipeline had for repairing a misread
bar has been dead for the whole of its production life.

The owner proposed the resolution on 2026-08-30: *"if the model cant effectively
read or note or is not that confident we have a Visual llm such as claude to
review it and correct that bar for the model."*

**Decision:** `OCR_CORRECTOR` names a provider that answers the arithmetic
retry, and nothing else. Empty by default. The reading is always homr's; a
corrector can only edit parts of it that arithmetic has already proved untrue.

**Why this is not the thing that was turned off.** The failure was not "a vision
model was involved". It was that a vision model was asked an **unfalsifiable**
question — *what is on this page* — and there was nothing to check the answer
against, so an invention and a reading were the same shape. This question is
different in the one way that matters:

| | reading a page | correcting a bar |
|---|---|---|
| what is asked | what is here | this bar sums to 3 in 4/4, look again |
| how many bars it may write | all of them | only the ones already proved wrong |
| what happens if it invents | stored and drawn | still does not sum, discarded |

Four limits, all already in `confirm.py` and all now load-bearing rather than
theoretical: only bars in `asked_for` are spliced, so a retry aimed at bar 2
cannot rewrite bar 12; a reply leaving more bars broken than it found is thrown
away; a metre cannot be lost by omission; and nothing here raises, so a failed
correction costs the page nothing.

**Alternatives considered.**

*Teach homr to reconsider.* It is an ONNX model with no prompt. Asking it again
returns the same answer, which is why the branch was dead.

*Send the whole page to a vision model when homr's confidence is low.* This is
the thing that was turned off, restated. A low-confidence page is exactly the
page a model is most likely to invent on, and nothing checks the result.

*Ask the musician instead.* `MeasureEditScreen` already does, and stays the
final authority. But a page with nine broken bars is nine repairs by hand before
a single practice, and most of them are the same misread beam.

*Leave it dead and widen the vocabulary instead.* Partly done — 17 note values
were added the same day, and every one closes a real drop. But a bar can fail to
add up for reasons no vocabulary fixes: a beam misread, a rest missed, a tuplet
bracket lost.

**Trade-offs accepted.**

- **It costs money per page that needs it**, on a metered API, which is why it
  is off by default and named rather than implied.
- **The residual risk is a plausible wrong answer**, and it is real: a corrector
  told "bar 14 is short" might look at bar 15, return something that sums, and
  be accepted. The arithmetic guard catches invention that *does not add up*, not
  invention that does. Sending a crop of the bar would close this, and the bar's
  position on the page is not something homr's MusicXML reliably carries — see
  the follow-up below.
- **The musician is not yet told which bars a corrector touched.** They should
  be; `Measure` has no field for it and adding one reaches the app, so it is a
  separate change under the UI gate.

**Follow-up, in order:** mark corrected bars in the score so the caveat line can
name them; then locate bars on the page — via `<print new-system="yes">` where
homr emits it — so a correction can be asked about a crop rather than a page.

## 2026-08-29 — The photograph is kept only where a person said so, and withdrawal deletes

**Context:** migration 007 deletes the page photograph when a musician accepts
the reading, and every reason it gives still stands — a page is megabytes of
JPEG whose one remaining purpose has just been served. What changed is that
there is now a second purpose: the page, the reading, and the correction made
against it are the training example that makes the reader better, and that is
the one asset here nobody can buy.

**Decision:** keep the photograph *only* where the account has explicitly
agreed, record corrections the same way, and make withdrawal delete both. With
no consent, nothing about the existing behaviour changes in any way — this is
007 with a gate in front of it, not a reversal of it.

**Alternatives considered:**

- **Keep every photograph and ask later.** The cheapest way to start the
  flywheel, and it takes the decision away from the person whose photographs
  they are. Also a storage bill that grows with every scan, on a project already
  near its egress cap.
- **Infer consent from something already stored** — the tier, an existing
  privacy setting, having shared to a studio. All of these are a way of not
  asking, and none of them is what the person agreed to.
- **A boolean rather than a timestamp.** A consent record has to answer *when*
  they agreed, because the wording changes and a boolean cannot say which
  wording it belongs to. Re-granting therefore keeps the original timestamp
  rather than re-stamping, or the answer becomes the date of the last save.
- **Keep a `withdrawn_at` tombstone.** Useful for an audit trail, and it is a
  row recording that someone once consented, retained after they asked to be
  forgotten. NULL means all three of "never asked", "declined" and "withdrew",
  because all three mean the same thing to every caller.
- **Store the whole `ScoreJson` before and after.** The obvious shape, and it
  stores sixty-eight unchanged bars twice to say nothing about them, then makes
  whoever trains on it diff the signal back out. One row per corrected measure.

**Failing closed, which is the opposite of the sibling rule.** `shouldOnboard`
deliberately fails *open* — a slow or failed `/v1/me` opens the app rather than
holding it behind a network request (2026-08-25) — because the cost of guessing
wrong there is one screen shown twice. Here the cost is keeping a person's
photographs without being told to, so every uncertainty is a no: no row, no
timestamp, a value that is not a timestamp, a lookup that threw. `may_keep_
corrections` takes the row rather than a user id specifically so it cannot do
IO, because a consent check that can time out is one that can fail open.

**What is deliberately weaker than it should be:** the training example wants an
*image crop* of the bar, and the finest pointer available is the page key plus a
measure number. homr knows where each measure sits and neither `musicxml.py` nor
the schema carries it. Recording the honest pointer now is what makes
re-locating the bar possible later; inventing a crop we do not have would not.

**Known cost, accepted:** retention makes the bucket grow where it used to
shrink, on a project whose egress is the thing being watched. It is bounded by
being opt-in and by nobody being able to opt in until the consent screen
exists — but when that screen ships, storage growth becomes a real number to
watch rather than a hypothetical.

---

## 2026-08-29 — Tuplet names are additive; the pitch grammar is not, so it waits

**Context:** two gaps in the schema were discarding music that homr had read
correctly. Both looked like one-line widenings. Only one of them is.

Measured before deciding, on fixtures in this repository:

    5:4 quintuplet, bar otherwise correct   3 of 8 onsets kept, beat check "ok"
    Ebb3 in bass_excerpt.musicxml           note dropped, bar 3.0 of 4.0, "short"

**Decision:** ship the tuplet names (`quintuplet_*`, `septuplet_*`) now. Leave
`PITCH_PATTERN` alone, and record why here rather than leaving the next person
to rediscover the cost.

**Why the two are not the same size.** A duration is a *number*: adding a name
adds a row to one table, and every consumer either reads that table
(`DURATION_BEATS`, substituted into both browser tools by `sandbox_shared`) or
is forced by `Record<Duration, …>` to declare it. The compiler and
`test_client_enums` between them find every site. A pitch is a *string that
five separate places parse*, and only one of them imports the canonical
pattern. An audit of every consumer found:

- **`engrave.ts`** — `stepOf` returns null on an unparseable pitch and the
  caller draws the notehead at `step === null ? 0`, i.e. **on the middle staff
  line**. A double sharp would silently engrave as B4 in treble. There is also
  no flat glyph at all today (`accidentalOf` only ever returns `'sharp'`), so
  `##`/`bb` need new glyphs before they can be drawn at all.
- **`schedule.ts`** — `frequencyOf` returns null, and the note is dropped from
  playback while the clock still advances. Silent, not desynced.
- **`reading.ts`** — `stepPitch` and `cycleAccidental` return the pitch
  unchanged on a non-match, so the ▲/▼ and accidental controls become no-ops on
  **exactly the notes a musician would open the editor to fix**.
- **`frontend/src/lib/score.ts`** — a second grammar feeding `canSave`, so an
  imported score containing one would be unsaveable in the web editor.
- **`scan-bench.template.html`** — a third copy of the engraver; it degrades
  visibly (`?`) rather than silently, which is the only one that fails well.

So widening the regex alone converts "one note is missing, the bar is short,
and the beat check says so" into "the bar looks complete and a notehead is
drawn a seventh out of place." That is strictly worse by this codebase's own
standard — the rule that keeps `ScoreJson.clef` nullable, because a bass part
labelled "Treble clef" is worse than no label. **A wrong notehead presented as
a right one is the failure mode, not the missing note.**

**Alternatives considered:**

- **Widen the grammar and fix the four TS parsers in the same change.** The
  honest version, and what should eventually happen. It needs new accidental
  glyphs on the stave and a `cycleAccidental` that can reach and clear a double
  — both design decisions about a screen, which CLAUDE.md §2 gates. Not
  something to decide inside a schema change.
- **Widen the grammar now, fix the engraver later.** Rejected on the paragraph
  above: it trades a visible failure for an invisible one.
- **Keep the note's time as a rest**, the way an unwritable tuplet does. This
  is the tempting middle and it is wrong here for a reason that does not apply
  to tuplets: a tuplet's parts were *unnameable*, so a rest was the best
  available answer, whereas `Ebb3` is a note this app could name if it chose to.
  Writing a rest would make the bar sum correctly and silence the one check
  that currently catches it. Today the bar comes up short, the musician is
  shown a concern, and `MeasureEditScreen` can already correct pitch — so the
  existing behaviour is a working repair path, not a dead end.

**What it costs to wait:** a dropped note also shortens its bar, and
`alignment.py` accumulates durations, so every later bar on the page is judged
early. That is real. It is bounded by being *reported* — `unwritable_notes` and
the short verdict both fire — which is what makes waiting tolerable rather than
free. Double accidentals are common in sharp keys and romantic repertoire, so
this should not wait indefinitely.

**Also worth converging when that happens:** the copies already disagree about
octaves. The canonical pattern ends `-?\d` (one digit); `engrave.ts`,
`schedule.ts` and both scan-bench copies use `(-?\d+)`. `A99` is rejected by the
backend and happily engraved by the app today.

---

## 2026-08-27 — Skipping a long rest is a fact about the take, not a playback setting

**Context:** an orchestral part is mostly waiting, and practising the notes
around a twenty-bar rest means skipping it. The obvious shape is a playback
convenience — shorten the score the app plays and counts, leave the stored
score alone.

Measured, on a take played exactly on the grid with the rest skipped:

    bars of rest   waited through   skipped
    2              1.000            0.000
    4              1.000            0.000
    12             1.000            0.000
    20             1.000            0.000

Every note still matched. The shape simply cannot be explained by a steady
grid, so the verdict is `alignment_failed` — *"check you're on the right
piece"* — on a take that was played correctly. Note the two-bar row: this is
not about how long the rest is.

**Decision:** the choice travels with the take. `POST /v1/analyses` carries
`skip_long_rests`, migration 012 stores it, and the worker shortens the score
the same way before building the timeline. The rule itself lives in
`fixtures/practice/long_rests.json` and both implementations are tested against
it, the same arrangement as `fixtures/timeline`.

**Alternatives considered:**

- **Client-only.** What the feature looks like from the outside, and it makes
  every take that uses it unanalysable. Rejected on the numbers above.
- **Store the shortened score.** Then the piece in the library is not the piece
  on the page, and the next take — or the same musician tomorrow, playing it in
  full — is judged against a page with bars missing. Practising is not editing.
- **Detect it in the worker.** Look at the take, notice the rest was skipped,
  compensate. This is guessing, which is what the whole pipeline refuses to do;
  and a take that genuinely rushed a passage looks the same.
- **Store the number of bars skipped** rather than the choice. Derivable from
  the score and the rule, so it would be a second copy of an answer that has to
  match — the failure this project keeps finding. The row records the decision;
  the arithmetic stays in one place.

**Trade-offs accepted:**

- The feature is **inert until migration 012 is applied**, like `011`. The API
  writes the key *only when true*, so a deployment without the column is
  untouched until someone actually skips a rest — and then the insert fails
  loudly rather than the take being judged against silence nobody played. A
  visible error beats a wrong verdict.
- The threshold (four bars, one kept) is a judgement, not a measurement. Four
  bars at 60 BPM is sixteen seconds; below that a rest is phrasing rather than
  waiting. It lives in the contract file so moving it moves both sides at once.
- The bar that survives keeps its number, so the numbering has a gap where bars
  were skipped. That is the truth about what was played, and the verdict names
  measures by these numbers.

---

## 2026-08-26 — Refuse an unread page on its structure, not on its confidence number

**Context:** `04_handwritten_clean` comes back from homr as 7 measures holding
13 notes, five of the seven empty, no clef, no metre — `ocr_confidence` 0.00 —
and that was stored and drawn for a musician as their score. Nothing downstream
catches it: `_read_any_music` finds thirteen notes, the caveat line reports bars
that do not add up and none of these are *wrong*, and with a homr-only chain
`CONFIDENCE_THRESHOLD` has nothing to fall through to, so the 0.00 reading is
returned as the answer.

**Decision:** the provider refuses a page on what the reading *is* — no bars at
all, more empty bars than bars with music, or no checkable bar that checked out
— and never on `ocr_confidence`.

**Alternative considered, written first, and reverted: `if ocr_confidence <= 0`.**
One line, refuses `04`, passes every test I had written for it.

It is wrong because of what a zero means. `_confidence_from_arithmetic` counts a
bar only if its verdict is `ok` or `pickup`; a bar whose metre could not be
established is `unverifiable`, which means **not shown to add up**, not *wrong*.
A photograph of an inner page carries no header, and when
`infer_beats_per_measure` cannot find three measures agreeing 60% of the time,
every bar on that page is `unverifiable` and the confidence is 0.00 — with all
of the durations correctly read and the timeline perfectly usable. Refusing on
that number reads "not proven" as "disproven", and the page it throws away is
the commonest page anyone photographs.

**Trade-offs accepted.** Three checks instead of one, and one of them
(`holes * 2 > len(measures)`) is a comparison somebody could argue with. It is
deliberately a comparison and not a fraction, so there is no constant fitted to
a photograph; a rest is a note in this schema, so a page of multi-bar rests
reads as music and cannot trigger it. The refusals are also *structural*, which
means they can miss a page that is confidently and completely wrong — nothing
here substitutes for the musician looking, which is why
`POST /scores/:id/accept` exists and why nothing else may discard the
photograph.

---

## 2026-08-25 — Sync handlers on Starlette's threadpool, over an async Supabase client

**Context:** Every request handler in the API was `async def`, contained no
`await`, and called Supabase through its synchronous client. Starlette runs a
coroutine endpoint on the event loop, so each of those blocked it: the server
served one request at a time. Measured on the real app with a 1s database call
— six concurrent requests took 6.02s, and `/v1/health` answered in 5.86s while
they ran. The app blocks every screen on that health check while it wakes the
host, so the cost was not one endpoint's latency, it was the whole app's.

**Decision:** drop `async` from the twenty handlers and the three auth
dependencies. FastAPI then runs each in a worker thread, and the blocking calls
inside them stop mattering. Same six requests: 1.01s, health check 0.002s.

**Alternative considered: an async Supabase client (`acreate_client`).**
The principled fix — genuinely non-blocking I/O, no thread per request, and a
ceiling set by sockets rather than by a 40-thread pool.

Rejected for now, on the size of the change against the size of the problem.
It means `await` on every query in six routers, two workers, `provisioning`,
`tier_limits` and `readiness`; it splits the Supabase client in two, because
`analysis_runner` and `transcription_runner` are sync functions called directly
by the Modal container and by `sweep_once` from a thread — so those would keep
the sync client and the codebase would carry both. That is a large diff through
every data path in the application, to fix a problem whose entire cause is a
keyword that was never doing anything. The measurement says a thread per
request is not the constraint here: this instance has 512 MB and
`TRANSCRIPTION_MAX_CONCURRENT` is 2, so memory binds long before forty threads
do.

**Alternative considered: more uvicorn workers.** Cheapest possible change, and
it would have raised concurrency from one to *n*. Rejected because it treats
the symptom: each worker still serves one request at a time, and on a 512 MB
instance there is not room for enough of them to matter. It also multiplies the
in-process transcription and analysis memory ceilings by the worker count,
which is the thing that OOM-kills this box.

**Trade-offs accepted:**

* Forty concurrent requests is now the ceiling (Starlette's default pool), and
  that pool is shared with sync background work. Handled by giving the
  transcription runner its own daemon threads, so a full read queue cannot park
  request-serving threads — the reason a scan queue waits by *blocking* a
  thread (`_scan_slots`) is a memory ceiling, and moving handlers into that
  same pool without separating them would have re-created the outage in a new
  place. Not a `ThreadPoolExecutor`: its `atexit` hook joins its workers, so a
  restart during a read would block for the length of the read — a stuck
  shutdown bought with the fix for stuck requests.
* A thread per in-flight request costs stack space. Immaterial next to a
  vision-model read.
* The rule now has to be *kept*. `async def` in front of a handler is a
  one-word change that silently returns the server to serving one request at a
  time, and a reviewer cannot see it in a diff — so it is asserted by
  `test_no_blocking_handlers.py` rather than written down as a convention. That
  test is the durable half of this decision; the keyword removal is the cheap
  half.

**What would reverse this:** an endpoint that genuinely needs to await async
I/O, or a deployment where thread count rather than memory is the binding
constraint. The test has an `_ASYNC_BY_DESIGN` set for the first, deliberately
empty, so adding an entry requires naming the async I/O it awaits.

## 2026-08-25 — The onboarding gate fails open, over holding the app until `/v1/me` answers

**Context:** Onboarding is shown when the account says nobody has been asked
yet. That fact lives on the server (`users.onboarded_at`, migration 009), so
the app cannot know it until `/v1/me` comes back. Something has to be on screen
in the meantime, and the two candidates are the app or a holding screen.

**Alternative considered: hold, the way the sign-in gate holds.**
`RootNavigator` already renders a bare ivory rectangle while `useAuthStatus` is
`loading`, and extending that to cover `useMe` is two lines. It has the
property the flash version lacks: someone signing up never sees Today appear
and then be taken away.

Rejected. That hold is a **local storage read**; this one would be a network
request. Every cold start, for everyone, forever, would put an unbounded
network wait between a musician and an app they already have an account for —
to serve a screen each account sees exactly once. This project has shipped a
blank screen over a working app once already (the boot watchdog, 2026-08-24)
and the same reasoning applies: signing in again is a recoverable annoyance, a
screen with nothing on it is an outage. `useAuthStatus` carries an 8-second
`SESSION_TIMEOUT_MS` for precisely this hazard, on a read that never touches
the network.

**Decision:** `shouldOnboard(me)` returns true only on a definite
`onboarded === false`. `undefined` — the query in flight, or failed — opens the
app.

**What it costs, stated plainly:** on the one launch after signing up, Today
renders for as long as `/v1/me` takes and is then replaced by the onboarding
screen. A flash, on one launch, on one screen.

**What it buys beyond the launch path:** the gate cannot lock anyone out. A
`/v1/me` that 500s, a backend that has not run migration 009 and sends no
`onboarded_at` at all, an offline start — none of them can hold the app shut,
because none of them produce `false`. Failing closed would turn every one of
those into an app that will not open, and the screen behind the gate is a name
and an instrument.

**Where it is written down:** `mobile/src/lib/onboarding.ts`, with the rule
tested in `onboarding.test.ts` — including the `undefined` case, which is the
whole decision and is otherwise invisible in a component.

---

## 2026-08-24 — Refuse a page the app cannot read, over reading it and marking the result uncertain

**Context:** A musician photographed an orchestral contrabass part with a
laptop webcam. It reached the backend as a 480×640 PNG. Every stage succeeded:
the eight systems were found, all eight were cropped and sent, and a
transcription came back — 67 measures, confidence 0.40, with its own
`notes_to_human` saying *"most pitches and rhythms in the pizzicato passages
are approximate reconstructions."* The app stored it and drew it as their
score. Their words for this were "it made something up", and that is exactly
what happened.

The machinery for doubt already existed and all of it fired. The chain saw
0.40, below `CONFIDENCE_THRESHOLD`, and tried every remaining provider. It
logged `returning low-confidence transcription`. `describeConfidence` puts a
quiet line on the piece screen when confidence is low. None of it helped,
because **every one of those says "this reading might be wrong" and the true
statement is "there was nothing here to read."**

**Alternative considered: make the doubt louder.** Refuse to draw a stave below
some confidence, or lead the screen with a warning. It is the smaller change
and it is available today. Rejected for two reasons. The number is
self-reported by the model that invented the notes, and a model confident in
its reconstruction reports a high one — the floor would be enforced against the
least reliable witness. And a warning still leaves invented notes in the
library, attached to a title the musician chose, ready to be practised
against and to be compared with a recording.

**Decision:** measure whether the page *can* be read, before anything reads it,
and fail the scan when it cannot. `staff_space_px` measures the staff-line
spacing from the autocorrelation of the ink profile within each detected band;
`too_small_to_read` refuses below `_MIN_STAFF_SPACE_PX = 8` source pixels, and
refuses when no band yields a staff period at all — which is the actual webcam
case.

**Why this measurement rather than the page's size:** pixel dimensions do not
say how much notation is in them. A one-system strip at 1200 px reads perfectly
and a ten-system page at 1200 px does not, and staff spacing is the quantity
that separates them. It is also the quantity every OMR engine cares about;
homr's own preprocessing normalises to a standard staff height.

**Trade-off accepted:** a scan can now fail that previously produced *something*.
That is the point — a failed scan can be retaken, and the photograph is kept so
retaking means pressing a button rather than finding the music again. The risk
that matters is the opposite one, refusing a page that would have read, and the
floor is set from measurement against every page in the repository plus the
downscale series of the real one (the table is on `_MIN_STAFF_SPACE_PX`). The
corpus's own unreadable fixture, `05_handwritten_messy.jpg`, measures 5 px and
yields zero measures; everything that reads measures 10–15.

**What would reverse it:** a real page that measures under 8 and reads
correctly anyway. `test_every_readable_fixture_in_the_repository_survives` is
the guard, and the floor is one constant.

---

## 2026-08-24 — Put screen *rules* in testable modules, over adding a React Native testing library

**Context:** A capture-path audit found nine defects, and the four that cost a
musician real work all lived in the same place: a decision taken inside a React
component. Where a photograph goes when the shutter fires. Whether a finished
drag commits. Which page a retake replaces. Every one of them was a branch in a
`.tsx` file, and **not one had a test**, because the mobile tree has vitest and
nothing that can render a component. Twenty-one test files, all of them pure
logic, and the entire capture path — `captureSession`, the scanner, the review
list, the upload screen — with zero.

**Alternative considered: add `@testing-library/react-native`.** It is the
obvious answer and it would test the components as they are. It also means a
jest-vs-vitest decision (RNTL's preset assumes jest; running it under vitest
means a custom environment and a react-native transform), a react-test-renderer
pinned against React 19.2.3, and a mocking surface for `expo-camera`,
`expo-image-picker`, `react-navigation` and `react-native-svg` before the first
assertion runs. The tests it then buys are largely *rendering* tests, and the
defects here were not rendering defects.

**Decision:** the rule moves out of the component into a module with a name, and
the component keeps only what a component is for — layout, and calling the rule.
`captureSession.capture()` decides where a photograph goes; `drag.ts` decides
whether a gesture commits; `transcriptionProgress.ts` already did this for the
progress bar, which is the precedent this follows rather than invents.

**What we accept:** navigation is still untested. `handleRetake` navigating to
the scanner instead of going back is argued in a comment and verified by hand,
not by a test — and that is a real gap, not a solved problem. The wager is that
the *decisions* are where the bugs are and the *wiring* is where they are
visible, which is what these nine findings say: eight of them were decisions.

**What would reverse it:** a defect that a rendering test would have caught and
a rule test would not — a control that stays pressable while its action is in
flight is exactly that shape, and one of the nine (`EmptyState` ignoring
`disabled`) already is. If a second lands, the library is worth the setup.

---

## 2026-09-08 — Mirror `uv.lock`'s versions into the Modal image, over installing from the lock itself

**Context:** `modal_app.py` built its image with the same lower bounds as
`pyproject.toml` — `librosa>=0.11.0`, `numpy>=2.4.6`, `scipy>=1.18.0` — and the
comment above them claimed that "a version that changes an onset by a frame
cannot arrive here without arriving in the tests too."

That is not what a lower bound does. The tests, the six-clip corpus regression
and Render all run what `uv.lock` resolved; a `>=` image resolves to whatever
PyPI holds on the morning it is built. They agree today only because the lock
has not moved off the bounds yet. The first librosa point release would have
given a musician a verdict from an onset detector nothing in this repository
had ever run, and the divergence would have been invisible: same code, same
config, different arithmetic, no error anywhere.

This is not a general reproducibility concern. It is specific to what this
container computes. The whole product is one number per bar — how far a note
sat from where it was written — and that number goes through a resampler, a
decoder, an STFT and a JIT compiler before anybody sees it.

**Decision:** `modal_app.py` pins exact versions, and `test_worker_image.py`
reads `uv.lock` and asserts each pin still matches. `uv lock` upgrading librosa
fails CI rather than shipping. The pinned set is the six direct dependencies
plus **`soxr`, `soundfile` and `numba`** — librosa's, not ours, named nowhere
in `pyproject.toml`, and the three places the samples actually move: `soxr`
resamples every take to 22.05 kHz, `soundfile` decodes it, `numba` compiles the
paths that find the onsets. Pinning librosa and letting its resampler float is
a fence with the gate open.

### Alternatives considered

**Install from the lock — `uv sync` in the image, or an exported
`requirements.txt`.** Strictly more correct: it pins the transitive closure,
not a hand-chosen subset. Rejected on what it costs against what it buys here.
The lock resolves the *whole* backend — `fastapi`, `uvicorn`, `anthropic`,
`google-genai`, `pillow` — and the point of this image is that the container
holding the second copy of the service-role key carries none of that. Getting a
subset out of a full lock means either an export step with its own group
filtering, or a second lockfile for the worker, and a second lockfile is a
second thing that drifts. The mirrored pins keep the image definition a single
readable list, and the test is the part that makes it hold.

**Pin only the direct dependencies.** Simpler, and wrong for the reason above:
`soxr` is not in `pyproject.toml` and moves every sample in the take.

**Leave the bounds and delete the comment's claim.** Honest, and no better —
the drift would still happen, it would just no longer be contradicted in
writing.

### Trade-offs accepted

- **The transitive closure still floats.** Everything `numba`, `soxr` and
  `soundfile` themselves pull in resolves at build time. This is a fence around
  the arithmetic, not a reproducible build, and `modal_app.py` says so in those
  words rather than claiming otherwise a second time.
- **Upgrading a dependency now takes two edits**, `uv.lock` and `modal_app.py`.
  That is the cost of the fence and the test names it explicitly when it fires.
- **Nothing here is verified against a real Modal build.** The versions are
  known mutually consistent because the lock resolved them together on 3.12,
  which is what the image uses — but no image has been built from this file.

## 2026-09-01 (later) — Match on intervals, with position as a saturated tie-break

**Context:** the previous entry in `EDIT_LOG.md` measured a defect in the
product's core claim. A take that holds one bar a beat too long had **48 of its
96 sounds attributed to the wrong written note**, and the app named eight bars
as off-tempo in a performance where one bar was long and the rest was perfect.

The cause is not the search. DTW's cost was the distance between absolute
times, so a take offset from the written grid is cheaper to explain as "they
skipped two notes" (two steps) than as "they hesitated" (0.83 s on each of 88
pairs). A per-skip penalty from 0.1 to 1.5 written gaps barely moves it,
because no penalty bridges 73 seconds.

The user was asked what the app should say and chose **"one bar dragged —
measure against your own pulse"**. Note identity is the prerequisite for that,
and for the grid reading too: today's answer is wrong about *which* notes.

**Decision:** the cost between a detection and a written note is the difference
between their **inter-onset intervals**, plus a **saturated** term for how far
apart they are in the piece.

    cost(i, j) = |interval(i) - interval(j)| + 0.5 * min(|t_i - t_j|, 0.15 * gap)

### Alternatives considered, each measured

**Absolute time alone** — what it replaces. Correct on everything except a
timing disturbance, where it gets half the take wrong.

**Intervals alone.** Offset-invariant by construction, and it fixes identity
completely: 96 right, 0 wrong on both hesitation cases, six corpus clips
unchanged, every unsafe take refused *more* firmly. Unusable anyway: a passage
of equal intervals is a plateau of equal cost, so the path through it is
arbitrary. Quality wandered — a steady take at 110% of the written pace scored
0.682 where 125% scored 1.000. Non-monotone, and both are well inside the
tempo clamp.

**An unsaturated hybrid.** Adding position back at any weight restores the
plateau ordering, and at every weight from 0.25 to 2.0 it also restores the
shift: 27 to 29 sounds still wrong. The absolute error after a hesitation is
0.83 s against an interval error of ~0.01 s, so position wins the argument
whatever it is scaled by. The cap is the whole idea, not a refinement of it.

**A per-skip penalty on the warp path.** Measured across 0.1–1.5 written gaps.
Moves the wrong-note count from 48 to 44. Rejected on arithmetic.

### Trade-offs accepted

- **A take in a different rhythm is now analysed rather than refused**, when it
  rescales onto the written one. Long-short-short against straight eighths went
  from 0.000 to 0.700; dotted pairs from 0.000 to 0.754. This is the same
  tolerance that lets a hesitating musician keep their bar numbers, and it
  cannot be had separately. It is arguably the better answer — someone playing
  dotted where straight is written played the right notes and wants to be told
  where the rhythm went, not that the app could not hear them — but that needs
  a real recording and an ear to settle. Pinned by a test either way.
- **Two constants that are not in `config.toml`**, with `MIN_TEMPO_RATIO` and
  the gap-core bounds, for the same reason: they bound what the matcher may
  believe rather than expressing a threshold about playing.
- **A cost matrix is built explicitly**, O(N×M): 19 MB at 1536 notes. librosa
  built the same matrix internally from the feature rows, so this is not new
  memory — and it is *faster*, 83 ms against 145 ms at that size.
- **The cap sits between two mild failures**, 0.12 (a genuinely dropped note
  costs one neighbour) and 0.20 (seven wrong on a hurried bar). Every value in
  between is far better than the 48 it replaces, so the choice inside that
  window is not delicate; it is 0.15 because that is the middle of it.

---

## 2026-09-01 — Measure the played tempo with a clipped mean, not a median

**Context:** the matcher rescales a recording toward the score's pace before
comparing them, so that deciding *which* onset is which note does not depend on
how fast it was played. The scale was `median(diff(detected)) /
median(diff(expected))`, clamped.

Onset times are quantised to the analysis hop — 23.2 ms at the configured rate
— so a median of intervals snaps to a multiple of it. Eighth notes written
416.67 ms apart come back as a uniform **418.0 ms**, exactly 18 frames. The
0.3% that rounding invents is inaudible and unplayable-around, and it
accumulates: past half a note gap the warp path gives back a whole note at
once, leaving two parallel ramps with a step between them — a shape no straight
line can remove, so the residual measure of "can this be trusted" explodes.

    128 notes   drift 162 ms   quality 0.986
    256 notes   drift 324 ms   quality 0.761   ← half a gap is 208 ms
    768 notes   drift 995 ms   quality 0.759

`warn_quality` is 0.7. Any session past roughly 150 notes was heading for
"results may be inaccurate" because of arithmetic, on a take played perfectly.

**Decision:** the median picks the centre; the mean of every gap *near* it
supplies the precision. Gaps outside 0.6×–1.6× of the median do not count.

### Alternatives considered, each measured

**A plain mean.** Unbiased, and it fixes the length bug completely — zero
residual drift at every length tested. It also believes a musician who stopped
to turn a page slowed down for the whole take: one 6-second pause in sixty
eighth notes moves the estimate from 417 ms to 510 ms. A pause is not a tempo.

**A trimmed mean, by rank.** The obvious robust average, and wrong here in a
way worth writing down: the gaps carrying the correction *are* the minority.
The distribution is mostly 18-frame gaps with a few 17-frame ones, and it is
exactly those few that pull the average off the grid. Trimming 25% from each
end restored the median's answer to five significant figures. Measured across
eighths at 72 BPM, quarters at 60 and sixteenths at 100: median 324/209/5875 ms
of drift, rank-trimmed 324/209/119, clipped **0/0/0**.

**Refining the ratio from a second alignment pass.** Implemented, measured, and
removed. It works, but it corrects a symptom: the first pass's mapping is
already contaminated by the slip it is meant to detect, and it costs a second
DTW per candidate. Fixing the estimator makes the slip not happen.

**Keeping the median and widening the DTW band.** Not tried, because the drift
is real: the sequences genuinely disagree by a note by the end, and a wider
band lets the path wander further rather than removing the reason it must.

### Trade-offs accepted

- **Two more constants** (`_GAP_CORE_LOW`, `_GAP_CORE_HIGH`) that are not in
  `config.toml`. They sit with `MIN_TEMPO_RATIO` and `MAX_TEMPO_RATIO`, which
  are also in code, for the same reason: they bound what the *matcher* may
  believe, rather than expressing a threshold about playing. Nothing about a
  room or an instrument should move them.
- **A piece of mostly-one-note-value gets a sharper estimate than a rhythmically
  varied one**, because the core band is narrower relative to its spread. The
  same statistic runs on the written timeline, so the ratio stays right; only
  the precision varies.
- **The estimate is still a single number for the whole take.** A musician who
  genuinely changes tempo halfway is described by one pace here — which is
  correct for *matching*, and is not the verdict: `compute_deltas` works in
  real seconds and reports the change.

---

## 2026-08-31 — Record the tolerance thresholds on the analysis, not serve them from config

**Context:** two charts in the app — the per-measure deviation bar and the
take's trend line — draw a take against the pipeline's *outer* threshold, the
point beyond which a deviation is called severe. Both held their own
`const FULL_SCALE_PCT = 20`, copied from `backend/config.toml`. `DeviationBar`
documented the copy as temporary: *"Server-tunable, which this copy is not.
When the API exposes the thresholds it should come from there."*

The six thresholds are the values in this system most certain to change —
`config.toml` calls them "starting values; tune per instrument/room", and
`TUNING_LOG.md` exists solely to record their movement. They are also
asymmetric by design (dragging sits wider than rushing), so a single client
number is wrong on at least one side as soon as tuning begins.

**Decision:** the analysis result carries the thresholds it was judged by.
`AnalysisResult.tolerance` is filled from the config in force during the run,
on every status, and travels to the client inside `result_json`.

### Alternatives considered

**A `GET /v1/config/tolerance` endpoint, or the thresholds on `/v1/me`.** The
obvious reading of the comment the code left, and wrong. It answers "what are
the thresholds *now*", but every chart is drawing a take from the *past* — a
take judged by whatever was in force when it ran. Re-scaling stored takes
against today's numbers would redraw a musician's practice history after a
tuning pass they had no part in and no way to see. Worse, the bar's length
would move while the word beside it — which comes from the stored band — did
not, so the same take would contradict itself on screen. Also a second request
on a path that has one.

**Keep the client copy, add a test asserting it matches `config.toml`.**
Cheapest, and it would catch drift in CI. It fails for the same reason: even
kept in sync it answers the wrong question, because "current" and "what this
take was judged by" diverge the moment anything is tuned. It also cannot
express asymmetry with one number.

**Recompute the bands client-side from the thresholds.** Rejected on the
existing precedent in `getInsights`, which already takes the band "of the take
nearest the mean, rather than a band computed here: the thresholds are the
server's and they move." Classification stays in one place; the client only
learns the scale it should draw against.

### Trade-offs accepted

- **The field is nullable, and permanently.** Analyses already in the table
  have no `tolerance`, so `lib/tempo.ts` keeps one fallback — the shipped
  default of 20, which is genuinely what those rows were judged by. Removing
  it later needs a backfill, not a schema edit.
- **A tuning pass no longer redraws history**, which cuts both ways: two takes
  in one Insights window can have been judged by different thresholds. The
  window reports the tolerance of the take that set its headline band, matching
  how the band itself is already chosen, rather than pretending one set covers
  the window.
- **The trend line takes a single scale where the bar takes two.** A polyline
  crossing zero has to stay straight; independent half-scales would bend a
  steady drift at the origin and read as a change in the playing. It uses the
  wider of the two, so nothing clips and the tighter side reaches full height a
  little early. The bar has no such constraint — it is discrete and
  centre-anchored — so it uses the correct threshold per side.
- **Six floats on every result.** Negligible against `per_note`, and they make
  each row self-describing: a stored take can be re-plotted correctly years
  later without knowing what the config said that week.

---

## 2026-08-27 — Store the instrument on an analysis, not a `double_bass` flag

**Context:** `services/analysis.analyze()` has taken a `double_bass` keyword
since Batch 3 — a high-pass filter and a lower onset-detection threshold, both
there because the low register is where finding note attacks is hardest. No
caller had ever set it. `analysis_runner` called
`analyze((y, sr), score, target_bpm)` and the flag defaulted false, so the
entire low-register path was dead code in an app whose spec names double bass
as its initial instrument focus (§1, line 59). Every bass player had been
analysed with thresholds tuned for treble strings.

Wiring it up required deciding where the value comes from and what shape it
takes in the database.

### Where the value comes from

**A `Instrument` preference the app already had, over a new field on the
score, and over inferring it from the clef.**

- **Infer from `score_json.clef`.** *Rejected, and it is the tempting one.* A
  bass part is in bass clef — but so is a cello part. A cello's low C is around
  65 Hz, under the 80 Hz high-pass, so treating the two alike would filter away
  the fundamental of exactly the notes a cellist most needs heard. The clef is
  a property of the page; the instrument is a property of the player.
- **A field on the score.** *Rejected.* It asks the same question on every
  piece a person adds, to answer something that changes for almost nobody.
- **The `Instrument` preference.** *Chosen.* It already exists, already
  includes `double_bass`, already has a picker in Profile, and already decides
  which clef the daily warmup is written in. It had simply never left the
  phone. No new UI, no migration for the user-facing part, and the answer is
  given once.

### What the column holds

**`instrument text` over `double_bass boolean`.**

The boolean is smaller and is what the pipeline actually reads today. It is
still the wrong column, because it stores a *conclusion* rather than a *fact*,
and this particular conclusion is unsettled: the spec asks for a **high-pass**
filter in one place (line 2490) and a **low-frequency boost of 80–300 Hz** in
another (line 1281), which are opposite treatments of the same band. Which is
right needs real recordings and a musician's ear — it is a `TUNING_LOG.md`
question, not a code one.

A column holding the instrument survives that being decided. A column holding
today's interpretation would need a backfill the moment it changed, and could
never answer "how did the cellists do" at all, because the answer was thrown
away at write time.

**Nullable, no default.** A row written before the column existed was analysed
without anyone saying what the instrument was, and "we do not know" is the
honest value. Defaulting to `violin` would record a guess as a fact.

**Trade-off accepted:** the runner now does a string comparison
(`row["instrument"] == "double_bass"`) where a boolean read would do, and the
mapping from instrument to pipeline settings lives in code rather than in the
data. That is the point — it is the part expected to change.

---

## 2026-08-25 — Keep photograph-first transcription, and build the correction step it always assumed

**Context:** after several failed scans the owner asked whether the whole
approach was wrong — "is there any other solution, why is OMR so hard, or are
you just being dumb?" Four alternatives were designed and then adversarially
verified against the code. Three of the four did not survive verification, and
the investigation found something better than any of them.

### What the analysis actually consumes

`pitch` appears **once** in the entire timing pipeline —
`alignment.py:99`, as `note.pitch == "rest"`. There is no pitch detection in
the audio layer. The spec agrees: *"onset is what we care about, not pitch"*
(§7, line 1146), and pitch-accuracy analysis is explicitly out of scope
(line 563).

That looks like grounds for asking a model for rhythm only. It is not — see
below.

### The alternatives, and why three failed

- **Rhythm-only OCR (drop pitch from the ask).** *Rejected.* The premise is
  wrong: reading a duration means locating and segmenting every notehead, stem,
  flag and beam, and **that localisation is the expensive part — pitch rides
  free on it.** Once the notehead is found, its staff position is a lookup.
  Dropping pitch removes an output field, not a perceptual step. It saves ~33%
  of output tokens (not the 75% first estimated, and most of that was already
  won by compacting the JSON) and costs Listen playback, the engraved stave,
  any future note-correction editor, and chroma-augmented DTW — which the spec
  lists as a **v1** onset-recovery mitigation (§7.5 line 1326), not a V3 idea.

- **Score-free grid timing (onsets vs. a metronomic grid).** *Rejected, and
  decisively.* Nearest-grid snapping cannot measure the thing this app
  measures: past half a grid spacing it **assigns a large rush to the previous
  grid point and reports it as a drag** — the sign inverts — and sustained
  drift wraps into a confident "steady tempo". It also cannot name a measure,
  which is the product (`build_timeline` gets `measure_number` off the score,
  `alignment.py:107`). Worst of all its errors are *silent*: a wrong verdict
  with no page to check it against, where OCR's errors are visible on a page
  the musician is looking at.

- **MusicXML/MIDI import.** *Worth building, but not as claimed.* The idea that
  it yields a "perfect timeline" is **false against the converter as it
  stands**: `musicxml.py` is first-part-only, ignores `<backup>`/`<voice>`,
  cannot represent tuplets in the `Duration` enum, and neither reads nor
  expands repeats. It also sets confidence to 1.0 by construction, which would
  quietly convert a system that admits uncertainty into one that does not.
  Hardening it is ~2–3 days; tuplets are a breaking schema change across
  `score_schema.py`, `alignment.py` and five mobile files.

### The finding that decided it

**The spec's own mitigation for unreliable OCR was never built.**

The spec does not claim OCR is accurate. It books the inaccuracy and answers it
with a correction step, listed as an MVP feature (line 447):

> Score preview & edit | User confirms parsed score; can tap to fix wrong
> notes/rhythms | **OCR will miss things; user must be able to correct without
> re-shooting**

and again at line 1136 — handwriting accuracy "~70–80%… we surface low
confidence and **rely on user correction**".

That step does not exist. `PATCH /v1/scores/:id` already accepts a corrected
`score_json` (`routers/scores.py:103`) and `UpdateScoreInput` already declares
the field (`mobile/src/data/api/scores.ts:75`) — **the backend half is done and
nothing in the app ever sends it.** A grep for any note-editing UI returns zero
hits.

So every misread is currently terminal. The design assumed a musician could fix
a bar in ten seconds; without that, a single wrong duration means re-shooting
the page or abandoning the piece.

**Decision: keep photograph-first transcription, and build the score-correction
step.** It is the smallest change that makes an admittedly-unreliable input
usable, it is the one MVP feature the spec required and the build skipped, and
half of it already exists. Add MusicXML import afterwards as a *third*
provenance beside camera and manual entry — after hardening the converter, and
without letting it claim a confidence it has not earned.

**Trade-off accepted.** OCR stays imperfect and stays the primary path, so the
correction UI must be genuinely fast — tapping a duration, not a notation
editor. If correction turns out to be needed on most bars rather than a few,
the spec's own open question (§13 #6, line 1866) says that is the signal the
experience is broken, and MusicXML import becomes the primary path instead.

---

## 2026-08-22 — The pipeline shows its evidence by default, not on request

**Context:** the staff reader has now been wrong six times. Every one of those
versions reported healthy numbers. Five were caught by rendering something and
looking at it; none was caught by a metric.

The last one is the clearest case. `residMedian ±2.19px` was quoted in a commit
message as proof the grid fitted, while the grid was actually 70px — nearly two
staff spaces — off the printed staff at one end. The metric was not lying: it
measures how well the curve agrees with the columns the curve itself selected.
It cannot fall, because rejecting the columns that disagree is a step in the
algorithm. **A number computed from the data a model selected cannot falsify
that model.**

**Decision: the bench renders the evidence for every stage, inline, as the work
happens — and the model's reasoning is streamed alongside it.**

**Alternatives considered.**

- *A debug flag.* Evidence you have to opt into is evidence nobody looks at
  until they already suspect something. Every one of the six defects was found
  by looking at a picture; in four of those cases I only rendered the picture
  after a metric had already convinced me the stage was fine.
- *Better metrics.* Worth having, and one was added — the fit is now checked
  against an unanchored per-column search rather than against its own inliers.
  But the reason that check exists is that a picture showed the problem first.
  Metrics are how a known failure is prevented from returning; they are not how
  an unknown one is found.
- *Log to the console.* The evidence here is images. A histogram, an overlay and
  a mask are the whole point, and the console cannot show them next to the
  sentence that explains what they are for.

**Why this one.** The bench's purpose is to make a claim about accuracy
checkable. A run that prints only its conclusion can be believed or disbelieved;
one that shows its working can be checked. The first time the trace ran it
caught a bug that four previous "verified" runs had missed — which is the
argument for it, made without being asked for.

**Trade-offs accepted.**

- Rendering full-resolution masks and overlays inline costs memory and makes the
  page long. Acceptable: this is a bench, and scrolling past evidence is cheaper
  than not having it.
- Streaming needs a hand-written SSE reader for both providers, because the
  bench is one file with no SDK. About sixty lines, shared between them.
- Thinking is billed as output. It stays behind a checkbox, off by default,
  matching the backend — the bench measures that assumption rather than
  quietly departing from it.

---

## 2026-08-22 — Barlines are read by the model, not detected by image analysis

**Context:** stage 1b cuts a photographed staff into enlarged per-measure
slices. That needs measure boundaries. Six ways of finding barlines in the
image were built and measured against a real phone photo of a bass part:

| Approach | Why it failed |
|---|---|
| Column ink coverage ≥ 0.9 | Real barlines scored 0.75–0.89; raising the bar let stems through |
| Coverage along a leaning column | Recovered the real ones and admitted three stems with them |
| Neighbouring ink within ±1 space | Barlines 0.16–0.23, stems 0.24–0.33 — overlapping, no threshold |
| Row-wise stroke width | Barlines 0.11–0.26, stems 0.16–0.27 — no separation at all |
| Overhang above and below the staff | Barlines 0.13–0.26, stems 0.16–0.19 — inverted, if anything |
| Connected components | One slur runs the whole system; eight barlines and forty noteheads come back as a single blob 2000px wide |

Every one of these is a locality assumption, and a page of real music breaks
locality: slurs cross barlines, beams cross stems, a stem whose notehead sits
on an outer line spans the staff exactly as a barline does.

**Decision: the model finds the barlines; the CV prints a ruler so it can say
where they are.**

**Alternatives considered.**

- *Keep tuning the detector.* Barline detection is a known-hard OMR subproblem
  and the failures above are not near-misses — they are the same numbers for
  both classes. More thresholds would fit this one photograph.
- *Fixed overlapping windows, no boundaries at all.* Robust, but it gives up
  measure-aligned crops, and measure alignment is what makes the beat-sum
  validator able to say which measure is wrong.
- *Ask the model for pixel coordinates.* It guesses. Coordinates are not
  something a vision model reads; printed numbers are.

**Why this one.** It splits the work along the grain of what each side is
actually good at. Locating five parallel lines on a curved page to sub-pixel
precision is arithmetic, and the model cannot do it. Seeing that a vertical
stroke is a barline rather than a stem is recognition, and the CV cannot do it.
The ruler is the interface between them: the CV prints numbers, the model reads
one off, and neither has to do the other's job.

**Trade-offs accepted.**

- A barline pass costs a request. It is folded into the slice reads rather than
  run separately, but the slices are read one at a time, so stage 1b costs
  roughly one request per twelve ticks of staff instead of one per page.
- A model that misreads a tick puts a boundary in the wrong place, and nothing
  downstream catches it except the beat-sum validator noticing the measure does
  not add up — which is the same signal that catches a misread note.
- The stroke candidates are still computed and passed along as an advisory
  hint. They are cheap, and a hint that agrees with the model is weak evidence
  the boundary is right.

---

## 2026-08-20 — A field with no column is either given one or deleted, decided by whether a fact exists behind it

**Context:** the UI rendered two fields that no database column backed —
`progress` and `movement`. Both came from the fixture data and both were
hardcoded `null` in `sources/api.ts`, so both were invisible on any real
account. They were the same *kind* of defect and got opposite treatments, which
is worth writing down so the next one is not decided by whichever is less work.

**Decision: `progress` was deleted; `movement` was given a column.**

The test is not "is this field used" or "would users like it". It is **is there
a fact behind it that something can produce.**

- **Progress**: a percentage through a piece. Nothing in the system can compute
  it. There is no notion of a piece being "80% learned" in the score, the
  analyses, or anything a musician tells the app. Any value would have been
  invented, and a progress bar that moves for reasons the user cannot predict
  is worse than no progress bar. Backing it with a column would have meant
  inventing the number in a new place rather than deleting the fiction.
- **Movement**: "I. Adagio". The musician already knows it, three forms were
  already asking for it, and the value was being typed and then dropped on the
  floor. The fact existed; only the storage was missing.

**Alternative considered — leave `movement` fixture-only until a batch needs
it.** Rejected because the cost is not deferred, it is transferred: every
screenshot, demo and test showing a movement was showing something the product
could not do, and the forms were quietly discarding what people typed. A field
that accepts input and silently drops it is worse than one that is absent.

**Alternative considered — infer the movement from the title.** Rejected. "No.
28" in a title is sometimes a movement and sometimes the piece; guessing wrong
mislabels a musician's own library, and the correct value is one field away.

**Trade-off accepted:** one more nullable column and one more field on three
forms. Nullable is the honest default — most music the app will see has no
movement at all, and null says that where an empty string would not.

---

## 2026-08-17 — The fixture/live switch is derived from the environment, not declared in code

**Context:** every screen read from a `PieceSource`, and `sources/index.ts`
chose between the fixture and API implementations with `const USE_FIXTURES =
true`. Turning the app on meant editing that line and pushing.

**Decision: `IS_LIVE_BACKEND` is computed from the presence of
`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` and
`EXPO_PUBLIC_API_BASE_URL`. There is no flag to flip.**

The constant was a loaded gun. `api/client.ts` defaults its base URL to
`http://127.0.0.1:8000`, and nothing hosts the backend, so flipping the flag
and pushing would have shipped a Cloudflare site whose every screen failed
against a host that exists only on a developer's laptop. The failure would have
looked like a backend outage rather than a build-configuration mistake.

Deriving it removes the class of error entirely: a build that was given a
project and a host runs live, one that wasn't runs on sample data, and
`.env` being gitignored makes "wasn't" the default for CI and Cloudflare.

**`EXPO_PUBLIC_API_BASE_URL` is checked for explicit presence, not
truthiness** — because of that localhost default. "No backend was named" and
"the backend is at the default" are different claims and only the raw
`process.env` read distinguishes them.

**The auth gate follows the same predicate.** `useAuthStatus` used to ask "are
the Supabase vars set", which is a *nearly* identical question. The gap is a
state that can really occur — credentials but no API host — in which the old
code demanded a sign-in and then served fixtures: a gate guarding data that
wasn't the account's. `isAuthConfigured()` was deleted rather than kept
alongside; two predicates that agree almost always are worse than one, because
the disagreement is exactly where the bug lives.

**Alternatives considered:**

- *Keep the boolean, add a build-time check.* Still leaves the deploy correct
  only as long as someone remembers the check.
- *A separate `EXPO_PUBLIC_USE_FIXTURES` flag.* An independent switch that can
  contradict the other three — "live, but with no host" becomes expressible,
  and that is precisely the state worth making unrepresentable.
- *Runtime health probe of the API.* Honest, but it makes the app's data source
  depend on network conditions, so the same build shows different libraries on
  a flaky connection. Configuration should not be discovered.

**Trade-off accepted:** a developer who sets only some of the three vars gets
sample data with no in-app explanation. `describeFixtureReason()` names the
missing variable for the console, which is where that reader is looking.

## 2026-08-17 — A piece can exist without a photograph

**Context:** `scores.source_image_url` was NOT NULL, and `POST /v1/scores`
required an image it could run OCR over. Every route into the library went
through a readable photograph.

**Decision: `source_image_url` becomes nullable, and `POST /v1/scores` accepts
either an image *or* a hand-entered clef, time signature and tempo.**

One provenance was an assumption, not a requirement. A handwritten part, a
library copy under a bad lamp, or a piece someone is working from a book they
would rather not photograph all need to be in the library, and none of them
yields an image OCR can read. It is also the only route in that needs no
camera, no OCR provider and no API keys — which makes it the route that still
works when the rest is misconfigured.

**NULL rather than a sentinel string** (`""`, `"manual"`, `"none"`): a sentinel
makes every reader of the column responsible for knowing which strings are real
URLs, and `_object_key_from()` already returns None for anything that isn't a
storage URL, so NULL flows through the display-signing path with no special
case.

**Both halves at once is an error, not something to reconcile.** A body with an
`image_url` *and* a `clef` is rejected rather than having the manual fields
silently ignored. A caller sending both has misunderstood something, and
overwriting what OCR read off the page with what a human guessed is the worse
of the two outcomes.

**`ocr_confidence` is NULL for a hand-entered piece, not 0.** The column asks
how well OCR read the page. For a page that was never read the answer is "it
didn't", which 0 — meaning "read it, understood nothing" — states wrongly. The
`score_json`'s own `ocr_confidence` stays 0.0, because that field is required
by the schema and no notes were read.

**Trade-off accepted, and surfaced in the UI:** a piece created this way has no
measures, so the analysis pipeline has nothing to align a recording against and
cannot produce a verdict. It can be opened and practised with the metronome.
The form says so under the button rather than letting a musician discover it
after recording a take. The alternative — a manual note-entry editor — is a
notation editor, which is a product in itself.

## 2026-08-17 — One dark surface on Today, and it is the warmup

**Context:** the owner asked for the warmup to become a page you open, with a name and a Start button on Today, and said Today "looks kind of bland". Three treatments were put to them — an ink panel, notation bare on the page, and a bordered study-book plate. They chose the ink panel.

**Decision: the warmup panel is a full-bleed band in `actionBg`, and it is the only dark surface on the screen.**

Today ran card → type → more type, with a single visual event in the whole screen. A second one was needed, and the warmup is the right thing to be it: an inverted surface says *this is a different kind of thing from the piece above it* far more efficiently than another heading would.

**No new colours.** `actionBg` / `actionText` / `onDarkMuted` already exist, and the palette file already describes them as doubling for full-bleed dark surfaces — the camera scanner uses the same three. This is the established dark treatment applied somewhere new, not a style invented to make a screen interesting.

**Full-bleed rather than inset.** Inset by the gutter it would read as a very dark *card*, which is the one thing the palette notes say this colour must not become, and Today already has a card.

**The notation is the only ornament, and it is real** — the actual opening bars of the actual warmup, engraved, in cream. Nothing was added to make the panel interesting. §3 law 10 cuts both ways: if a decorative mark can be removed without loss, it should never have been drawn.

**Alternatives considered:**

- *Notation bare on the ivory.* The quietest option and entirely defensible, but it would not have answered the blandness — it is more of the same surface.
- *A bordered plate.* Structure from borders, which the design laws prefer in general. Rejected here because Today would then have two bordered boxes stacked, and the second would read as a weaker copy of the first.

**Trade-off accepted:** Today now has two focal points where §3 law 4 asks for one. They are sequential rather than competing — a card you read, then a surface you notice — but it is a real tension, and if the screen starts to feel busy the panel is what gives way, not the card.

> **Reversed the same day.** The owner read the band as competing with the card, not following it, and they were right — the trade-off above was rationalising a defect rather than accepting a cost. The warmup is now plain notation on the page background at the foot of the screen, and the panel gave way exactly as this paragraph said it should. What survives from this decision is the reasoning about *where* dark surfaces may be used, not the claim that Today needed one.

**Also decided: `TempoStepper` is extracted rather than duplicated.** The warmup page needs the same control the Record screen has. Two steppers that quietly disagree about their step size or their limits is the kind of drift nobody notices until a musician does.

## 2026-08-17 — A daily excerpt, and an engraver that refuses to draw a clef

**Context:** the owner spotted that "Last take" was effectively a second copy of the practice card. They were right, and by construction rather than by coincidence: `apiPieceSource.getCurrentPiece()` resolves the piece by taking the **newest analysis** and returning its score, and `getLatestTake()` returns that same analysis. Against the real backend the two blocks name the same piece every time. The fixtures had hidden it by disagreeing with each other — `fixturePieceSource` returned the first fixture piece while the fixture take belonged to a different one, which is a fixture bug and is now fixed.

**Decision: the verdict sentence moves onto the card**, and the freed block becomes a daily excerpt chosen by the musician's instrument. The owner asked for a term and a fact together, plus "based off the musical instrument they play, a short excerpt they can choose to practise every day".

**Decision: `instrument` is a local preference, not account data.** It picks the clef and range of the excerpt and will pick the reference voice. None of that belongs to the backend, and it follows `metronomeMode` and `haptics` into `preferences`.

**Decision: the excerpts are hand-authored, four sets of three, one per instrument** — not transposed from a single set.

- *Automatic transposition was the obvious alternative and is wrong.* Transposing a violin exercise down for cello puts it on strings a cello does not have, and a "first position" exercise that needs a shift is not a warm-up. The corpus is checked by test against each instrument's written first-position range.
- *Slicing four bars out of the musician's own library* was the other alternative. Rejected: it lands mid-phrase, needs whatever technique the piece needs, and hands back a fragment of what they are already practising.

**Decision: the excerpt can be heard but not recorded.** A take is analysed against a score row in the backend, and an exercise the app authored has no such row. A "record" button here would either fail or quietly analyse against the wrong music. Better absent than dishonest — and `Listen` already gives the reference the exercise actually needs.

**Decision: the engraver draws no clef.**

A clef is calligraphy. A hand-approximated treble clef in an app for classical musicians would be the first thing a reader noticed and the last thing they forgave, and I am not able to author a good one as an SVG path.

**Alternatives considered:**

- *The Unicode glyphs `𝄞 𝄢 𝄡`.* Rejected: they land on the system font stack, and Android frequently has no glyph — a tofu box in the middle of a stave is worse than no clef at all. The same reasoning applies to `♯`, which **is** drawn, as four strokes.
- *Bundling a music font (Bravura is SIL OFL).* The correct long-term answer, and deferred rather than rejected. It is ~500 KB of asset for one glyph per excerpt today, and asset paths in this build have already cost one blank-page incident.
- *Drawing the clefs anyway.* Rejected on quality.

Instead the note names are printed under the staff, the way a study book does for a beginner, and the block names the instrument it is written for. That is honest about being an exercise diagram rather than pretending to be engraved sheet music.

**Superseded in part, later the same day:** the owner removed the daily term, keeping only the fact. The reasoning below about the fact corpus still stands; the term's "read it off your own score" argument is now history, and the code for it is in git rather than in the app.

**Trade-off accepted:** the fact corpus is 24 entries and repeats after about a month. That is why it is a footnote at the bottom of the screen rather than a feature of it. Every entry is a settled statement of record — anything that needed a "probably" was left out rather than hedged, because a wrong fact about Bach in an app for classical musicians is expensive.

## 2026-08-17 — Today keeps its card; what sits under it must give a reason

**Context:** the cardless Today from earlier today was rejected by the owner — "I don't think this is a good today. Keep the continue practice in a box like you did last time." Fair: stripping the card removed the resemblance to Library but left a screen with one piece, one sentence and a lot of air. Bare was the original complaint and the redesign had made it worse.

**Decision:** the practice card comes back and stays the only card on the screen, and content goes underneath it. But the previous decision's finding still holds — *a list of pieces on Today is the Library tab with fewer rows* — so it needs a rule, not just restraint:

> **Nothing on Today may name a piece without saying why it is on the screen.**

Every row carries its reason as the line under the title: "Rushing across 12 sessions", "Not practiced yet", "Today · You rushed across measures 5 to 8". A row that only names a piece is a list; a row that gives a reason is a suggestion. The old library preview failed this rule, which is why it read as a duplicate of Library, and it is now written down so the next person adding to this screen has a test to apply.

Two consequences follow mechanically:

- **The rows carry no thumbnail.** A sheet crop beside a title *is* the Library row. The card above already carries the score image.
- **Nothing may be named twice.** The piece in the card, the piece in the last take, and the two suggestions are all deduplicated against each other. "60 Studies" appearing as both the take you just finished and a piece worth a look is two true statements that read as one bug.

**Decision: `getLatestTake()` goes on the `TakeSource` seam** rather than being derived from `PracticeInsights` on the screen.

**Alternatives considered:**

- *Reuse `insights.pieces` for the last take.* Rejected — it cannot answer the question. `PracticeInsights` is a thirty-day aggregate; "how did last time go" is about one recording, and the two would silently disagree the moment a musician's last take differed from their month.
- *A new backend endpoint.* Unnecessary. `GET /v1/analyses` already returns the caller's own analyses for Insights; the adapter sorts what it already fetches and settles the ordering client-side rather than assuming the server's.
- *Skeletons for the suggestion blocks too.* Rejected: each block hides itself when its data is absent, so a placeholder would promise content that may never arrive — on a new account, three of the four blocks are correctly empty forever until the pipeline runs.

**Trade-off accepted:** Today now fires four queries (`current piece`, `library`, `insights`, `latest take`) where it fired two. On fixtures that is free; against the API it is two extra round trips on the app's first screen. Worth watching, and the fix if it bites is a single aggregated endpoint, not fewer blocks.

## 2026-08-17 — Today and Library get different compositions, not different content

**Context:** the owner said Today felt bare and that it and Library "don't look much different". Putting the three tabs side by side showed why, and it was worse than the report: **all three were the same composition.** A serif title, then a vertical stack of white rounded cards, one per piece, each carrying a title, a composer, a gold horizontal bar and a grey metadata line. Today's bottom two-thirds was literally the top of Library, three rows shorter, drawn by the same `PieceCard` component.

Two things fell out of the comparison that nobody had reported:

- **The gold bar meant three different things.** Progress through the piece on Today and Library; signed deviation from the beat, diverging from a centre tick, on Insights. Same colour, same weight, same width. One encoding for "how far through" and "how far off".
- **The progress it encoded does not exist.** `sources/api.ts` maps `progress` and `movement` to null and says why: *"no progress concept anywhere in the schema"*. Against the live backend every piece loses its percentage, its bar and its movement line — so the screens do not get less bare when the API lands, they get **more** bare and **more** identical.

**Decision:** differentiate by composition, not by adding content. Today became one piece with no card at all; Library became a grouped index with no cards either.

- **Today**: greeting demoted to the eyebrow, the piece promoted to the 36pt title. The library preview deleted outright. A full-bleed sheet-music strip, the piece's own recent verdict from `PracticeInsights`, the working tempo from `practiceTempo`, and the action pinned to the footer.
- **Library**: rows grouped by recency under quiet headings, separated by hairlines, no cards, no bars. Searching flattens the groups.

**Alternatives considered:**

- *Add content to Today — a streak, a session count, a week strip.* Rejected. Today wasn't short of things, it was short of a reason to be its own screen; a counter would have been decoration on top of a duplicate. It also drifts towards the gamification the brief rules out.
- *Group the Library by composer.* Tried on paper and rejected against the actual data: a violinist's library is mostly one piece per composer, so it produced a heading for nearly every row. Recency groups meaningfully **and** answers what a library is opened to answer — what have I not touched in a month.
- *Keep the cards and just change the spacing.* Rejected: the sameness was the card, not the gap between them.
- *Fix only the gold bar.* Rejected as too small — it is a real defect, but the screens would still have been the same screen.

**Trade-off accepted:** Today now shows exactly one piece, so there is no way to start a different one without going to the Library tab. That is one extra tap for a case the tab bar already serves, and it buys a screen with a single focal point. If it proves wrong, the fix is a "choose another piece" control, **not** the return of the preview list.

**Also decided: progress stops being displayed on these two screens.** Not deleted from the type — the field stays, and `PieceDetail` still renders it — but Today and Library no longer show a percentage or a bar that the backend cannot produce. As a side effect the gold bar now means one thing in the tab bar's reach: deviation, on Insights.

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

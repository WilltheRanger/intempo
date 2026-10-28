# Design proposal — double stops and chords in the score model

Status: **proposal only. No code in this PR.** Needs @WilltheRanger's agreement
before anyone implements any part of it.

Issue: JERA-579. Parent: JERA-559 (grading-accuracy program).
Author: Forge, 2026-10-24.

---

## 1. The problem

`score_schema.Note` carries a single `pitch`, plus `chord_pitches: list[str]`,
which its own docstring describes as *additive, not part of the timeline*. The
MusicXML importer (`backend/app/services/ocr/musicxml.py`, around the
`<chord/>` branch) deliberately keeps only the first notehead of a chord as a
timeline note and appends the rest to `chord_pitches`, because the timeline is
built by accumulating durations and counting a chord member a second time
would push every later onset off by one note-length. That decision is correct
for *timing* and is held by tests (`test_musicxml.py::test_chord_members_are_not_counted`,
`::test_a_chord_keeps_its_other_noteheads`, `::test_both_readers_agree_about_chords`).

The consequence is downstream, not in the importer. Everything that grades
pitch reads `Note.pitch` and nothing reads `chord_pitches`:

- `alignment.ExpectedNote` has no field for the other pitches, so
  `build_timeline` cannot pass them on.
- `pitch_evidence.mismatch` takes `written: list[str | None]` — one written
  pitch per expected note — and scores an attack against that one pitch.
- `intonation.note_cents` takes `written_midi: np.ndarray`, again one value per
  note, and reads the median of the pitch track in the note's window.

So a double stop is graded as whichever notehead the importer happened to keep.
When the player bows both strings correctly:

- `pitch_evidence`'s chroma path sees the *other* string's energy competing, so
  `Heard.pitch_class` is often the wrong one or `None`; `_height_mismatch` on
  the monophonic `pitch_track` reads a blend or a jump between the two.
  Both push `mismatch` up, which is a cost in `align_chain`/`align_dtw` and a
  miss in `analysis._confirmed`.
- `intonation.note_cents` takes a median over a window where two pitches sound.
  `pitch_track` is monophonic (pYIN-shaped), so the median is whichever string
  the tracker locked to, or a value between them. Either way the cents figure is
  not a measurement of anything the player did.

JERA-564's finding — double stops are the strongest single predictor of a bad
read — is the visible end of this. It is not an OCR accuracy problem: a
*perfect* read still grades a double stop as a single note.

This proposal keeps the importer's timing decision exactly as it is and makes
the extra pitches visible to grading.

---

## 2. Chords in the expected timeline

### 2.1 Principle

**One chord is one onset, and one onset expects a set of pitches.** This is the
smallest change that fixes grading, and it preserves every timing invariant and
every existing test about onset counts.

The alternative — one timeline entry per notehead, all sharing an onset — was
considered and is rejected in §8.

### 2.2 Schema

`Note` is unchanged on the wire. `chord_pitches` stops being decorative and
becomes load-bearing; its docstring changes from "additive, not part of the
timeline" to "the onset's other sounding pitches". No migration (see §5).

One thing the schema *should* gain is the ability to say that a chord is rolled
rather than struck, because a violinist cannot sound four strings at once and
three- and four-note chords are always broken. Proposed, additive and optional:

```python
#: How the onset's pitches are sounded. "together" for a double stop,
#: "rolled" for a chord broken across the bow. Absent means "together"
#: for two pitches and "rolled" for three or more, which is what a
#: violinist does by default.
chord_voicing: Literal["together", "rolled"] | None = None
```

MusicXML has no reliable marker for this, so the importer leaves it `None` and
the default rule applies. It exists so a future editor and the OCR-review
screen can correct it per onset. Nothing in Batch 3 reads it in phase 1.

### 2.3 `ExpectedNote`

Add one field, mirroring the existing additive style (`under_slur`,
`is_slur_boundary`):

```python
#: The onset's other written pitches — the rest of a double stop or chord.
#: Empty for an ordinary note. `pitch` stays the principal (the notehead
#: the importer kept) so every existing reader is unchanged; readers that
#: can judge two pitches at once use `sounding_pitches`.
chord_pitches: tuple[str, ...] = ()
```

and a derived accessor, so no caller has to assemble the set itself:

```python
@property
def sounding_pitches(self) -> tuple[str, ...]:
    """Every pitch this onset expects, principal first."""
```

`build_timeline` copies `Note.chord_pitches` through. `ExpectedTimeline.onsets`
does not change shape, so `compute_expected_onsets`, `align_take`, `align_dtw`,
`align_chain`, `pulse_anchors`, `collapse_double_attacks` and every timing
tolerance keep working on the same array they do today. **Nothing about timing
changes.** That is the point.

### 2.4 Readings

`analysis.readings_of` already builds more than one expected timeline and lets
the take choose (the slur-interior reading). Rolled chords want the same
treatment and should reuse that mechanism rather than inventing one:

- **Struck reading** — the chord is one attack. This is today's behaviour and
  stays the default.
- **Rolled reading** — a three- or four-note chord may produce 2–4 detected
  attacks within a short span. Rather than adding timeline entries, mark the
  onset so `collapse_double_attacks` is allowed a wider window there
  (proposal: `rolled_span_s`, config-driven in `backend/config.toml` per §1.7
  of CLAUDE.md, starting value to be tuned, not guessed — suggested first
  value 120 ms, which is roughly a comfortable bow roll).

Phase 1 should ship the struck reading only, and measure whether rolled chords
still break alignment, before adding the second reading. Scope discipline:
double stops are the reported problem; broken chords are a separate, rarer one.

---

## 3. Alignment and DTW

### 3.1 What changes

Only the cost. `mismatch` returns an `(attacks, notes)` matrix which
`align_chain` and `align_dtw` consume as cost. Today `mismatch` scores an
attack against one written pitch per note. It should score it against the
note's *set*:

```
cost(attack i, note j) = min over p in note_j.sounding_pitches of
                         pitch_cost(attack i, p)
```

A `min` rather than a mean, and the reasoning matters: the question alignment
asks is "is this attack plausibly this note?", and on a double stop hearing
*either* written pitch is strong evidence that it is. Requiring both would
penalise the real acoustic case where one string dominates the chroma
(bridge-side bow placement, uneven string pressure, a wound G against an open
E), and would make a correctly played double stop *more* expensive to align
than a wrong single note — the exact failure JERA-564 observed, with the sign
flipped.

So: **alignment is permissive about chords; grading is strict.** The strictness
lives in §4, where it can be reported to the player, not in the cost matrix,
where it silently breaks the match.

### 3.2 Concretely

`mismatch`'s `written` parameter generalises from `list[str | None]` to
`Sequence[str | None] | Sequence[Sequence[str]]`, or — cleaner, and the
recommendation — gains a sibling:

```python
def mismatch_sets(
    frames, sr, attacks_s,
    written: list[tuple[str, ...]],
    *, steady, track=None, transpose=0,
) -> np.ndarray:
```

with `mismatch` kept as a one-pitch-per-note wrapper over it, so every current
caller and every current test is untouched. The per-pitch inner computation is
exactly today's: `_height_mismatch` against the pitch track when the attack is
pitched, `1.0 - h.relative[class]` from the chroma otherwise.

`Heard.ranking` and `Heard.relative` already exist and their docstring already
says `ranking` is "kinder to a double stop". That comment anticipated this
change; this proposal is cashing it in.

### 3.3 DTW specifically

`align_dtw`'s `_cost_matrix` and `_match` take the matrix as given, so they need
no change beyond being handed the set-aware matrix. One real risk: a chord's set
is cheap against *many* attacks (it matches more pitches, so `min` finds a
cheap one more often), which flattens the cost surface and can let the path
wander near chord-heavy bars. Mitigation, to be measured not assumed: add a
small per-pitch penalty so a set of `k` pitches is not strictly cheaper than a
single pitch — e.g. `min(...) + chord_set_penalty * (k - 1)`, config-driven,
first value 0.0 (i.e. off) so phase 1 measures whether it is needed at all.

`_quality_from_cost` thresholds and `is_alignment_broken` are unchanged in
mechanism, but their *distribution* shifts on chord-heavy pieces, which is a
TUNING_LOG matter (§6).

---

## 4. Pitch evidence and intonation for two simultaneous pitches

This is the hard half, and it is where the proposal is least certain. Stating
that plainly rather than specifying confidently.

### 4.1 The monophonic-tracker problem

`pitch_evidence.pitch_track` is a monophonic estimator. On a double stop it
returns one of the two pitches, or an unstable alternation, or garbage in the
beats. No amount of post-processing on its output recovers two pitches. So
anything that wants to judge both must use the **spectrum**, not the track.

Two paths, in order of cost:

**(a) Chroma-set evidence (phase 1, cheap, already possible).**
`heard_after` already returns `relative` — every pitch class's energy as a
fraction of the strongest. For a double stop with written classes `c1, c2`:

- *both heard*: `relative[c1] >= both_present_rel` and
  `relative[c2] >= both_present_rel`
- *one heard*: exactly one clears it
- *neither*: neither does

`both_present_rel` is a new config value. It must be well below 1.0 (the two
strings are never equal) and above the chroma noise floor; the honest answer is
that its value comes from the benchmark in §6, and a starting guess of 0.45 is
a guess. This gives a three-way verdict per chord onset with no new dependency
and no new DSP.

Its limits are real and must be written into the verdict copy, not hidden: it
is octave-blind (chroma folds), so it cannot distinguish a tenth from a third;
and a perfect fifth's third harmonic lands on the upper note's class, so a
*single* note can present as "both heard" for a written fifth — which is a
large share of violin double stops. §4.3 is the mitigation.

**(b) Per-pitch harmonic evidence (phase 2, where the real gain is).**
For each written pitch of the onset, sum spectral energy in narrow bands at its
fundamental and first 3–4 harmonics over the same window `heard_after` uses,
and compare each written pitch's harmonic sum against the window total. This is
octave-aware, so it fixes the tenth/third case, and it discriminates the fifth
case because a true upper note contributes energy at its *own* fundamental
where the lower note's third harmonic is weaker and not phase-locked to the
band centre. It needs an STFT the pipeline may already compute — to be
confirmed against what `analysis` hands `pitch_evidence` today — and no new
dependency beyond what librosa already provides.

Recommendation: ship (a), measure it, and only build (b) if (a)'s benchmark
numbers leave a gap. (CLAUDE.md §1.3: build the best version of *what was
asked for*, and measure before optimising.)

### 4.2 `Evidence` and `_confirmed`

`Evidence.page_share` / `n_confirmed` count matched notes that held their
written pitch. A chord onset should count as confirmed when **at least one**
written pitch held, and gain a separate, additive pair of counters so the gain
is visible rather than averaged away:

```python
#: Chord onsets where every written pitch was heard, of the chord onsets
#: matched. None when the page has no chords.
chord_complete_share: float | None
n_chord_onsets: int
```

`page_classes` counts distinct classes the page writes; it should count chord
members too, which makes it *more* correct for the "page of one pitch" guard it
exists for. That is a behaviour change on existing pages and needs a benchmark
pass (§6).

### 4.3 Intonation

`intonation.note_cents` must not be asked to measure a double stop with a
monophonic median. Proposal:

1. **Phase 1 — exclude, and say so.** Skip chord onsets: return NaN for them,
   exactly as the function already does for a note with no written pitch or too
   few frames. The take's `tuning_cents` and `spread_cents` are then measured
   over single notes only, which is *honest* and strictly better than today,
   where chord windows feed a meaningless median into both. `Intonation` gains
   `n_excluded_chords: int` so the verdict can say "intonation measured over
   the single notes; 6 double stops were not measured" rather than quietly
   reporting a number built partly from noise.

   This is a real regression in coverage on chord-heavy repertoire and should
   be called out in the PR that implements it, not buried.

2. **Phase 2 — measure both.** With §4.1(b)'s per-pitch bands, each written
   pitch of the chord gets its own cents reading from the location of its
   harmonic peaks, and the double stop gains the measurement a teacher actually
   makes: **the interval**. `interval_cents` — how far the sounded interval sat
   from its just or equal-tempered size — is the single most useful number on
   this page, because a double stop can be in tune with itself and flat
   overall, or each note near its own target and the interval audibly sour. It
   is also the thing the current model cannot express at all.

   Whether the target is equal temperament or just intonation is a musical
   question for @WilltheRanger, not an engineering one. My reading: report
   against equal temperament (consistent with `tuning_cents`' A=440 ET
   baseline) and treat just-intonation preferences as out of scope until asked.

3. `NoteIntonation.by_note` groups by written pitch. A chord member should
   appear under its own pitch once phase 2 can measure it, and not at all in
   phase 1.

---

## 5. Migration and back-compat

**No SQL migration is needed, and that is the main virtue of this shape.**

- **Stored scores.** `chord_pitches` is already populated on every score the
  current importer has read, and is already persisted as part of the score
  JSON. Nothing needs backfilling. Scores read by an older importer that
  predates `chord_pitches` have `[]`, which is exactly "an ordinary note" — the
  safe direction. `chord_voicing` (§2.2) is `| None` with a defaulting rule, so
  old scores parse unchanged. Both are additive Pydantic fields on a JSON
  column; `backend/app/migrations/` is untouched.
- **Stored analyses.** New `Evidence` and `Intonation` fields must be optional
  with defaults (`None` / `0`), so a stored analysis deserialises and the
  mobile verdict can tell "no chords on this page" from "analysed before this
  shipped". `mobile/src/lib/verdict/` must treat both new groups as possibly
  absent — this is the same pattern the verdict already uses for optional
  insight groups.
- **No re-analysis of old takes.** Old analyses keep their numbers. They are
  not comparable to new ones on chord-heavy pieces, which matters for the trend
  screen: a score's trend line would show a step at the deploy. Proposal:
  stamp analyses with an analyser version and have the trend view not draw a
  comparison across a version boundary, or at minimum annotate it. This is a UI
  question and therefore gated by CLAUDE.md §2 — flagging it, not designing it.
- **Rollback.** Every change above is additive, so reverting the code reverts
  the behaviour with no data repair. The one-way door is `page_classes`
  counting chord members (§4.2), which changes an existing guard's input;
  it should land as its own commit so it can be reverted alone.

---

## 6. Test plan and benchmark slices

### 6.1 Unit tests

New, in `backend/app/tests/`:

- **Schema/importer** — a double stop's members reach `Note.chord_pitches` and
  the timeline still has one onset (extends the existing chord tests rather
  than replacing them); a three-note chord; a chord whose principal is a rest
  is dropped cleanly; `chord_voicing` defaults by member count.
- **`alignment`** — `ExpectedNote.sounding_pitches` is principal-first and
  deduplicated; `build_timeline` onset count and every onset time is
  **byte-identical** to today on a chord-bearing fixture (the regression that
  matters most); `chord_pitches` is empty on ordinary notes.
- **`pitch_evidence`** — `mismatch_sets` on synthetic two-tone audio: both
  written pitches present → low cost; one present → low cost (the §3.1 `min`);
  neither → high cost; `mismatch` still returns exactly what it returns today
  for single-pitch input (equality test against the current implementation's
  output on a fixture).
- **`intonation`** — chord onsets are NaN in phase 1 and are counted in
  `n_excluded_chords`; `tuning_cents` over a take whose chords are excluded
  equals the value computed over the same take with the chords removed.
- **Verdict (`mobile/src/lib/verdict/`)** — a stored analysis with the new
  fields absent renders; with them present renders the chord copy. Per
  CLAUDE.md §3, the rule goes in a tested module, not in a `.tsx`.

Synthetic two-tone audio is generated, not recorded, so nothing is committed
that raises a data-rights question. A real recorded fixture would be better
evidence and must live in `/paperclip/workspaces/intempo-eval-data/`, outside
the repo, per the program's data rules.

### 6.2 Benchmark slices (JERA-563)

The claim to be proved is narrow and should be stated before the work starts:
**chord-bearing bars align and grade measurably better, and nothing else
changes.** The slices that show it:

| Slice | What it proves |
|---|---|
| **Double stops, correctly played** | The primary gain. `mismatch` cost at the true note falls; `n_confirmed` rises; alignment quality rises. The headline number. |
| **Double stops, one string wrong** | The strictness in §4.2 works: still aligned, but `chord_complete_share` drops. A fix that turns every chord into a pass is not a fix. |
| **Three/four-note rolled chords** | Whether §2.4's struck-only phase 1 is sufficient, or `collapse_double_attacks` needs the wider window. Expected to be the weakest slice and the one that decides phase 2. |
| **Single-note-only takes (control)** | The non-regression gate. Every metric must be unchanged, not merely similar. If this slice moves at all, something leaked. |
| **Perfect fifths specifically** | Isolates §4.1(a)'s known false-positive (third harmonic on the upper class). If this slice looks as good as the others, the chroma path is being flattered and (b) is needed. |
| **Chord-heavy pages with a bad take** | `is_alignment_broken` must still fire. §3.1's permissiveness is the obvious way to break this. |

The numbers to report per slice, before and after: alignment quality,
`is_alignment_broken` rate, `n_confirmed` / `page_share`, chord-onset
completeness, intonation `spread_cents` and coverage (notes measured), and the
timing verdict, which must not move.

Jerry's 50-video analysis (`/paperclip/workspaces/solo-violin-training/`) is a
reasonable source of chord-heavy repertoire for slice selection, but its labels
are unverified, so it selects material and does not score it.

Any threshold this work lands — `both_present_rel`, `chord_set_penalty`,
`rolled_span_s` — gets a `TUNING_LOG.md` entry with the clip-by-clip
before/after across all six fixtures, per CLAUDE.md §1.

---

## 7. Risks

1. **Alignment regression on single-note music.** The highest-impact risk,
   because it affects every user and not just the chord case. `mismatch_sets`
   reduces to today's `mismatch` for a one-element set, which is why the
   equality test in §6.1 is mandatory rather than nice to have.
2. **The `min` makes chords too cheap** (§3.3), flattening the DTW cost surface
   and letting the path wander. `chord_set_penalty` exists for this and starts
   at 0.0 so the benchmark decides.
3. **Chroma's fifth problem** (§4.1). Violin double stops are heavily fifths,
   thirds and sixths; the fifth case is the one chroma handles worst and the
   most common. Phase 1 may measure as a success largely by accident. The
   fifths slice exists to catch exactly this, and it should be read before the
   headline slice.
4. **Intonation coverage drops** on chord-heavy repertoire in phase 1 (§4.3.1).
   Honest, but a user-visible reduction in what the app reports. Needs copy,
   which needs @WilltheRanger and the §2 UI gate.
5. **Trend discontinuity** across the deploy (§5). A user's history changes
   meaning without their take changing.
6. **Phase 2 is a real DSP project**, not an afternoon. Per-pitch harmonic
   evidence is where the honest measurement lives, and estimating it as small
   would be wrong. If the benchmark says phase 1 closes most of JERA-564's gap,
   phase 2 should be deferred on evidence rather than scheduled on principle.
7. **Scope creep into the editor.** `chord_voicing` invites an OCR-review UI
   for correcting chords. That is UI, gated, and out of scope here.
8. **Rolled chords may not be solvable from the score alone.** Whether a
   violinist breaks a chord, and how fast, is a performance choice. The struck/
   rolled reading pair (§2.4) handles it the way the slur-interior reading
   handles its ambiguity, which is the right precedent, but it adds a reading
   to every take's cost.

---

## 8. Alternative considered: one timeline entry per notehead

Give every notehead its own `ExpectedNote` at the same onset time.

Rejected. `ExpectedTimeline.onsets` would gain duplicate values, and the code
that reads it assumes strictly increasing onsets in more places than are
cheaply enumerable: `typical_gap`, `pulse_anchors`, `_residuals`,
`closest_expected_gap`, `attacks_outnumber_the_music`,
`collapse_double_attacks` and the DTW cost construction all reason about gaps
between consecutive onsets, and a zero gap is degenerate in most of them.
`attacks_outnumber_the_music` would also immediately be wrong in the other
direction: the music would claim more attacks than a violinist can produce.

It is the more "correct" data model in the abstract and the wrong one here. The
set-per-onset shape gets the grading benefit without touching a single timing
invariant — which is also what makes it reviewable in slices, per §5's
rollback note.

---

## 9. What I am asking for

@WilltheRanger — three decisions, and nothing gets implemented before them:

1. **The shape** (§2): one onset, a set of pitches, `chord_pitches` promoted
   from decorative to load-bearing. Or the per-notehead model in §8, if you
   read the trade differently.
2. **Phase 1's intonation trade** (§4.3.1): exclude double stops from the
   intonation measurement and say so in the verdict, versus keeping today's
   meaningless-but-present number until phase 2 can measure properly. I
   recommend excluding; it is user-visible and therefore yours.
3. **Equal temperament vs just intonation** for the phase 2 interval target
   (§4.3.2). A musical call.

Everything else here is implementation detail I am happy to be overruled on in
review.

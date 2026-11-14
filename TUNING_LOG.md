# InTempo Audio Tuning Log

Populated during Batch 3. Format spec: see "Batch 3 Tuning Appendix"
in intempo-combined.md. Every threshold change logs old value, new
value, regression results across all six fixture clips, and rationale.

---

## 2026-11-14 (a few notes out of place) — Measured, not kept: a run of up to k notes out of place as no disturbance. No code or threshold changes.

**Why real colour disagrees.** On the captured pulse inputs, of the 2,886
colour disagreements the labels decide (`f482e03`'s head), 2,543 are the two
readings measuring from levels more than 5% of a beat apart; 198 are a note
placed differently and 145 sit near a band's edge. After `f657146` took out
the false skips, the app still re-anchors 125 times where the labels'
reading does not, at a step a median 1.23 times its limit where the labels'
step at that note is 0.34 of theirs (under their limit 93% of the time), and
each moves the level a median 332 ms. They are steps only the app hears: a
fast figure's pairing slid a note along for a few notes (Spring's second
violin, bar 18, alternating E5 and F-sharp 5), and each end of the slide
re-anchors, which throws away the drift the take had built up.

**Tried:** `f482e03`'s rule widened from one note to a run: a disturbed step
out, ordinary steps, and a disturbed step back that the first cancels,
within k notes, is not a disturbance.

| k | synthetic timing misses (replay) | real colour (replay) | over what the labels decide |
|---|---|---|---|
| 1 (as now) | 209 | 76.01% | 78.76% |
| 2 | 209 | 76.63% | 79.34% |
| 3 | 210 | 76.70% | 79.34% |
| 4 | 210 | 76.95% | 79.62% |
| 6 | 210 | 76.63% | 79.30% |

End to end the replay's gain holds and costs sentences:

| | `f657146` | k = 2 | k = 4 |
|---|---|---|---|
| real colour | 11,250 / 14,760 | 11,365 | 11,403 (77.26%) |
| real verdict true | 67 of 72 | 66 | 66 |
| synthetic verdict | 178 of 180 | 175 | 174 |
| synthetic overall | 97.83% | 97.80% | 97.78% |

The sentences lost are all one shape: a steady take now naming one bar
("Bar 6 went at 203."), because the notes of the slide inside it now read off
the kept pulse where the two re-anchors had read them on a level of their
own. On real playing Pirates' saxophone keeps its sentence, "Bars 33–51 ran
ahead.", and the labels' own reading of those bars, under the same rule,
stops holding it. Keeping the pulse and leaving the slid notes out of bar
averages and sentences would keep both, but marks them untimed for a reason
the app has no word for (`UntimedReason` is the page's tempo change, fermata
and ornament), which is the owner's to decide. Not kept.

## 2026-11-14 (skips) — A skip must move the notes after it: `classification.SKIP_CONFIRMED_BY = 3`

**Old behaviour:** on a pairing made by pitch, `skipped_ahead` called a gap a
skip when the take crossed it in nearer one played interval than the whole
written span, and `compute_deltas` started the level afresh after it. A note
whose attack was given to the note after it makes exactly that gap: the note
after arrives one interval on, early by the note left over. On URMP's 72 real
takes, every one played through, the app declared **83 skips in 28 takes**
and the labels' reading none. Each restarted the level the rest of its
stretch was measured from, so a player behind the beat read on it again.

Sorted first, on the captured pulse inputs: of the 2,886 colour disagreements
the labels themselves decide (`(a tie between two attacks)`), 2,543 are the
two readings measuring from levels more than 5% of a beat apart, not a note
placed differently (198) or one near a band's edge (145). Of those 2,543,
1,874 sit after a re-anchor or a skip the app made and the labels did not.

**New:** a skip must move the notes after it too. From the note before the
gap to each of the next `SKIP_CONFIRMED_BY` paired notes must also read
skipped, nearer one interval plus the notes as written after the gap than
the whole written span. A real skip moves every later note; a mispaired one
moves one or two. A real skip this misses is not lost: the pulse re-anchors
after the one long interval it leaves.

| | before (`c2279ac`) | the next note only | the next 3 (kept) |
|---|---|---|---|
| real, skips declared | 83 | 56 | |
| real, heard | 14,749 / 15,035 | 14,758 | **14,760 (98.17%)** |
| real, paired within 100 ms | 14,103 | 14,114 | 14,118 (95.65%) |
| real, colour agreement | 11,177 (75.78%) | 11,217 (76.01%) | **11,250 (76.22%)** |
| real, bar tempo within 2% | 2,897 | 2,899 | 2,901 (72.24%) |
| real, verdict true | 67 of 72 | 67 | 67, every sentence the same |
| synthetic | 97.84% | 97.84% | 97.83% |

Over what the labels decide (the replay), colour agreement on the next-note
version's capture is 78.76%, against 78.46% on the capture before `c2279ac`.
The largest gains are the long takes with many false skips: K515's first
violin 379 → 414 notes coloured as the labels' reading colours them, its
first viola 258 → 306, its cello 226 → 263. Some give back: Rondeau's first
violin −21 (in both mixes), Maria's cello −22, K515's second violin −8. On
synthesis one note moves: `viola/bowed/132/missed/reverb/1088`, whose notes
20–22 are paired with each other's attacks, reads note 21 113 ms off where
the false skip had put it in a stretch of its own.

**Regression, all six clips:** identical.

Tests: `test_an_attack_given_to_the_note_after_is_not_a_skip` and
`test_two_attacks_each_given_to_the_note_after_are_not_a_skip`
(`test_playing_habits.py`); a skipped bar still reads as one.

## 2026-11-14 (measured, not kept) — The labels' pairing beside an equal note, and each instrument's pitch lag. No code or threshold changes.

**The real-take scorer, a tie between two equal notes side by side.** K515's
first violin holds G5 from bar 39 into bar 40 and plays G5 again there (also
bars 78–79). The one label is bar 39's, but `pair_by_pitch_and_time` gave it
to bar 40's: each note's place is read from its paired neighbours' first-pass
pairings, and bar 39's was drawn through bar 40's, the very pairing the tie is
about, so both read three beats from the label and the tie stood. The app
pairs the attack to bar 39's G5 and is marked down twice for it.

Two versions, on the app at `c2279ac`:

| | heard | placed (50 ms) | paired (100 ms) | colour | verdict true |
|---|---|---|---|---|---|
| scorer as it is | 14,749 / 15,035 | 12,263 | 14,103 | 11,177 | 67 |
| no place from any pairing at the note's pitch | 14,759 / 15,029 | 12,296 | 14,144 | 11,392 | 68 |
| none from the note beside it at its pitch | 14,758 / 15,031 | 12,284 | 14,125 | 11,170 | 67 |

The first slides the labels of Pirates' cello part, which ends on twenty B2s,
one note along the run: no place inside the run is drawn from anything near
it, and 20 pairings that sat within 80 ms of the take's line move to 140–370
ms. The second fixes every two-note tie it touches (K515 77/78 and 158/159,
Pirates' first violin, March's and Jerusalem's saxophones), but in runs of
three it can slide the other way: Jerusalem's second violin, notes 67–69,
from 40 ms off the take's line to 500 ms. Neither is clearly better, and a
measuring stick that is not clearly right moves every later comparison, so
neither is kept.

**Each instrument's lag from a pitch taking over to its attack.** The legato
look places a note it finds by pitch 16 ms after the takeover
(`[onset.recovery] pitch_lag_ms`), so it sits on the attacks' clock. Measured
again on URMP at 9,340 labelled notes whose neighbours have other pitches, the
heard attack lands after the takeover by a median of:

| | notes | median | quartiles |
|---|---|---|---|
| violin | 5,040 | 10.3 ms | −9.8 .. 33.8 |
| viola | 1,622 | 22.0 ms | −10.3 .. 42.0 |
| cello | 1,287 | 15.9 ms | −18.6 .. 39.3 |
| double bass | 312 | 33.6 ms | 10.7 .. 46.2 |
| alto saxophone | 1,079 | 19.0 ms | −10.6 .. 68.0 |

The saxophone does not need its own: the +60–80 ms its attacks sit from the
labels on "He's a Pirate" is that take's, not the instrument's. Per
instrument, a note found by its pitch would move by under 18 ms, inside the
quartiles of every row, and the synthetic set barely uses the legato look.
Not made per instrument.

**Why sixteenths read later than quarters** (`cello/bowed/132/missed/
dynamics/1119`, 12 notes and 3 bars of the synthetic set's decided misses).
Refined onsets land +39–42 ms after the truth on quarters and +49–58 ms on
the sixteenths after a 114 ms gap. Neither half of the refinement's walk back
binds; the half-peak itself lands later on a note rising out of the last
one's release (`0cd6c37`), and uneven dynamics widen its 6–7 ms to 10–16. The
three sixteenths among the first eight notes tilt the pace a stretch's level
is projected along (`_settled_level`), and the take reads 11.6 ms off. A
refinement that hears the new note's own partials rise would remove it; the
earlier trial read harmonics over a 93 ms window, and was judged on the bass.

## 2026-11-14 (the legato look's neighbours) — A note no attack marked is asked about by its pitch when the note after shares it, if that note's attack is paired. No thresholds changed.

**Old behaviour:** the legato look (`_recover_legato`) asked only about a
missed note whose pitch differed from both written neighbours, since a pitch
the note before or after also has "would be found whether this note sounded
or not". For the note before that holds: its pitch is sounding already. For
the note after it holds only while that note's attack is unknown. Where it is
paired, the window the look searches ends before it, so a pitch taking over
inside the window is this note's. K515's first violin has six notes with no
attack of their own before a note of their pitch whose attack was paired:
D4, a rest, D4 (bars 5, 15), a long B-flat before another (bars 102, 127,
170), and a B5 in bar 31. Each was reported missing. In bar 96 both D4s lack
an attack, and that pair is still not asked.

**New:** a note is not asked when the note before has its pitch, nor when the
note after has it and that note's attack is not paired.

| | before (`154e3f1`) | after |
|---|---|---|
| synthetic | 97.84% | identical, every take |
| real, heard | 14,723 / 15,035 (97.92%) | **14,749 (98.10%)** |
| real, placed within 50 ms | 12,237 | 12,263 (83.14%) |
| real, paired within 100 ms | 14,071 (95.57%) | 14,103 (95.62%) |
| real, colour agreement | 11,129 (75.59%) | 11,177 (75.78%) |
| real, bar tempo within 2% | 2,889 / 4,016 (71.94%) | 2,897 (72.14%) |
| real, verdict true | 67 of 72 | 67 of 72, every sentence the same |

19 takes move. K515's first violin hears 561 of its 605 notes (was 554), and
colours 379 as a perfect reading would (was 354). One take gives something
back: Pirates' saxophone now hears note 78, paired 28 ms from its label, but
the pitch look places a note through a lag measured on strings and its
neighbours sit at the saxophone's steady +60–80 ms, so bars 25–26 lose their
tempo agreement.

**Regression, all six clips:** identical.

Tests: `test_legato_neighbours.py`, four, with the pitch track given. The
first, a D5 before a paired D5, fails on the old rule.

## 2026-11-14 (a tie between two attacks) — Where DTW gives one note two attacks, the one nearest where the take puts the note keeps it, not the one nearest the page's grid. No thresholds changed.

**Old behaviour:** `apply_fuzzy_match` settled a many-to-one by keeping the
attack closest to the note's written time, in seconds at the page's tempo. A
take running fast or slow has left that grid behind, so the grid sat nearer
whichever attack lay in the direction the player had come from.
`double_bass/bowed/108/fast/phone/1140` is 10% fast and half a second ahead
by its eleventh note. Extra attacks 0.28 s after note 10's own and 0.18 s
after note 34's sat nearer the grid, kept those notes and left their own
attacks over: 2 notes and 2 bars wrong, all decided by the truth. Matching
was made tempo-invariant for exactly this reason (`align_dtw`); the tie-break
was where absolute time had come back in.

**New** (`apply_fuzzy_match`, `_where_the_take_puts`): the tie goes to the
attack nearest where a line through the nearest singly paired notes either
side puts the note. With paired notes on one side only it is a line through
the two nearest there; with one, that note's place moved by the written gap;
with none, the written time, as before. A constant offset no longer moves
it either, which `test_alignment.py` had held as a defect; `to_timeline_base`
stays for `align_take` and the chain.

| | before (`f482e03`) | after |
|---|---|---|
| synthetic, overall | 97.81% | **97.84%** |
| synthetic, notes / bars | 96.47% / 96.60% | 96.50% / 96.74% |
| synthetic, over what the truth decides | 98.41% | 98.44% |
| real, 72 takes | | identical, every card and sentence |

Only `1140` moves on synthesis: notes 28 → 30 of 39, bars 6 → 8 of 8.

**Regression, all six clips:** identical, status, verdicts and every per-note
deviation.

Tests: `test_a_tie_goes_to_where_the_take_puts_the_note_not_the_grid` (a take
10% fast with an extra attack after the note's own, and 10% slow with one
before it; both fail on the grid) and
`test_a_tie_on_the_first_note_follows_the_notes_after_it`.
`test_dtw_no_longer_needs_the_shift_but_fuzzy_matching_still_does` is now
`test_neither_dtw_nor_fuzzy_matching_needs_the_shift`.

**Also measured, not kept: the take's spread without its single displaced
notes.** At `f482e03`, `double_bass/bowed/84/rush/phone/1130` held 37 of the
synthetic set's 185 decided misses. Two pairings there are wrong: one note's
own attack went unheard and an extra attack 130 ms before it was given to
it, and another note was given an attack 400 ms after its own, which was
heard. They make four intervals of 183–410 ms, and with a phone room's
wider jitter they move the take's spread (the median absolute deviation of
its intervals) from the truth's 12.5 ms to 31.7. So the re-anchor limit read
190 ms against 119, and the rush's opening half note (166 ms short) was not
a disturbance. Leaving the two intervals of each single displaced note (the
pairs `(one note out of place)` already clears) out of the spread, found at
the current limit and repeated until none is new, brings `1130` to the floor.
Replayed on the captured pulse inputs:

| | synthetic timing misses | real colour | real colour, over what the labels decide |
|---|---|---|---|
| `f482e03` | 209 | 75.59% | 78.46% |
| iterated | 187 | 75.03% | 78.31% |
| found once, at the floor | 187 | 74.34% | 77.56% |

On real takes most of the loss is in notes the labels themselves do not
decide. The hand labels have displaced notes of their own, those leave the
labels' spread too, and a limit 4 ms lower flips a re-anchor either way
(Pirates' first violin: 60 notes from one decision at 126 against 130 ms).
Over what the labels decide it still loses 15 notes, mostly Jerusalem's
viola and cello, so it is not kept.

**What the labels decide** (a replay, the real-take counterpart of `(what
the truth decides)`): each take's labelled offsets moved by N(0, 2 ms), 8
draws, and a note whose labels' colour changes in any draw is undecided. On
`f482e03` 1,327 of 14,723 notes are undecided, and the app reads 708 of them
otherwise, about a coin toss. Over the 13,396 decided, colour agreement is
78.46%. Not yet in `real_takes.py`.

## 2026-11-14 (one note out of place) — A single displaced note is not a disturbance of the pulse. No thresholds changed.

**Old behaviour:** an interval past the disturbance limit began a run, and the
pulse re-anchored after the run unless the notes after it were back on the
line the notes before it were on (`_level_moved`). A note out of place on its
own makes two such intervals, into it and out of it, opposite ways. Where the
line before was steady, the notes after were back on it and nothing moved.
Where it was a ramp that had just ended, they were not.
`double_bass/bowed/60/rush/noise/1127` paired the note after a rush with a
stray attack 350 ms late. Projected along the rush, the notes after it sat
off the line, so the glitch re-anchored the take. The truth never re-anchors
there, because the rush's own intervals are 13% against a 16.7% limit, so the
bars after it carry the rush. 16 notes and 4 bars were wrong, all of them
decided (`(what the truth decides)`).

**New** (`pulse_anchors`): two disturbed intervals in a row, opposite ways,
whose sum is an ordinary interval (within the same limit) are one note out of
place. They are not a disturbance. That note reads off, and nothing else
moves. Whether the sound was paired with the wrong note or the player put one
note late and carried on, the pulse is where it was. Every case in
`test_pulse_anchor.py` keeps its reading: a pause, a slow bar and rushing that
resumes all step one way and stay.

**Measured.** Replayed offline first (sum within 0.5 / 1 / 1.5 limits:
synthetic timing misses 221 / 209 / 209, real colour 75.70 / 75.59 /
75.61%); 1 kept, the limit a single interval is judged by. End to end:

| | before (`1740049`) | after |
|---|---|---|
| synthetic, overall | 97.71% | **97.81%** |
| synthetic, notes / bars | 96.28% / 96.39% | 96.47% / 96.60% |
| synthetic, over what the truth decides | 98.31% | 98.41% |
| real, verdict true | 66 of 72 | **67 of 72** |
| real, colour agreement | 11,113 / 14,723 | 11,129 / 14,723 |
| real, heard / placed / paired / bar tempo | — | identical |

On real playing the one changed sentence is Rejouissance's saxophone:
"Bars 14–25 ran ahead.", false by the labels, is now "Bars 14–17 fell
behind.", which holds. Colour moves in 24 takes, both ways, between −20
(Pavane's cello) and +18 (K515's cello).

**Regression, all six clips:** identical, status, verdicts and every
per-note deviation (none has a disturbed interval).

New test: `test_one_note_out_of_place_where_a_rush_ends_moves_nothing_else`.
On the previous rule the note moved the rest of the take by up to 600 ms.

## 2026-11-14 (what the truth decides) — The benchmark says which misses no hearing could be sure of. The app is unchanged.

**New, not scored:** `accuracy_bench.py` reads each take's truth again with
every true onset moved by 2 ms (`TRUTH_JITTER_S`, about what a detector
resolves: the finer onset look works on a 2.9 ms grid, and a clean take's
attacks are placed within 1–4 ms of one another), 8 times (`TRUTH_DRAWS`).
A note, bar or verdict the rules read otherwise in any draw is *undecided*:
a perfect hearing with a detector's resolution could not be sure of it. The
strict scores still count everything.

On `1740049`:

| | undecided by the truth | of those, read otherwise | decided: right |
|---|---|---|---|
| notes | 190 | 71 | 6,037 of 6,204 (97.31%) |
| bars | 54 | 20 | 1,354 of 1,386 (97.69%) |
| verdicts | 1 | 1 | 178 of 179 (99.44%) |

The overall over what the truth decides is 98.31%, against 97.71% strict.
This corrects the earlier reading of the re-anchor's cliff as "most of the
synthetic gap" (`(the level)`, `(moving beat, third)`, and PR #219). Sorted by
whether the app's and the truth's re-anchors fall at the same notes, 112
timing misses were re-anchor disagreements. Only 71 notes are the cliff
itself. The rest are re-anchors the app makes and the truth does not,
because of something the app heard wrong: a pairing glitch or noisy
placement raising the limit (`double_bass/bowed/84/rush/phone/1130`). Those,
with the level's and single notes' misses, are hearing, and they are what
stands between 98.31% and 99%.

Also measured, not kept: **re-pairing a run of one repeated pitch by its
attacks' spacing after a timing pairing too** (the chain does it already,
`3e1873e`). It fixes three synthetic takes, among them
`cello/bowed/108/fast/dynamics/1109`, where one unheard attack in five
repeated D4 sixteenths slid the run and set off a re-anchor 1.4 s out. But
it breaks `cello/bowed/132/missed/clean/1116` (8 → 25), where the note after
the run has no attack of its own to bound it. 97.71 → 97.67%, and the 72
real takes are identical.

## 2026-11-14 (pace runs) — Re-anchoring after a sustained change of pace, and a quarter-beat floor: measured, not kept. No thresholds changed.

**The defect looked at.** The re-anchor limit is a fixed fraction of a beat per
interval (`disturbance_floor_beats`, a sixth). The same 15% slowdown is
0.30 beat on a half note and 0.15 on a quarter, so a slowdown re-anchors on
its half notes and not its quarters, and a drag made only of quarters never
re-anchors: every bar after it reads late, which is what the 2026-09 rule was
written to stop. It is also the synthetic set's knife edge. Its drag and rush
make every quarter 15% long or short, just under the floor, so a few tenths
of a millisecond decide whole stretches.

**Pace runs.** A run of intervals at least 4–5% off the take's usual pace,
in one direction, whose drift adds up past the limit, is treated as a
disturbed run. The whole drag then counts on its total of about a beat, far
from any edge. Replayed offline on each take's captured offsets (synthetic:
timing misses among paired notes; real: notes coloured as the labels' reading
colours them, 14,723):

| | synthetic misses | real colour |
|---|---|---|
| current rule | 221 | 75.48% |
| pace runs, drift past 1 limit | 138 | 66.79% |
| … past 3 limits | 138 | 74.50% |
| … past 5 limits | 187 | 74.88% |
| … past 8 limits | 221 | 74.93% |
| pace smoothed over 1–2 beats (5–10%) | 139–162 | 66.25–72.06% |
| floor 0.25 alone | 205 | 76.93% |
| floor 0.5 alone | 161 | 79.89% |
| **floor 0.25 + pace runs past 3 limits** | **157–158** | **75.89–76.26%** |

Every pace-run version costs real colour except with the floor raised; even
one that gains nothing on synthesis (8 limits) loses 0.55 points. On real
rubato every extra re-anchor is another place for the app and the labels to
split. The first version, run in full, also took real verdicts 66 → 64.

**The quarter-beat floor with pace runs, run in full:** synthetic 97.71 →
98.22% (notes 96.28 → 97.28%, bars 96.39 → 97.43%), and every test in
`test_pulse_anchor.py` passes with it. But verdicts fell 178 → 174 of 180.
Three steady takes, and one missing a note, were told "Bar 6 went at 203."
(and alike). Each has two notes the app paired ~0.24 beat early, a hearing
glitch the truth does not have. **The sixth-of-a-beat floor absorbs such a
glitch:** it re-anchors around it, so those notes read on time and the
sentence stays "Steady all the way through." A quarter-beat floor lets the
glitch through to the note rule. Applying the change to the feedback
reference alone, leaving alignment quality on the current rule, gives the same
result, so it is not the pairing. Raising the floor would need glitches
handled on their own first.

Not kept. On these numbers the re-anchor's cliff stays, and with it most of
the synthetic set's gap to 99%. A longer pace window for the level (10, 12 or
16 notes) and a longer level (8 notes) were replayed too: within noise of the
current 8 and 6 on both sets.

## 2026-11-14 (moving beat, third) — The moving local beat, measured on `1740049`: not switched. No thresholds changed.

Measured a third time, on the head that reads a stretch's level from all six of
its notes (`e26640d`) and gives an attack beside a hole to its note
(`1740049`). Neither of those depends on the re-anchor. The level is not read
at all under a moving beat, and the hole repair works on the pairing either
way. So this asks whether, with them, the moving beat now clears 99% on
synthesis without the cost on real playing:

| | re-anchored pulse (`1740049`) | moving local beat |
|---|---|---|
| synthetic, overall | 97.71% | 98.96% |
| synthetic, notes | 96.28% | 98.80% |
| synthetic, bars | 96.39% | 98.19% |
| synthetic, verdict | 178 of 180 | 175 of 180 |
| real, colour agreement | 75.48% | 68.25% |
| real, verdict true | 66 of 72 | 54 of 72 |

It does neither. Synthesis stops just short of 99%. On real playing,
true sentences fall from 66 to 54 of 72 and colour agreement by 7 points, as
before. By instrument the saxophone falls 8 → 3 of 11, violin 32 → 26 of 34
and cello 11 → 9 of 11, while the viola rises 12 → 13 of 13. The re-anchored
pulse stays, and the question stays the owner's.

On synthesis, most of what is left under the re-anchored pulse is the
re-anchor's cliff (`(the level)` below): 8 of the 9 takes it touches sit at
the limit's floor in both readings, where one interval a few tenths of a
millisecond either side decides a whole stretch.

## 2026-11-14 (holes) — An attack beside a note reported missing is given to it by its pitch and its place: new `analysis._beside_a_hole`, `HOLE_MIN_GAP_S = 0.1`

**Old behaviour:** the final pairing was timing's (or the chain's) as it came.
Timing reads each interval against a written one and may read it across one
note the player left out (`DROPPED_NOTE_CAPS`), not two. With two left out in
a row, the sound after them was paired with the second, a beat early, and the
note it was reported missing. A single hole after a long note can be read
either way at near-equal cost too: the strict xfail in
`test_notes_left_out.py`, which this does not touch because that test is
timing alone.

**New:** once the take is paired, the attack of the paired note nearest a run
of missing notes moves to one of them when two independent things agree. The
pitch track hears that note's pitch after the attack, and a line through the
nearest paired notes either side puts the attack nearer that note's place
than its current note's. It repeats until nothing moves, because a hole can
shift a run along and each note given back frees the next one's place. It
never moves inside an ornament, or between notes written closer than
`HOLE_MIN_GAP_S` (0.1 s at the take's tempo).

**Why.** Of the 36 errors in what the synthetic set reported missing, 20 were
a played note reported missing beside a left-out one paired in its place.

**Measured, version by version:**

| | missed | notes | bars | wrong notes | overall |
|---|---|---|---|---|---|
| before (`e26640d`) | 6,418 / 6,454 | 6,152 | 1,386 | 40 / 58 | 97.61% |
| neighbours only, by pitch | 6,426 | 6,155 | 1,389 | 40 / 58 | 97.70% |
| + runs, repeated until still, + repeated pitches by place alone (3× nearer) | 6,430 | 6,158 | 1,390 | 40 / 57 | 97.76% |
| **kept: runs, repeated until still, by pitch only, not within 0.1 s** | **6,426** | **6,156** | **1,388** | **40 / 57** | **97.71%** |

**Two versions measured and narrowed on URMP's real takes:**
- **Notes written too close.** In K515's second violin the pitch rule moved
  the attack of a G4 in a fast turn onto the F♯4 written 0.08 s after it. A
  line through the turn's neighbours made the two look 0.13 s apart. A note
  there is closer than the detector separates attacks (60 ms) or the pitch
  after one is read (up to 120 ms), so the written gap now has to be 0.1 s.
  Sixteenths at 132 BPM are 0.11 s.
- **Repeated pitches by place alone, not kept.** Where the page repeats a
  pitch the pitch says nothing, and a version moved on the place alone at
  three times nearer. It fixed one synthetic take, 1087. On the real takes it
  moved five attacks. Against the labels: one onto its own note (K515's
  fourth part, now 49 ms from its label), one further from both notes'
  labels (King's saxophone), and three inside stretches already paired a
  note or more off (Pirates, Jerusalem's cello, K515's third part). A line
  through rubato neighbours is too loose to decide alone.

**The kept version on the real takes:** every one of the 72 is identical,
card and sentence, to `e26640d`. Each move it would make on them is one of
the two versions above that were narrowed. On the synthetic set it gives the
missed notes back in five takes (1056 and 1149 to no errors at all, 1057
5 → 4, 1090 5 → 1, 1119 17 → 15), and none gets worse. One bar is no
longer named for a wrong note it did not have.

**Regression, all six clips:** identical. None has a note reported missing,
so the rule returns before reading anything.

New tests: `test_beside_a_hole.py`. Five rules with the pitch given: two
left out in a row; notes written too close to tell apart; a wrong note at
the hole's pitch staying where it was played; a shifted run given back in
turn; a repeated pitch never moved. Then end to end on a synthetic bowed take
with notes 4–5 and 9–10 left out, and the same take with the rule off,
which reports note 6 in place of note 5.

## 2026-11-14 (the level) — A stretch's level is read from all six of its notes, not the middle two: new `alignment._middle_of`, `LEVEL_BOUND_DEVIATIONS = 1.0`

**Old behaviour:** the level every note of a stretch is measured from was the
median of its first six notes' offsets, projected back along the stretch's
pace (`_settled_level`). A median of six is the mean of the two in the
middle. **New:** the Hodges–Lehmann estimate of the six — the median of the
means of every pair — held within one robust standard deviation (1.4826 × the
median absolute deviation) of their median.

**Why.** The timing misses on the synthetic set were sorted by kind, from each
note's app-minus-truth deviation and both sides' re-anchor points: of 276, 118
are a re-anchor at a different note from a perfect reading's (the owner's
question below), 103 a level read off by a few milliseconds over a whole
stretch, 35 single notes and 20 not timed. The level misses are not the
detector placing notes badly. Its placement varies by 1–4 ms across a take
(robust spread, by instrument and room; 4.4 ms for a bowed bass through a
phone). The problem is which notes the median picks. On
`double_bass/bowed/108/fast/phone/1140` the two middle notes of six were the
two the detector placed earliest, 13 and 20 ms ahead of its usual, while across
the six it was 2 ms early. The take's level read 17 ms early, putting 30 of its
39 notes and 6 of its 8 bars outside a perfect reading's 12 ms.

**Swept offline** on each take's captured offsets, replaying only the
anchoring (timing misses among the paired notes, 6,316 of them):

| level read as | misses |
|---|---|
| median of 6 (before) | 255 |
| median of 8 | 248 |
| trimmed mean of 6 | 233 |
| Hodges–Lehmann of 8 | 237 |
| Hodges–Lehmann of 6 | 225 |
| HL of 6, within 0.75 / 1 / 1.5 / 2 robust deviations of the median | 225 / 221 / 218 / 219 |
| HL of 6, within 2 / 5 / 12 ms of the median | 239 / 234 / 229 |
| Huber, one step from the median, c = 1.345 / 2 | 239 / 231 |

Hodges–Lehmann alone gives up the median's robustness. Two notes 40 ms late
among six on time read 20 ms, where the median read 0. A bound in deviations
of the notes themselves keeps that robustness. Where four of six agree
exactly the bound is zero and the median stands, and where ordinary jitter
spreads them the bound is that jitter. Every width from 0.75 to 2 deviations
gives 218–227. 1 is kept as the plainest, with no floor (a floor of 1–4 ms
moved it by at most 2 notes).

**Measured end to end:**

- Synthetic (180 takes): **97.31 → 97.61%**. Notes timed within 12 ms
  95.67 → 96.22% (6,117 → 6,152), bars 95.62 → 96.25% (1,377 → 1,386),
  everything else unchanged. Timing error against the oracle: p95 10.6 →
  9.9 ms.
- Real recordings (72 URMP tracks): heard, placed, paired, bar tempo and
  verdict true (66 of 72) are identical. Colour agreement with the labels'
  reading went 11,122 → 11,113 of 14,723 (75.54 → 75.48%), across 43 takes in
  both directions (−11 to +13 each). Two sentences name a bar more or fewer
  ("Bars 30–56" → "Bars 31–56 fell behind.", "Bars 3–21" → "Bars 7–20 ran
  ahead.") and both are still true by the labels.
- A soft re-anchor was tried alongside and is **not kept**. Its weight grew
  from 0 at the disturbance threshold to 1 a ramp past it, to take the cliff
  out of the 118 re-anchor misses. Ramps of 0.01–0.08 beat gave 315–350
  misses against 255. In expectation a soft threshold moves the same
  disagreement around rather than removing it: a drag's re-anchor moves the
  level by over a second, so any difference in weight between the app and the
  truth costs more than 12 ms. The knife edge itself is plain on
  `violin/bowed/60/drag/clean/1011`: one interval read 166.9 ms long by the
  app and 166.6 by the truth, against a 166.7 ms limit, moved 16 notes by
  156 ms.

**Regression, all six clips, before → after** (`_middle_of` against the median
on the same build):

| clip | status | verdict | per-note deviation moved | bands changed |
|---|---|---|---|---|
| 01_detache_clean | ok → ok | Steady → Steady | +0.20 ms (max 0.21) | 0 |
| 02_detache_rushing | ok → ok | Bars 2–8 ran ahead. → same | 0 | 0 |
| 03_detache_dragging | ok → ok | Bars 2–8 fell behind. → same | +0.36 ms (max 0.37); bars +7.5/17.1/23.5% → +7.6/17.2/23.6% | 0 |
| 04_slurred | ok → ok | Steady → Steady | 0 | 0 |
| 05_open_e_long | ok → ok | Steady → Steady | 0 | 0 |
| 06_pizzicato | ok → ok | Steady → Steady | +0.20 ms (max 0.21) | 0 |

New tests in `test_pulse_anchor.py`:
`test_the_level_follows_all_six_notes_not_the_two_in_the_middle` (2 of 20
notes within 12 ms of the truth on the median, 17 now) and
`test_two_late_notes_among_six_do_not_move_the_level`, which plain
Hodges–Lehmann fails at 20 ms.

## 2026-11-14 (the chain's time cost) — No longer saturated at one played gap: `alignment.CHAIN_TIME_WEIGHT × min(away, 1)` → `CHAIN_TIME_WEIGHT × away`

**Old behaviour:** in the chain's second pass, an attack cost
`CHAIN_TIME_WEIGHT` (0.3) per played gap it sat from where the chain puts its
note, on top of its pitch, saturated at one gap. An attack four gaps out
cost no more than one a gap out, so the right pitch anywhere paired. **New:**
not saturated. At four gaps an attack costs what leaving it and the note both
unpaired does (2 × `CHAIN_SKIP` = 1.2), and further away it costs more. Where
the chain puts a note is read from the take's pace and a running median of
the paired notes' offsets (`_where_the_chain_puts`), so one far pairing
cannot move it.

**Swept on the 72 real takes** (scored with the timing-aware label pairing),
by where the cost stops growing:

| saturated at | heard | placed (50 ms) | paired (100 ms) | band | bar tempo | verdict true |
|---|---|---|---|---|---|---|
| 1 gap (before) | 97.84% | 82.83% | 95.27% | 74.89% | 71.39% | 66 |
| 2 gaps | 97.90% | 82.95% | 95.38% | 75.18% | 71.91% | 66 |
| 3 gaps | 97.90% | 83.10% | 95.56% | 75.50% | 71.89% | 66 |
| 5 gaps | 97.92% | 83.11% | 95.57% | 75.54% | 71.94% | 66 |
| never (kept) | 97.92% | 83.11% | 95.57% | 75.54% | 71.94% | 66 |

The gain is smooth in the cap and stops by five gaps, so it is not one lucky
value. Most of it is in K515's cello part, 276 → 297 notes paired within
100 ms of their labels and 6 more heard, and Maria's cello, 325 → 332. A few
takes give a note back where the right pitch really was played far from its
place, such as Rejouissance's saxophone, 3 fewer paired. Every verdict is
the same; three sentences are reworded and still true.

It does not fix Jerusalem's saxophone. The breath paired as its last B4 is
about three gaps from where that note belongs, under the four at which
leaving both out becomes cheaper.

The synthetic benchmark (97.31%) and the six fixtures are unchanged at every
cap. `test_the_right_pitch_far_from_its_place_is_not_its_note`
(`test_note_chain.py`) fails on the saturated cost.

## 2026-11-14 (the labels' pairing) — The real-take scorer breaks a tie between equal pitches by timing. The app is unchanged.

**What changed is the measuring stick, not the app.** `real_takes.py` pairs
each hand label with a written note before anything is scored. It did that
by an edit distance over pitch alone (`pair_by_pitch`), and where the page
writes the same pitch twice close together, the two pairings cost the same.
K515's second violin plays D5 on beat 2 of bar 80, exactly a beat after the
B4 before it, and the page writes D5 again as a sixteenth in bar 81. The tie
went to the sixteenth, 0.7 s from where the note was played. The labels'
tempo for bars 77–81 then counted a sentence false that the recording
supports.

`pair_by_pitch_and_time` keeps the first pass, maps written beats to seconds
from its pairings, and runs the edit distance again. This time a label's
distance from where its paired neighbours put the note, never its own
pairing, adds up to 0.4 at half a beat or more. A note left over costs 1.0,
so the term settles ties and never outweighs a pitch. It changes 27 of the
roughly 15,000 written notes' pairings, in 10 takes: 8 in Jesus's violin, 2
or 3 in each K515 part, and the rest in Spring, the fugue's saxophone,
Pirates' saxophone and Jerusalem's.

| the same app, 72 real takes | old scorer | new scorer |
|---|---|---|
| heard | 97.83% | 97.84% |
| placed (50 ms) | 82.78% | 82.83% |
| paired (100 ms) | 95.25% | 95.27% |
| band | 73.46% | 74.89% |
| bar tempo | 71.37% | 71.39% |
| verdict true | 65 | 66 |

The band moves the most. A label given to the wrong note moved the oracle's
pulse, so the app's colours were marked against a reading the recording did
not support. That shows in violin, 77.74% → 81.10%. Jesus's violin, "Bars
30–56 fell behind.", is true by the corrected labels. K515's second violin
is still 2% off and still false. Figures in entries above this one were
scored the old way, and comparisons within each entry are like for like.

## 2026-11-14 (moving beat, again) — The moving local beat, measured on the current code: not switched. No thresholds changed.

The moving local beat measures each note against the median of the offsets
within ±2 beats, in place of the re-anchored pulse, for the app and the
perfect reading alike (`scratchpad` prototype, as before). It was measured
once early on 2026-11-14 and left as the owner's question. Since then the
pairing, the trust rule and the verdict rules have all changed, so it was
measured again on this branch's head:

| | re-anchored pulse (today) | moving local beat |
|---|---|---|
| synthetic, overall | 97.31% | 98.82% |
| synthetic, notes | 95.67% | 98.70% |
| synthetic, bars | 95.62% | 97.92% |
| synthetic, verdict | 178 of 180 | 174 of 180 |
| real, band | 73.46% | 67.98% |
| real, verdict true | 65 of 72 | 54 of 72 |

On synthesis it nearly closes the gap to 99%, because most of what is left
there is the re-anchor flipping on a hesitation at its threshold. On real
playing it is worse on both of the measures a player reads. Measured against
a beat that follows them, a rubato player's notes all sit near zero, and so
near the inner band's edge, where a few milliseconds change a note's colour
and the note rule's run with it. Eleven true sentences become false. The
re-anchored pulse stays. What a note's colour should mean for a player who
shapes every phrase is still the owner's question; these are the numbers
for it.

## 2026-11-14 (the end of a take) — The room after the last note, paired as it: measured, not kept. No thresholds changed.

**The case.** Jerusalem's saxophone ends on two written B4s, played as one.
The chain paired the first with the played B4, and the second, the final
three-beat note, with a breath 3.8 s after it. That breath read B4 and sat
4.6 dB above the room. The last three bars read at 62 rather than the
labels' 55. Pirates' second violin had its last note paired 1.9 s late, at
2.2 dB above the room.

**Two rules tried.**
- **By the last interval.** Drop a final pairing that comes far later than
  the take's pace puts it. On the 72 takes the ratio of the final interval
  to its written length at the local pace did not separate the cases.
  Jerusalem was 3.5, Pirates 7.1 and Jesus 3.2, all mispaired. The Miserere
  saxophone's final note, played correctly after a long ritardando, was
  4.6.
- **By level.** Drop the pairings at the end whose sound is less than
  `[onset.recovery] min_level_db` (10 dB) above the room, the floor a
  recovered attack must clear. This dropped both bad pairings and kept the
  Miserere's (23 dB). It also dropped real final notes in 14 takes, 1 to 4
  each: pieces often end softly, near the room. Real heard fell from
  97.83% to 97.69%. Verdict true was unchanged at 65, and Jerusalem's
  sentence changed but stayed false.

Neither is in. Telling a soft last note from the room after it needs more
than its level or its time.

## 2026-11-14 (short runs) — In a long take, a run of one or two bars is named only when severe: new `[tolerance] long_take_bars = 16`, `long_take_min_bars = 3`

**Old behaviour:** the bar rule named the longest run of bars off the target
the same way: a single bar when clearly out (past the mid band), two or more
whenever they were off. **New:** in a take with at least `long_take_bars`
(16) bars with a tempo, a run must cover `long_take_min_bars` (3) bars,
unless every bar of it is severely out (past the outer band). A shorter run
falls through to the note rule. A shorter take keeps the old rule. A
remote-config row without the keys keeps the old rule everywhere.

**Why.** The verdicts said on URMP's 72 real takes, by how many bars they
named, and whether the labels hold them:

| the sentence names | true |
|---|---|
| one bar | 1 of 2 |
| two bars | 3 of 14 |
| three or four bars | 19 of 21 |
| five or more | 25 of 26 |
| a side, no figure | 7 of 9 |

The run named is a maximum over every bar of the take. A bar's measured
tempo is good to a percent or two on real playing, and many bars of a long
take sit near the band's edge. So the more bars there are, the likelier it
is that one or two land past the edge by their own error, and the longest
run is then that blip. Most of the false two-bar sentences quote bars the
labels put 4–5% off. Making the band wider did not separate them, since true
and false short runs both sit between 5% and 16% (measured: a run of two
needing every bar past the mid band, as one bar already did, gave 60 true
rather than 65). In a long take, one bar past the mid band was true once in
six.

A short take keeps its two-bar runs. There two bars are a large share of
what was played, and there are few bars for chance to choose among. The
owner's slowing to 80 over two bars of ten is still named, and so would it
be in a long take, because it is severe.

| real, 72 tracks | before | after |
|---|---|---|
| verdict true | 55 | 65 |
| strings | 51 of 61 | 57 of 61 |
| saxophone | 4 of 11 | 8 of 11 |

Twelve sentences became true, mostly as the note rule's side over a long
stretch ("Bars 5–63 fell behind."), which the labels hold note by note. One
became false: Hark's viola, from "Bars 2–3 went at 111." to "Bars 13–18 went
at 123.". The synthetic benchmark (8-bar takes, 97.31%) and the six fixtures
are unchanged.

## 2026-11-14 (held notes) — The second look does not find a note the player left out inside the note before. No thresholds changed.

**Old behaviour:** where the page writes a note and none was heard, the
second look's attack search (`analysis._recover_attacks`) took the onset
envelope's nearest rise. It checked that rise for prominence, level above the
room, and not being a release. **New:** an attack it finds is dropped when the
pitch is still the note before's both just after it and halfway to the next
attack, and the missed note is written at another pitch
(`analysis._not_the_note_before`). A missed note that sounded is heard at its
own pitch, and a wrong one at some other. Where the page repeats a pitch,
nothing is dropped, because the rule cannot tell.

**Why.** On the synthetic set, eight notes the player left out were
"recovered" inside the note before: a vibrato swell, or a change of bow
pressure, at the held note's pitch, with no rise in level (−1.0 to +0.3 dB).
Viola take 1086 left out a G4 under a held B4, and the second look placed the
G4 51 ms early in the B4. It is also the case `test_legato_notes.py` had held
as a strict xfail since 2026-11-13, and the test now passes.

**Why this guard holds where 2026-11-13's did not.** That one compared the
pitch on both sides of the attack. A quiet note under a loud note's tail has
the tail's pitch on both sides, so it was dropped, and
`test_degraded_audio`'s room-swallowed take was refused again. This one listens
only after the attack, and a note under a dying tail takes over within its own
gap. Every `test_degraded_audio` test passes.

**Heard twice, because once was not enough.** Read once, just after the
attack, the rule also dropped two played notes of a plucked bass take (1175).
The note before was still ringing there when the new pluck came. Read again
halfway to the next attack, the new note has taken over, and only a note held
on is still the note before at both readings.

| | before | read once | read twice (kept) |
|---|---|---|---|
| synthetic, overall | 97.24% | 97.29% | 97.31% |
| synthetic, missed | 99.33% | 99.44% | 99.44% |
| synthetic, notes | 95.67% | 95.64% | 95.67% |
| synthetic, bars | 95.42% | 95.62% | 95.62% |
| real, heard | 97.85% | 97.81% | 97.83% |
| real, paired (100 ms) | 95.19% | 95.19% | 95.25% |
| real, band | 73.23% | 73.53% | 73.46% |
| real, bar tempo | 71.45% | 71.42% | 71.37% |
| real, verdict true | 55 | 55 | 55 |

On synthesis, eight takes gain and one loses. The loss, bass take 1149,
follows from a correct drop: two notes were left out a bar apart, and without
the false attack, timing pairing slides the second hole onto the note after
it. That is the timing pairing's weakness with notes left out, not this rule.
On real playing, both Pavane cello parts gain 16 and 17 notes in their band:
a recovery 250–500 ms from its labelled note had moved their pulse. K515's
cello gives back 3 heard notes and Maria's cello 1. The six fixtures are
unchanged.

## 2026-11-14 (ringing attacks) — A note's first attack heard as the note before: measured, not kept. No thresholds changed.

**The case.** Synthetic `double_bass/bowed/60/rush/noise/1127`. Note 20's own
attack came while note 19's A1 still rang in the room's 58 Hz mode, so the
pitch track read A1 for 200 ms after it. The chain paired note 20 with a stray
attack 0.35 s into the note, where D2 had taken over. `_first_attacks` moves a
pairing back only over attacks heard at the note's own pitch, so it did not
move. The false 0.35 s jump re-anchored the pulse, and bars 5–8, played a full
beat ahead, read as on the beat: 17 notes and 4 bars wrong.

**The rule tried.** Move such a pairing back to the attack just before it
when that attack reads as the note before, comes after that note's own
pairing, and is the nearer of the two to where the take's local pace puts the
note, leaving the note itself out of the pace. Without the pace, the move is
wrong 22 times in 24 on the synthetic set: the earlier attack is usually a
stray one inside the note before.

| | before | with the rule |
|---|---|---|
| synthetic, overall | 97.24% | 97.53% |
| synthetic, notes / bars | 95.67% / 95.42% | 96.18% / 96.11% |
| real, paired (100 ms) | 95.19% | 94.89% |
| real, placed (50 ms) | 82.74% | 82.37% |
| real, bar tempo | 71.45% | 70.85% |
| real, band | 73.23% | 73.75% |
| real, verdict true | 55 | 55 |

On synthesis exactly the two takes with the pattern improve and none
worsens. On real playing it moves about 25 takes' pairings, most of them
wrongly by the labels: Jupiter's cello loses 4 paired notes and 4 bar tempi,
and K515's first viola loses 4 and 7. Its band gain comes from a few moves
that happened to stop a re-anchor, such as Rondeau's second violin, while
placing the moved note worse. Real players' rubato makes the local pace a
poor guide to which attack begins a note. Not kept, and nothing in the code
changed. A cue that might hold on real playing is where the note's pitch
takes over between the two attacks. A slurred note has that shape too,
though, so it would need its own measurement.

## 2026-11-14 (quoted figures) — A run's tempo is quoted only when it is 2% or more off the target: new `[tolerance] quoted_min_pct = 2.0`

**Old behaviour:** `classification._run_verdict` quoted a run's tempo ("Bars
1–6 went at 100.") whenever it agreed with the direction and differed from the
target by a whole BPM after rounding. **New:** it must also differ by at least
`quoted_min_pct` (2%) of the target. Nearer than that, the run is told by its
side ("Bars 10–20 ran ahead."), as a run at exactly the tempo always was. A
remote-config row without the key keeps 0, the old rule.

**Why.** URMP's "Spring" violin ran ahead of the beat through bars 4–25, at
the tempo, and was told "Bars 10–20 went at 207." against 206. That is a
difference of 0.5%, which the take's own placement cannot resolve, and the
sentence quoted it as a tempo. The labels' reading of the same take said "Bars
4–25 ran ahead.", with no figure, because its difference rounded to nothing.
Rounding was deciding which of the two forms a take got.

The bar rule is not affected: since `7ca736f` it names only stretches whose
quoted tempo is past the inner band (5%). The note rule exists for takes a few
percent off that every bar calls on tempo, and its figures there are worth
saying: 3.8% under in `test_classification.py` ("Bars 1–6 went at 100."
against 104), and 3% over in `test_readings.py`. Two real sentences quoted a
figure inside 5% of the target: Spring at +0.5%, and Rejouissance's second
saxophone at +2.3%. The labels read the saxophone take the other way, so no
wording rule fixes it.

| real, 72 tracks | before | after |
|---|---|---|
| verdict true | 54 | 55 |

`08_Spring/2_vn` went from "Bars 10–20 went at 207." to "Bars 10–20 ran
ahead.", which the labels hold. Nothing else moves. The synthetic benchmark
(97.24%, no take differs) and the six fixtures are unchanged.

## 2026-11-14 (wrong parts) — The long-page share lets the chain pair a take; the usual share reports it. No thresholds changed.

**Old behaviour (the entry below, `28cc9c3`):** as a last resort, a long page
was trusted on `confirmed_share_long` (0.65) of its chain heard at pitch,
both to be paired by the chain and to be reported. **New:** 0.65 only lets
the chain pair the take (`_audited_by_chain`). The take is reported only if,
after the second look, it is heard at `confirmed_share` (0.7), the September
rule (`_analyze_take`).

**Why: the wrong part opened.** Every URMP recording was read against the page
of each other part of the same piece, 168 pairs, because the realistic
mistake on a long page is opening the wrong part. Under `28cc9c3`, two pairs
that the old rule refused were given a verdict. Both are "Jerusalem", where
the double bass doubles the cello an octave down:

| take, on the page of | heard at pitch, chain | after the second look | `28cc9c3` said | now |
|---|---|---|---|---|
| double bass, on the cello's | 92 of 139 (0.66) | 93 (0.67) | "Bars 1–4 went at 61." | refused |
| cello, on the double bass's | 84 of 122 (0.69) | 84 (0.69) | "Bars 34–38 went at 46." | refused |
| K515's cello, on its own | 242 of 360 (0.67) | 291 (0.81) | "Bars 15–23 went at 200." | the same |

The chain cannot tell a part that doubles the page from a take of the page
with rubato: both hear about two thirds of it. The second look can. It
searches where each unheard note belongs. The notes a take of the page
missed are there to be found, and the notes a different part lacks are not.

Synthesis agrees. A 96-note page played with every fourth note a step away,
and timing refused, was paired on the lower share at 0.69. The second look
took it to 0.73, which is the page played with wrong notes, and it is
reported. With nothing for the second look to find, it is refused.
`test_a_long_page_paired_on_the_lower_share_is_reported_only_at_the_usual_one`
holds both halves. With three notes in ten a step away, no seed of eight
reached the lower share at all (0.55–0.64).

One pair of the 168 is still given a verdict, under either rule: "Hark the
Herald"'s first violin on the second violin's page, "Bars 12–13 went at
125.", with 4 of 73 notes at pitch. The two parts move together, so timing
accepted it at quality 0.47, and the chain played no part. That is older than
this rule, like the synthetic pages of quarter notes that timing accepts out
of order (the entry below), and is not changed here.

Everything else is as `28cc9c3` left it, measured again: K515's cello is the
only real take of 72 that moves from before both changes, with the same
figures, and the synthetic benchmark (97.24%) and the six fixtures do not
move.

## 2026-11-14 (long pages) — As a last resort, a long page needs less of its chain heard at pitch: new `[pitch] confirmed_share_long = 0.65`, `confirmed_long_notes = 64`

**Old behaviour:** a pairing was trusted by pitch (`analysis._trusted_by_pitch`)
when at least `confirmed_share` (0.7) of the notes the page asks for were heard
at their written pitch, however long the page. **New:** a page asking for at
least `confirmed_long_notes` (64) needs `confirmed_share_long` (0.65), but only
as a last resort: timing has refused the take and no other reading of it
follows. A take refused with the vibrato filter is read once more without it
(`analyze`), so the first reading is the last only when there is no filter to
drop. A remote-config row without the new keys keeps 0.7 everywhere.

**Why.** 0.7 was set where chance is highest. On 2026-09-25 a different tune in
the same key reached 0.62 of a 16-note page, 0.47 of 32 and 0.42 of 64. URMP's
K515 cello part plays 360 notes over 3.6 minutes with rubato. Timing refused
both of its readings, and on the unfiltered one the pitch chain heard 242 of
the 360 at pitch: 0.67. So it was told "Same notes, different times. Check
you're on the right piece and the tempo.", and every one of its 353 played
notes counted as unheard: 353 of the 389 unheard cello notes in the set.

**Chance on long pages, measured on the chain itself.** This is the chain's
best share for something other than the page, which is the measure the trust
rule reads. The pages were synthesised the way `test_note_chain.py` builds
them. Each cell gives the median, then the most:

| page | seeds | a different tune, same key | the page reversed | the page's notes shuffled |
|---|---|---|---|---|
| 64 notes | 10 | 0.38, 0.50 | 0.37, 0.59 | 0.38, 0.47 |
| 128 notes | 10 | 0.38, 0.42 | 0.39, 0.56 | 0.37, 0.46 |
| 256 notes | 8 | 0.36, 0.45 | 0.40, 0.46 | 0.31, 0.36 |

The different tune was played with every gap within ±30% of a beat, and the
other two within ±50%, as in the 2026-09-25 table. 0.65 clears the different
tune by 0.15, and the page reversed by 0.06. That second margin is thin, but
the 0.7 share has run thinner since September: it clears the page's notes
shuffled on a 32-note page by 0.01. A short page keeps 0.7, which is what the
16-note case needs.

Three of these pages were given a verdict, two reversed and one shuffled, all
of 64 notes. All three were read the same way under the old rule: timing
accepted them (quality 0.41–0.44), and the chain played no part. On a page of
quarter notes, timing cannot tell which order the notes came in. That is
older than this change and is not changed by it.

**Narrowed twice before it was kept.** Lowered wherever a long page's chain is
asked, it rescued K515's cello and cost five takes that were already read.
Lowered only where timing refused the take, it cost **the same five, to the
note**, so the cost was not, as first supposed, where timing accepted a take.

Each of the five is refused by timing with the vibrato filter and read without
it. Rescued on the lower share, the first reading became final, and the second
reading, which pairs better, was never made. "He's a Pirate"'s viola heard 95
of its 136 notes at pitch with the filter, just under 0.7. Rescued there, it
read at quality 0.32; read without the filter, it reads at 0.57 with 121.

| take, before → rescued on its first reading | heard | paired within 100 ms | sentence |
|---|---|---|---|
| `24_Pirates/3_va` | 124 → 108 of 131 | 111 → 87 | "Bars 33–34 went at 214." → "Bars 5–6 went at 169." |
| `25_Pirates/3_va` | 124 → 110 of 131 | 111 → 99 | the same |
| `24_Pirates/4_vc` | 178 → 166 of 178 | 178 → 166 | unchanged |
| `44_K515/3_va` | 446 → 428 of 459 | 436 → 375 | "Bars 118–122 went at 197." → "Bars 118–123 went at 198." |
| `44_K515/4_va` | 500 → 462 of 508 | 484 → 428 | "Bars 68–71 went at 199." → "Bars 119–121 went at 199." |

Lowered only on the last reading, the rule rescues K515's cello on its
unfiltered reading and **nothing else moves**. Its filtered reading heard 88
of 360 at pitch and stays refused. Where both readings are refused, the first
refusal stands, as it always has. The first reading's chain is not asked again
on the lower share, because the unfiltered reading hears more of a take (338
attacks to 261 on that cello, 130 to 104 on the Pirates viola). After this
change, no take of the 252 measured is refused by both readings.

| real, 72 tracks | before | after |
|---|---|---|
| status, against the oracle | 71 | 72 |
| heard | 95.68% | 97.85% |
| placed (50 ms) | 82.90% | 82.74% |
| paired (100 ms) | 95.46% | 95.19% |
| band | 73.58% | 73.23% |
| bar tempo | 68.51% | 71.45% |
| verdict true | 53 | 54 |
| cello: heard | 83.28% | 97.34% |
| cello: bar tempo | 47.48% | 66.04% |

K515's cello is the whole of the change. It now says "Bars 15–23 went at 200.",
which the labels hold. 327 of its 353 played notes are heard: 273 paired
within 100 ms, 248 within 50 ms, and 188 in their band. Placed, paired and band
are shares of the notes heard, so they fall a little as 327 notes played with
rubato join them. Unheard notes across the set fall from 650 to 323. The
synthetic benchmark is unchanged (97.24%, no take differs), and so are the six
fixtures.

## 2026-11-14 (quoted tempo) — A stretch of bars is named only when the tempo it is quoted at is off. No thresholds changed.

**Old behaviour:** the verdict named the longest run of bars each banded off
the target the same way (`_longest_bar_run`), and quoted the tempo of the run
taken together (`BarTempi.across`). **New:** a run is named only if that quoted
tempo is itself past the inner band, on the same side (`_off_as_quoted`).
Otherwise the next run is tried, and then the note rule. A run with no tempo of
its own to quote is judged by its bars, as before.

**Why.** A bar's tempo is read downbeat to downbeat. A player who hurries
inside each bar and takes the time back at the bar line reads fast in every
bar, while the stretch as a whole keeps the tempo. The sentence then quoted
the stretch, for example "Bars 10–20 went at 207." against 206, under a title
saying the take rushed. Six real sentences quoted a tempo inside the ±5%
inner band, and the labels held none of them.

| real, 72 tracks | before | after |
|---|---|---|
| verdict true | 52 | 53 |

| take | before | after | labels |
|---|---|---|---|
| `30_Fugue/4_sax` | "Bars 41–43 went at 116." | "Bar 47 went at 97." | true |
| `10_March/2_sax` | "Bars 22–23 went at 164." | "Bars 4–5 went at 140." | the labels' run is bars 4–6; still false |
| `24`/`25_Pirates/3_va` | "Bars 16–17 went at 208." | "Bars 33–34 went at 214." | still false |

No true sentence became false. The other measures do not move, because the
rule changes only the sentence. The synthetic benchmark is unchanged
(97.24%, no take differs), and so are the six fixtures.

## 2026-11-14 (octaves) — A pitch read an octave off is put back by its partials: new `[onset.instrument.*] octave_below_ratio` and `octave_above_ratio`

**Old behaviour:** each attack's pitch was the YIN track's median over the
listening window (`pitch_evidence.heights_at`). **New:** that pitch is moved
an octave where the window's spectrum says so (`pitch_evidence.octave_checked`):
- **down an octave** where the odd partials of half the pitch reach
  `octave_below_ratio` of the pitch's own first three. A note at f/2 has
  partials there; a note at f has none.
- **up an octave** where the pitch's odd partials fall under
  `octave_above_ratio` of its even ones. A note at 2f has nothing at f's odd
  multiples.

Neither moves a pitch out of the instrument's range. Unlisted instruments, and
the tenor saxophone, which no recording has measured, keep 0: off. The note
chain reads the checked pitch (`analysis._Pitch.heights`), once per attack per
take. Wrong-note naming compares pitch classes with the octave folded, so it
is unaffected.

**Why.** In the viola part of "He's a Pirate", four F♯3s were read as F♯4. The
run of twenty F♯4s after them was short of attacks, so the chain gave the
F♯3s' attacks to the first F♯4s and left the F♯3s out. The chain charges an
octave half a wrong note's price. Across URMP, YIN at the labelled notes
(read at the label, offline):

| | notes | read right | octave high | octave low |
|---|---|---|---|---|
| violin | 7,606 | 7,397 | 61 | 52 |
| viola | 2,948 | 2,628 | 206 | 41 |
| cello | 2,341 | 2,047 | 16 | 102 |
| double bass | 406 | 381 | 2 | 14 |
| alto sax | 1,911 | 1,891 | 14 | 1 |

### The sweep, at the labelled notes

| | below / above | read right after | put right | put wrong |
|---|---|---|---|---|
| violin | **0.2 / 0.15** | 7,436 | 50 | 11 |
| viola | **0.2 / 0.15** | 2,750 | 133 | 11 |
| cello | 0.2 / 0.15 | 1,968 | 19 | 98 |
| cello | **0.5 / 0.25** | 2,065 | 29 | 11 |
| double bass | **0.5 / 0.25** | 385 | 6 | 2 |
| alto sax | **0.2 / 0.15** | 1,894 | 3 | 0 |

Ratios of 0.3–0.5 for `below` put right only 20–40 of the viola's octaves; at
0.2 it is 133. Many of the cello's correctly read notes show partials at
the odd multiples of half their pitch, which nothing here explains, so at 0.2
the check moved 98 of them down; it takes 0.5.
These were found on the same recordings they are measured on below: what
generalises is the direction and the cello's difference, not the second
decimal.

### Real takes, 72 tracks, against the labels

| | before | after |
|---|---|---|
| paired ≤ 100 ms | 13,699 (95.30%) | 13,732 (95.46%) |
| placed ≤ 50 ms | 11,896 (82.76%) | 11,925 (82.90%) |
| colour as the oracle's | 10,506 (73.09%) | 10,585 (73.58%) |
| bar tempo | 2,739 (68.19%) | 2,752 (68.51%) |
| verdict true | 51 | 52 |
| heard | 14,374 | 14,385 |

- The Pirates viola part gains 15 paired notes, in each of its two takes.
- The fugue's viola part had read "Bars 30–50 fell behind." against the labels'
  "Bars 45–76 ran ahead.", which looked like the re-anchor question. It had 30
  octave errors; it now says "Bars 46–73 ran ahead.", which the labels hold.
- 28 takes change. The largest losses are three paired notes
  (`11_Maria/2_vc`, `26_King/3_va`, `44_K515/3_va`), and 40 colours on one
  take whose pairing changed by one note (`12_Spring/2_vn`).

### Synthetic benchmark (180 takes)

97.21% → 97.24%: two more left-out notes reported, two more bars.

### Regression across the six fixtures

All six are identical to the committed code, every note's deviation included.


## 2026-11-14 (flat pitch classes) — A sound with no pitch class standing out matches no note: new `pitch_evidence._FLAT_CLASSES = 0.5`

**Old behaviour:** where no pitch held after an attack, `pitch_evidence.mismatch`
falls back on its twelve pitch classes. The mismatch is `1 − relative[c]`,
how far the written class is below the strongest. **New:** if the median of
the twelve relative strengths is at least `_FLAT_CLASSES`, the profile is
flat, and the attack gets 0.5 for every note, "nothing to compare", as an
attack with no window already did.

**Why.** The cello part of URMP's fugue rests for eight bars. Its first six
notes were paired with sounds from 2 to 19 s before the cello came in, and
the verdict read bars 9–11 at 73 against 115. Those sounds had no pitch, and
their profile was flat: every class near the strongest. So their mismatch
was 0.01 to 0.37 against *every* written note, D3, A3, F3, C♯3 and E3 alike.
Each was cheaper to pair than to leave out (`CHAIN_SKIP`, 0.6). Pairing five
of them won by 7.28 to 7.8 over the right pairing, which had to leave them
out. At 0.5 each, the right pairing wins.

**Where the line is.** On six URMP parts (fugue cello, Jerusalem saxophone,
Spring cello, Rondeau bass, Jupiter violin, Entertainer saxophone), the
median class relative to the strongest:

| attacks | count | p10 | p50 | p90 | ≥ 0.6 |
|---|---|---|---|---|---|
| at a labelled note, no class held | 40 | 0.06 | 0.11 | 0.31 | 0% |
| at a labelled note, a class held | 982 | 0.00 | 0.05 | 0.14 | 0% |
| at no note, no class held | 31 | 0.15 | 0.57 | 0.87 | 48% |
| at no note, a class held | 213 | 0.01 | 0.07 | 0.25 | 3% |

No attack at a note comes near 0.5. Only the fallback is gated: an attack
with a held class and a pitch from the track is matched by its pitch, as
before.

**Tried first, and withdrawn: leaving out the attacks before the first note
for nothing.** Lead-in noise had cost `CHAIN_SKIP` each to leave out, so
making it free looked like the fix. It broke six tests on passages played
twice and going back mid-take. The first playing of a passage is attacks
before the page resumes, and made free it was dropped. Freeing the attacks
after the last note as well broke the same tests. The chain was right to
charge for them; it was being told a breath matched every note.

### Real takes, 72 tracks, against the labels

| | before | after |
|---|---|---|
| paired ≤ 100 ms | 13,670 (95.10%) | 13,699 (95.30%) |
| placed ≤ 50 ms | 11,867 (82.55%) | 11,896 (82.76%) |
| colour as the oracle's | 10,492 (72.99%) | 10,506 (73.09%) |
| bar tempo | 2,712 (67.51%) | 2,739 (68.19%) |
| verdict true | 50 | 51 |
| heard | 14,375 | 14,374 |

23 takes change, almost all by a note or two for the better. The fugue's
cello now says "Bars 72–74 fell behind.", which the labels hold. The largest
losses are two paired notes (`36_Rondeau/4_vc`) and 15 colours on one take
whose pairing changed by one note (`20_Pavane/3_vc`).

### Synthetic benchmark (180 takes)

97.20% → 97.21%: one more note timed, one more left-out note reported.

### Regression across the six fixtures

All six are identical to the committed code, every note's deviation included.

## 2026-11-14 (repeated notes) — A run of one pitch paired by its spacing: new `alignment.SPACED_RUN_NOTES = 3`, `SPACED_RUN_STEP = 3`, `SPACED_RUN_GAIN = 0.15`, `SPACED_RUN_PACE_NOTES = 3`, `SPACED_RUN_BOUND_CAP = 0.5`

**Old behaviour:** inside a run of one repeated written pitch, pitch cannot
say which attack is which. The chain kept whatever its walk back from the end
chose. Its second pass placed each note from the pairings around it, and
inside a long run those are the run's own. **New:** after each of the chain's
passes, `_runs_by_spacing` pairs each run of three or more notes again, using
the attacks between the two pairings that bound it. Each step costs:
- how far the played interval is from the written one at the local pace
  (`_local_pace`: the median of the chain's own intervals within three notes);
- `CHAIN_SKIP` for each note or attack left out;
- each attack's pitch cost, as in the chain, so an out-of-tune note inside a
  run is still its note.

An interval to either bound costs at most `SPACED_RUN_BOUND_CAP`. The chain's
pairing is replaced only where the new one is cheaper by `SPACED_RUN_GAIN`. A
run the take begins or ends inside is left alone.

**Why.** Of the 893 notes paired more than 100 ms from their label, ten takes
held 45%. The largest single pattern was a run of one pitch slid by one note:
- "In the Hall of the Mountain King", second violin: 64 repeated E4s with one
  attack missed and one extra. The 31 E4s between them were each paired with
  the next note's attack, 329 ms late. A missed attack leaves a gap twice the
  written one, and an extra attack leaves one half as long.
- Vivaldi's "Spring", cello: runs of 8 to 15 repeated E3s slid by ±620 ms.
- "He's a Pirate", viola: runs of 20.

**Measured first, and not kept:**
1. *Placing the second pass from pinned notes only* (notes whose pitch
   differs from both neighbours). The cello gained, but where a whole passage
   is runs (King's viola: E4×8, G3×8, E4×8 …) there is no pinned note, and the
   second pass slid the passage. Overall: −93 notes paired.
2. *One pace per run, bound to bound, with no cap and no margin.* A passage
   speeding up (King, bars 33–36) read as a run of errors. The A3 after nine
   C5s was paired 645 ms early, and its short interval outweighed the run's
   own spacing: 9 right became 2. In "Hark! The Herald Angels Sing", a half
   note paired 774 ms late let a slid pairing of three C4s win by 0.02.

The cap was swept on the three parts above (correct pairings within 100 ms):

| cap | King violin (169 without) | Spring cello (225) | Hark viola (60) |
|---|---|---|---|
| 0.35 | 178 | 233 | 60 |
| **0.5** | **208** | **233** | **60** |
| 0.7 | 192 | 233 | 60 |

At 0.35 the 64-E4 run is not repaired; at 0.7 the C5s slide. That window was
found on three parts, so what decides it is the 72 below. The margin made no
difference to these three at 0 or 0.15. At 0.3 the King run stays slid: its
repair is cheaper by under 0.2.

### Real takes, 72 tracks, against the labels

| | before | after |
|---|---|---|
| paired ≤ 100 ms | 13,500 (93.80%) | 13,670 (95.10%) |
| placed ≤ 50 ms | 11,730 (81.50%) | 11,867 (82.55%) |
| colour as the oracle's | 10,285 (71.46%) | 10,492 (72.99%) |
| bar tempo | 2,683 (66.79%) | 2,712 (67.51%) |
| verdict true | 48 | 50 |
| heard | 14,393 | 14,375 |

| | paired | placed | colour | bar tempo | verdict true |
|---|---|---|---|---|---|
| violin | 95.80 → 97.11% | 90.09 → 91.32% | 77.86 → 78.23% | 73.95 → 74.39% | 26 → 26 |
| viola | 95.31 → 96.39% | 84.61 → 85.50% | 69.08 → 71.61% | 67.13 → 67.87% | 10 → 10 |
| cello | 86.77 → 88.61% | 75.28 → 77.13% | 59.94 → 65.38% | 46.23 → 46.54% | 7 → 8 |
| double bass | unchanged | | | | |
| alto sax | 90.26 → 91.58% | 48.43 → 48.45% | 56.84 → 57.68% | 58.70 → 61.30% | 2 → 3 |

- King's second violin gains 39 notes paired, in each of its two takes.
- Pirates gains 27 (cello), 21 (saxophone) and 11 (viola, in each of its two
  takes).
- No take loses more than two paired notes.
- **18 fewer notes are heard.** Where an attack was really missed, the note
  is now reported missing rather than paired with its neighbour's attack.
  That is the honest reading, and the labels count it as a miss.

### Synthetic benchmark (180 takes)

97.18% → 97.20%: one more note and one more bar.
`double_bass/bowed/60/steady/phone/1125`. The first version, which paired a
run only with attacks heard at its pitch, lost note 19 of
`double_bass/bowed/60/steady/noise/1122`. Pricing pitch as the chain does
restored it, and that is now a test.

### Regression across the six fixtures

All six are identical to the committed code, every note's deviation included.

### Measured after, and not kept: the release guard on the first pass

In "Jerusalem" the end of the saxophone's last note was taken as an attack.
The second look already refuses a sound that falls by more than
`recovery_max_fall_db` (12 dB) across it. The same guard was tried on the
first pass:

| real, 72 tracks | without | with |
|---|---|---|
| first-pass attacks at a labelled note | 12,954 | 12,728 |
| first-pass attacks at no note | 2,670 | 2,572 |
| paired ≤ 100 ms | 95.10% | 94.67% |
| verdict true | 50 | 49 |

It drops 226 real attacks to remove 98 false ones. A note starting just as
a louder one ends also reads as a fall. The synthetic benchmark was
unchanged.

## 2026-11-14 (verdicts) — The verdict scored by its bars, and by whether it is true. No thresholds changed.

**Every verdict figure since the benchmark was built scored the direction
alone.** `accuracy_bench.bars_named` looked for "bars 4–5" in lower case, and
the run sentence opens "Bars 4–5 went at 73." It matched none of them, so the
bars a verdict named were compared as `None == None`. The pattern is now
case-blind.

| | as reported | bars scored |
|---|---|---|
| synthetic, 180 takes: verdict | 180 (100%) | 178 (98.89%) |
| synthetic: overall | 97.20% | 97.18% |
| real, 72 tracks: verdict | 55 (76.39%) | 12 (16.67%) |

The two synthetic misses differ by one bar at a run's edge: "Bars 3–5 went at
66." for "Bars 4–5 went at 63.", and "Bars 5–6" for "Bars 5–7".

**On real playing, "the same bars" is the wrong question.** A verdict names
one run, the longest. On a real take, two runs are often close to a tie, and
one bar's tempo can sit at a band's edge. The labels' reading then names a
different run: a different sentence, not a false one. "Bars 27–34 went at
144." is true of the viola in "In the Hall of the Mountain King", which speeds
from 106 to 178. The labels' reading names "Bars 1–12 went at 99." instead,
because the app reads bars 4 and 9 a few BPM on the other side of the band's
edge and so breaks that run.

So `real_takes.py` now also asks whether the sentence is **true by the labels**
(`verdict_holds`):
- "Bars a–b went at N.": by the labels those bars went the same way, past the
  inner band, at N within 2% (or 1.5 BPM).
- "ran ahead" or "fell behind": most of the labels' timed notes in those bars
  sit that way.
- A sentence naming no run: the labels' reading names none either.

**Verdict true: 46 of 72 (63.89%).**

| | violin | viola | cello | bass | alto sax |
|---|---|---|---|---|---|
| true | 24 / 34 | 11 / 13 | 6 / 11 | 3 / 3 | 2 / 11 |

### A fix this found: two tempo marks heading a page

URMP's scores were converted from MIDI. Some state two tempos at the downbeat
of bar 1:
- "He's a Pirate": ♩=100, then ♩=200;
- Vivaldi's "Spring": 100, then 120;
- "Rejouissance": 100, then 96.

The importer took the first as the piece's tempo and the second as a change at
bar 1. The page therefore asked for twice the tempo the player set, from the
first note to the last. In the eight Pirates takes, no bar tempo agreed with
the labels. `ocr/musicxml.py` now reads every mark in the first bar as the
piece's tempo, with the last one in force. A mark in a later bar is still a
change.

| real, 72 tracks | before | after |
|---|---|---|
| bar tempo | 2,432 / 3,694 (65.84%) | 2,683 / 4,017 (66.79%) |
| verdict true | 46 (63.89%) | 48 (66.67%) |
| heard | 14,378 | 14,393 |
| placed ≤ 50 ms / paired ≤ 100 ms | 11,727 / 13,495 | 11,730 / 13,500 |
| colour as the oracle's | 10,305 | 10,285 |

The Pirates bar tempi went from 0 to between 23 and 40 bars each. Verdict
true went from false to true for three Pirates takes, and from true to false
for one (`24_Pirates/3_va`). The synthetic benchmark builds its pages without
MusicXML and is unchanged. The six fixtures are unchanged.

### What the false verdicts are, after the fix (24 of 72)

By instrument: violin 8, viola 3, cello 4, alto saxophone 9. Examined so far:

- **Placement noise on a short bar.** "Bar 26 went at 135." where the labels
  put that bar of "The Entertainer" (saxophone) at 143. The notes of a 0.8 s
  bar were placed +29, −54, +37, −13 and +39 ms from their labels.
- **A sound read as a note where none began.** In the saxophone part of
  "Jerusalem", a click or breath in the silence after a note was taken as an
  attack, and the next note's soft entry was not heard. The end of the last
  note was taken as an attack too, and that note was paired with it 3.8 s
  late.
- **A pairing that slides by one note.** In the cello part of "Spring", six
  notes were each paired with the attack before them, about 620 ms early.
- **The note rule after a different re-anchor.** "Bars 30–50 fell behind."
  where the labels' reading has "Bars 45–76 ran ahead." (`32_Fugue/3_va`), and
  the same flip in `22_Rejouissance/1_sax`. This is the open re-anchor
  question.
- **K515's cello part is refused.**

None of these is fixed here.

## 2026-11-14 (saxophone) — The alto saxophone, measured on real recordings. No thresholds changed.

`tools/eval/real_takes.py` now reads URMP's eleven saxophone tracks as well
(1,911 notes). URMP does not name the saxophone, but the tracks sound between
MIDI 50 and 81, an alto's range. `urmp_scores.py` writes them a major sixth
up, where an alto player reads them.

| alto saxophone, 11 tracks | |
|---|---|
| heard | 98.79% |
| placed ≤ 50 ms | 48.43% |
| paired ≤ 100 ms | 90.26% |
| colour as the oracle's | 56.41% |
| bar tempo | 60.39% |
| verdicts right | 5 of 11 |

**Placed ≤ 50 ms reads low for a reason that is mostly not the app.** Several
takes sit at a steady offset from their labels. `22_Rejouissance` has a median
of +59.6 ms with a MAD of 5.5 ms, so its attacks and its labels mark
consistently different moments of the same note. That offset reaches none of
the feedback, which is relative. Within takes, 39–94% of notes lie within
50 ms of their take's own median.

**What is the app's:** `16_Surprise/3_sax` pairs notes with attacks 100–200 ms
before the note sounds. In the near-silence before a soft entry, a key click
or a breath rose 7 dB from the room, and the onset envelope scored it at 46%
of the take's peak. The note itself swelled 30 dB over 100 ms and scored 0.17
at most. Log-spectral flux reads a small rise from silence as a large one.

**A gate was tried and not kept.** It dropped first-pass attacks whose sound
over the next 100 ms sits less than N dB above the take's floor.

| gate | heard | placed | paired | colour | verdicts | attacks at no note |
|---|---|---|---|---|---|---|
| none | 95.63% | 81.56% | 93.86% | 71.67% | 55 of 72 | 2,662 |
| 3 dB | 95.14% | 81.82% | 94.09% | 72.35% | 56 of 72 | 2,326 |
| 6 dB | 91.33% | 81.21% | 93.15% | 69.84% | 55 of 72 | 2,331 |

At 3 dB it removes 336 false attacks but loses about 70 real notes. The floor
is the take's quietest 5%, which in a piece without rests lies inside the
music: 1,525 attacks at labelled notes sound only 3–10 dB above it. A gate
needs a floor that is the room's, not the music's quietest moment, and that is
not this one.

## 2026-11-14 (last) — The re-anchor floor, measured for the owner. No thresholds changed.

The pulse re-anchors after a run of intervals that departs from the take's
habit by more than `[tolerance.pulse] disturbance_floor_beats` (or six robust
deviations, whichever is larger). On real playing with rubato that threshold
is where the app and the oracle most often part company. Measured with
`--set tolerance.disturbance_floor_beats=…`, nothing else changed:

| floor | real: colour as the oracle's | real: verdicts | synthetic overall | synthetic verdicts |
|---|---|---|---|---|
| **0.1667 (now)** | **73.97%** | **50 of 61** | **97.20%** | **180 of 180** |
| 0.25 | 74.97% | 50 of 61 | 97.27% | 176 of 180 |
| 0.5 | 80.87% | 50 of 61 | 97.51% | 175 of 180 |

At half a beat, the colours on real takes agree with a perfect reading's
seven points more often, and per-note timing on synthesis improves. But a
hesitation under half a beat no longer resets the beat, so the notes after it
read as late, and five synthetic verdicts go wrong.

That is the trade the 2026-09 rule was written to settle ("hesitating is a
*step*… reporting it as 'every bar after this one dragged' is false"), and
real phrasing sits close to its line. Which way to move it is the owner's
call. The numbers above are for that decision; nothing is changed here.

## 2026-11-14 (later) — The legato look's own level floor: new `[onset.recovery] pitch_min_level_db = 3.0`

**Old value:** a note found by its pitch had to sound `min_level_db` (10 dB)
above the take's floor, the attack look's guard. **New value:** 3 dB. The
attack look keeps 10.

**Why.** On `12_Spring/1_vn` the legato look found 35 notes where their pitch
took over, and 14 of them were dropped as too quiet. The floor is the take's
quietest 5% of frames, and in a piece played without rests that lies inside
the music. Across all 61 takes, the 565 candidates by level above the floor
(duplicates of an attack already there left out):

| above the floor | candidates | at a labelled onset (60 ms) |
|---|---|---|
| 0–3 dB | 10 | 20.0% |
| 3–6 dB | 22 | 95.5% |
| 6–10 dB | 50 | 86.0% |
| 10–20 dB | 288 | 87.2% |
| 20 dB and more | 155 | 89.0% |

Between 3 and 10 dB they are as often real as the louder ones, and below 3 dB
mostly not. The 10 dB guard was set for the attack look, where it keeps out a
flux wiggle in room tone. A pitch held at the written note for 45 ms is
already evidence that the note was played, so the floor only has to keep out
the room.

### Real takes (all 61 tracks, against the labels)

| | before | after |
|---|---|---|
| heard | 12,450 (94.80%) | 12,499 (95.17%) |
| placed ≤ 50 ms | 10,770 | 10,817 |
| paired ≤ 100 ms | 11,747 | 11,799 |
| bar tempo | 2,181 (66.39%) | 2,185 (66.51%) |
| colour as the oracle's | 9,244 | 9,245 |
| oracle: notes, 12 ms / bars / verdict | 2,033 / 462 / 51 | 2,069 / 476 / 50 |

- No take hears, places or pairs fewer notes.
- One verdict went from right to wrong, `32_Fugue/3_va`: "Bars 30–50 fell
  behind" against the oracle's "Bars 45–76 ran ahead". The pulse re-anchored
  elsewhere; see the re-anchor entry below.

### Synthetic benchmark (180 takes)

97.20% → 97.20%, and no take changed.

### Regression across the six fixtures

All six are identical to the committed code.

## 2026-11-14 — The note chain pairs a held note at its first attack: new `alignment.HELD_NOTE_SPAN = 1.25`

**Old behaviour:** `alignment.align_chain` kept the pairing `_chain_path` chose.
Where several attacks matched a note's pitch, each choice cost the same, and
the walk back from the end paired the *last* of them. **New:**
`_first_attacks` moves each pairing back along the unbroken run of attacks
before it that are heard at the note's pitch, and stops at the first of them.
It goes no further than the previous pairing and no further than
`HELD_NOTE_SPAN` of the note's written length at the take's pace. It does not
move where the note before has the same pitch. It runs after both of the
chain's passes, so the second pass reads the take's pace from where the notes
began.

**Why.** On the real URMP takes the cello was the weakest instrument by far,
and four cello parts held most of the gross errors. Jupiter's cello had 49 of
54 notes paired more than 100 ms from their label, and the app reported the
take as read. The player holds each note and swells it or changes bow inside
it, so each note carries two to four attacks at its own pitch: 126 attacks
for 54 notes. A note begins at its first attack at its pitch.

**Two narrower versions were measured first.**
- *Breaking `_chain_path`'s tie toward the earlier attack.* It gained nearly
  as much, but it also took a passage played again at its first playing,
  which hides the replay that `analysis._replay_break` looks for.
  `test_the_last_bars_played_again_are_read_as_played_again` failed.
- *Moving back without the repeated-pitch condition.* That cost the violin
  parts more than it gained: 89.68 → 89.45% placed. On a repeated pitch, the
  earlier attack is often the note before, bowed again.

### Real takes (all 61 tracks, against the labels)

| | before | after |
|---|---|---|
| placed ≤ 50 ms | 10,647 (85.51%) | 10,770 (86.51%) |
| paired ≤ 100 ms | 11,598 (93.15%) | 11,747 (94.35%) |
| bar tempo | 2,116 (64.41%) | 2,181 (66.39%) |
| colour as the oracle's | 9,317 (74.83%) | 9,244 (74.25%) |
| oracle: notes, 12 ms / bars / verdict | 1,998 / 452 / 49 | 2,033 / 462 / 51 |

| | placed | paired | bar tempo |
|---|---|---|---|
| violin | 89.68 → 90.09% | 95.34 → 95.79% | 70.11 → 71.72% |
| viola | 84.64 → 84.90% | 95.09 → 95.53% | 67.09 → 67.56% |
| cello | 70.67 → 75.13% | 81.29 → 86.69% | 38.26 → 43.96% |
| double bass | unchanged | unchanged | unchanged |

- Jupiter's cello part now places 33 of 54 notes within 50 ms (was 4), and
  colours 52 as the oracle does (was 41).
- Three takes place fewer notes, by one to three each.
- Two verdicts went from wrong to right, both K515 parts.

**Colour fell while placement rose.** It fell by 34 on `32_Fugue/4_vc`, whose
placement went 108 → 125, and by 20 on `36_Rondeau/4_vc`, whose placement
went 79 → 95. A take paired differently re-anchors its pulse at different
notes, and every later note's colour moves with each re-anchor. That is the
open re-anchor question below, not this change.

### Synthetic benchmark (180 takes)

97.18% → 97.20%. `double_bass/bowed/84/drag/noise/1132` gained two notes and a
bar. Two other bass takes changed only in how far off notes that were already
wrong are.

### Regression across the six fixtures

All six are identical to the committed code.

## 2026-11-13 (real recordings) — Slurred notes found by their pitch: new `[onset.recovery] pitch_hold_ms = 45.0`, `pitch_tolerance_st = 0.6`, `pitch_lag_ms = 16.0`

**The first measurement against real recordings.** Every number above this
entry, back to July, came from synthesis or click tracks. URMP's 61 string
tracks — 34 violin, 13 viola, 11 cello, 3 double bass, each part recorded
alone by a student player, with the score it was played from and a
hand-checked onset and pitch for every note — are now read by
`tools/eval/real_takes.py`, which scores each reading against the app's own
rules applied to the labels (as `accuracy_bench.py` does) and against the
labels directly.

**Old values:** none; the three keys are new. They belong to a new part of the
second look, the *legato look* (`onset_recovery.recover_by_pitch`,
`analysis._recover_legato`). A missed note whose pitch differs from both
written neighbours is looked for where its pitch takes over: after the note
before it, and before both the next paired note and the next written note's
place. It is kept if the pitch holds for `pitch_hold_ms` within
`pitch_tolerance_st`. It is then moved `pitch_lag_ms` later, onto the
attack's clock, and must pass the attack look's two level guards. The attack
look itself is unchanged.

**Why.** Before this, 683 of the 12,780 notes played in the analysed takes
(5.3%) were reported missing. Three in four had no attack within 110 ms of
their label, and five in six were a new pitch. These are notes changed under
one bow, which no envelope threshold finds.

The hold, swept on the labels directly (7,023 notes whose pitch differs from
both neighbours; "false" is a pitch that was never played, between two that
were, found anyway):

| hold | found | vs label (median) | within 50 ms | false |
|---|---|---|---|---|
| 35 ms | 96.3% | +0.4 ms | 90.6% | 1.8% |
| **46 ms** | **95.4%** | **+0.4 ms** | **90.8%** | **1.2%** |
| 70 ms | 93.5% | +0.4 ms | 91.4% | 0.6% |

**The lag.** On 5,748 notes found both ways, attacks land a median 16.5 ms
after the label (MAD 15.1) and pitch takeovers 0.3 ms after it (MAD 17.1).
The attack-minus-takeover median varies by instrument: violin 7, cello 16,
viola 19 and bass 28 ms. One value for all of them is a few milliseconds off
for each, well inside either method's own scatter.

### Real takes, before → after (all 61 tracks, against the labels)

| | heard | placed ≤ 50 ms | paired ≤ 100 ms | colour as the oracle's | bar tempo |
|---|---|---|---|---|---|
| before | 92.11% | 85.29% | 92.88% | 75.01% | 63.50% |
| **after** | **94.81%** | **85.51%** | **93.15%** | **74.83%** | **64.41%** |
| violin | 94.71 → 97.72% | 89.27 → 89.68% | 95.04 → 95.34% | 78.58 → 78.13% | 68.75 → 70.11% |
| viola | 93.86 → 95.75% | 84.66 → 84.64% | 94.89 → 95.09% | 71.59 → 72.18% | 66.86 → 67.09% |
| cello | 80.28 → 83.37% | 70.66 → 70.67% | 80.89 → 81.29% | 62.15 → 61.96% | 37.42 → 38.26% |
| double bass | 99.50 → 100.00% | 87.28 → 87.34% | 97.01 → 97.02% | 95.26 → 95.29% | 89.73% |

- Notes reported missing in the analysed takes fell from 683 to 329 (5.3% →
  2.6%).
- The other columns are shares of a larger base after. 330 more notes are
  placed within 50 ms, and 243 more are coloured as the oracle colours them.
- No take hears, pairs or places fewer notes than it did.
- Five give fewer notes the oracle's colour. Two lose one note each. The
  Rondeau's second violin part, which appears in three of URMP's pieces,
  loses 22 in each (201 → 179). That loss is the re-anchor below.

Against the oracle, as the synthetic benchmark scores, from status 60 of 61:

| metric | before | after |
|---|---|---|
| missed | 92.11% | 94.81% |
| verdict | 81.97% | 80.33% |
| notes, 12 ms | 14.54% | 15.21% |
| bars | 12.23% | 12.71% |
| wrong notes | 19.35% | 19.35% |

- One verdict went from right to wrong: `44_K515/1_vn`, a four-minute part.
  With 94 more of its notes heard, the run of drift it names moved to other
  bars.
- At 12 ms the notes and bars rows measure the labels' own scatter more than
  the reading.

### Synthetic benchmark (180 takes)

97.18% → 97.18%. Two takes changed, both with notes left out:
- `cello/bowed/132/missed/reverb/1118` is right now: note 9 is found by its
  pitch.
- `double_bass/pizz/60/missed/dynamics/1179` has one more mistake. Its pairing
  was already a note out. The legato look found note 18 late, because the
  pitch track read the pluck's first frames an octave low, and the late note
  went to the next one.

### Regression across the six fixtures

All six are identical to the committed code: status, quality, missed, extra,
verdict and every per-note deviation.

### Tried, measured and withdrawn the same day

- **A guard against vibrato peaks in held notes.** When a note is left out,
  the attack look takes a vibrato peak in the note before it. The guard
  dropped an attack whose pitch was the same either side of it and was not
  the missed note's. That cured it on the slurred line in
  `test_legato_notes.py`. On `test_degraded_audio`'s room-swallowed take it
  threw away genuine quiet notes: one more was missed with the single-line
  prediction, and with the local one below the take was refused outright. In
  a live room a quiet note under a loud note's tail has the tail's pitch on
  both sides, as the pitch track hears it, so the guard dropped exactly the
  notes the attack look exists to find. Telling the two apart
  needs more than the loudest pitch. The case is held as a strict xfail.
- **Predicting a missed note from the pace around it.** The attack look
  fits one line through the whole take, and on a long take with rubato that
  line is up to two seconds from the player. A line through the four paired
  notes on either side follows the player instead. It found 13 more notes but
  placed 53 fewer within 50 ms, cost five benchmark items, and broke
  `24_Pirates/3_va` in both copies (placed 79 → 38 and 76 → 45). Centred on
  where a left-out note belongs, the search finds a vibrato peak there. The
  single line's inaccuracy had been protecting against that by accident.

### What this does not fix

- **The re-anchor rule on a player with rubato.** Per-note colours agree
  with the oracle's:
  - 90.6% on the 10 takes where neither the app nor the oracle re-anchors;
  - 74.2% on the 50 where either does.

  The two re-anchor at different notes, and every note up to the next
  re-anchor moves with each one: the app 24 times against the oracle's 11 on
  one viola take, never against twice on a violin take. This is not mainly
  the detector's scatter, since the oracle's own spread is 15–59 ms, much
  like the app's. Real players' timing sits that close to the threshold. What
  a re-anchor should mean for a player who shapes every phrase is the owner's
  call, not a threshold.
- **The cello.** It is the weakest instrument on every measure, and one take
  is refused: `44_K515/5_vc`, 3.6 minutes and 360 notes. Its first pass hears
  56% of the notes, and it drifts ±1.5 s from any single tempo.
- **The 329 notes still reported missing.** About a third are the same pitch
  as the note before, so neither an attack nor a pitch change marks them.
  About a third have an attack within 50 ms that the pairing gave elsewhere.

## 2026-11-13 (after the pulse) — The double bass's vibrato filter: new `[onset.instrument.double_bass] vibrato_bands = 5`

**Old value:** every instrument compared each band above 600 Hz with the
loudest of 3 neighbours (`[onset.envelope] vibrato_bands = 3`). **New value:**
the double bass with 5; every other instrument unchanged. `InstrumentOnset`
gains `vibrato_bands`, 0 meaning the envelope's own, and
`audio.envelope_config` resolves it for both the first pass and the second
look (`Heard` now carries the instrument it was heard as).

**Why.** Bowed bass was the weakest instrument on the accuracy benchmark
(92.1%) and carried 60 of its 69 attacks at no note, almost all vibrato in
noise. How many neighbours a vibrato needs depends on how close an
instrument's partials are: a violin's are hundreds of hertz apart and three
bands hold each one's swing, a bass's are 41–150 Hz apart and above 600 Hz its
swing reaches further.

| `vibrato_bands` | bass bowed | bass plucked | overall | attacks at no note |
|---|---|---|---|---|
| 3 everywhere (before) | 92.12% | 98.17% | 97.06% | 69 |
| 5 everywhere | 92.87% | 98.17% | 96.72% | 53 |
| 7 everywhere | 92.70% | 98.17% | 96.62% | 49 |
| **5 for the bass only** | **92.87%** | **98.17%** | **97.18%** | **55** |

Plucked bass has no vibrato and reads the same at every width. Given to every
instrument, 5 bands cost violin bowed 98.43 → 97.51%, cello 95.68 → 94.70%,
viola 98.65 → 98.31% and violin plucked 99.20 → 98.64%: the wider maximum
starts to hide their steps to the next note. Verdicts now read 100% (180 of
180).

### Regression across the six fixtures

All six are bass takes, and all six are identical with and without it —
status, quality, missed, extra, verdict and every per-note deviation. The
bass tests that pinned what a wider filter costs (`test_varied_rhythm`'s note
played over a sounding one, `test_degraded_audio`'s rooms and quiet notes,
`test_bass_onsets`) pass unchanged.

## 2026-11-13 (last) — The pulse re-anchors only where the player moved. No thresholds changed.

`alignment.pulse_anchors` re-anchors after a run of disturbed intervals so
that a hesitation is named where it happened and not blamed on every bar
after it. **A sound paired with the wrong note is a run too** — out and back
— and re-anchoring after it reset the drift the take was measuring: on the
accuracy benchmark's worst take, a bowed bass played a steady 10% fast, a
sixteenth the detector did not hear restarted the ramp twice, and from each
restart to the end every note read hundreds of milliseconds off what it had
been played at (44 wrong readings in one take).

**The rule now** (`alignment._level_moved`): the line the stretch was on —
level and Theil–Sen pace, from up to `PACE_NOTES` usable notes before the run
— is carried across it, and the first `LEVEL_NOTES` notes after it are
compared with where that line puts them. Within `limit`, the disturbance's own
threshold, the reference stays; past it, it re-anchors exactly as before.
Fewer than `MIN_LEVEL_NOTES` on either side and it re-anchors as before. The
`limit` is the existing `[tolerance.pulse]` one; nothing new is tuned.

Accuracy benchmark, quick set: 96.80% → 97.06%; notes within 12 ms
95.01 → 95.50%, bars 94.31 → 94.86%; rushed takes 96.87 → 97.37%, takes with
notes left out 93.74 → 94.73%, steady 99.37 → 99.50%; nothing worse. On the
worst take it removes the second reset and not the first: there the pairing
around the unheard note genuinely shifts the notes after it, which is a
pairing fault and still open.

### Regression across the six fixtures

Identical — status, quality, missed, extra, verdict and every per-note
deviation — on all six: none has a run that leaves the line.

## 2026-11-13 (later still) — Pairing: an interval may be read across one note left out, `alignment.DROPPED_NOTE_CAPS = 3.0`

**Old value:** none. `align_dtw`'s cost compared the interval into each
detection with the written interval into one note, except across optional
notes (ornaments, unheard slurred notes). **New value:** any interval may also
be compared with the two written gaps across one note, at 3 position caps more
— the price of a step off the diagonal (`STEP_PENALTY_CAPS`). A module
constant beside `POSITION_CAP_GAPS` and `STEP_PENALTY_CAPS`, as they are.

**Why.** With detection hearing 99.8% of played notes, the worst way of
playing on the accuracy benchmark was leaving notes out (89.9%), and the worst
single take was a steady plucked bass page with two notes left out a beat
apart, every note heard, refused at quality 0.000. After a note not played, the
true interval spans two written gaps; compared with one, the correct pairing
paid a whole interval at the note after the hole, so sliding every later note
one place along was cheaper — five notes paired one off, and the take refused.

| `DROPPED_NOTE_CAPS` | overall | notes left out | rushed | analysed |
|---|---|---|---|---|
| none (before) | 96.16% | 89.91% | 96.87% | 99.44% |
| 0.5 | 96.61% | 94.03% | 95.43% | 100% |
| 1, 2 | 96.57%, 96.56% | 93.78%, 93.74% | 95.43% | 100% |
| **3** | **96.80%** | **93.74%** | **96.87%** | **100%** |
| 4 | 96.76% | 93.53% | 96.87% | 100% |

Below 3 a rushed cello take with one false attack mid-note paired four notes
one place along — the false attack taken for a note and a real one dropped
later to catch up, because a cheap dropped interval made that slide cheap —
and 36 of its readings went wrong where one had.

**Timing alone, on one page.** The refused take's page with every pair of its
inner notes left out in turn, 276 takes, onsets exact but for 3 ms of jitter
(`test_notes_left_out.py`): the old pairing refused 11 and attributed 467
sounds to the wrong note; 3 caps refuse none and attribute 313.

**Two neighbours measured and rejected.**

- *An interval read across one detection*, for an attack that was no note, at
  0.5 caps: no gain on the benchmark beside the dropped interval (96.78%), and
  on the 276 takes it refused 39 — it lets any short interval explain itself
  as a long one interrupted.
- *A skipped note's cell charged nothing* (`weights_mul` 0 on the vertical
  step). DTW pays for skipping a note the cell it skips with, which is the
  previous detection's interval against the skipped note's — a number that
  says nothing — and that cell is why the note after a hole is sometimes given
  the hole's place. Free, it read every such case right (169 wrong on the 276,
  96.95% on the benchmark) and broke seven tests, among them the one telling
  détaché against written slurs from a wrong piece and a hurried bar's
  attribution. Kept as a strict xfail in `test_notes_left_out.py` instead.

### Regression across the six fixtures

Identical, clip by clip — status, quality, attacks, missed, extra, verdict, and
the mean and spread of the timed deviations: none of the six has a note left
out.

## 2026-11-13 (later) — Onset placement: the fine spectrum floored 50 dB down, not 80

**Old value:** `audio._REFINE_TOP_DB` did not exist; `refine_onset_times`
floored its 1024-point spectrum at `_TOP_DB`, 80 dB under the segment's
loudest moment. **New value:** 50 dB. A module constant beside the other
four `_REFINE_*` values rather than a `config.toml` key, as they are:
`refine_onset_times` takes no config, and splitting one of five placement
constants into the file would leave the other four looking like the
untunable ones.

**Why.** With the envelope no longer hearing notes that were not there (the
entry below), the largest share of what the accuracy benchmark still got
wrong was notes placed 13–30 ms from where the truth put them: 181 of 670
wrong items. The detection was right; *where on the attack* it was placed
depended on what came before the note. Floored 80 dB down, a note rising out
of silence climbs from the floor and reaches half its flux peak early in the
attack; a note rising out of the last one's release — a run of sixteenths,
5–15 ms of bow change between strokes — climbs from a level the 46 ms window
still holds, and is placed later. Bowed notes after gaps of 5 ms to 300 ms,
25–50 ms rises, three of each:

| floor | 5 ms | 14 ms | 30 ms | 50 ms | 100 ms | 300 ms | 5 vs 120 ms attack |
|---|---|---|---|---|---|---|---|
| 80 dB | 58.5 | 55.5 | 48.4 | 42.2 | 42.3 | 42.2 | 12.6 ms apart |
| 60 dB | 58.5 | 55.0 | 48.7 | 47.4 | 46.9 | 47.0 | 13.1 |
| **50 dB** | **58.3** | **55.4** | **52.1** | **51.1** | **51.9** | **52.0** | **16.9** |
| 45 dB | 59.3 | 56.3 | 53.2 | 53.4 | 53.5 | 53.3 | 20.1 |
| 40 dB | 59.3 | 56.3 | 55.3 | 55.0 | 54.9 | 55.1 | 24.9 |
| 30 dB | 60.1 | 59.2 | 59.2 | 59.2 | 58.8 | 59.1 | 33.4 |

Milliseconds late, mean of each column. A 16 ms spread with the gap is a run
of sixteenths read as dragging against the quarters beside it — on every
take, from the detector rather than the player. The shallower the floor, the
less the gap matters and the more the stroke does, because the half-peak was
what made a 120 ms bow start and a 5 ms one land close together
(`test_onset_placement.py` holds them under 20 ms). 50 dB is the floor that
halves the first (16 → 7 ms) and keeps the second inside its limit; 45 dB
crossed it.

Accuracy benchmark, quick set: 95.44% → 96.16% (notes within 12 ms
93.12 → 94.43%, bars 92.01 → 93.40%; p95 timing error 13.8 → 11.6 ms).
30 dB scored 96.68% and is rejected for the stroke.

### Regression across the six fixtures

Readings unchanged — status, quality, attacks, missed, extra and verdict on
all six — and the mean timed deviation moves by at most 0.6 ms
(`01_detache_clean` −0.4 → −1.0 ms, `04_slurred` +0.5 → −0.1, `06_pizzicato`
−0.5 → −1.0; the rushing and dragging clips by 0.1).

### One test re-based

`test_degraded_audio.py`'s lag-and-jitter test asserted the degraded take
lags the clean one by at least 10 ms. It now lags by 5.1 (55.8 against 50.7;
was 43.5 clean): the clean take's notes, rising from silence, are no longer
placed early on their climb. The room still delays the attack, which is
asserted; the jitter that survives the offset fit is unchanged at 0.97 and
2.52 ms.

## 2026-11-13 — The onset envelope: new `[onset.envelope]`, and `[onset.recovery] max_fall_db = 12.0`

**Old values:** none. Every frame of the onset envelope was compared band by
band with the frame before, as `librosa.onset.onset_strength` does, and the
second look took any interior maximum loud enough above the room.
**New values**, all new keys, none changed:

- `[onset.envelope] floor_percentile = 10.0`, `floor_margin_db = 6.0` — each
  mel band is held at its own 10th percentile across the take plus 6 dB
  (`audio._band_floor`).
- `[onset.envelope] vibrato_from_hz = 600.0`, `vibrato_bands = 3` — above
  600 Hz a band is compared with the loudest of three neighbouring bands a
  frame earlier, SuperFlux's maximum filter (Böck & Widmer, DAFx 2013;
  `audio._vibrato_bands`).
- `[onset.recovery] max_fall_db = 12.0` — a recovered note may not sit where
  the level falls by more than this (`audio.level_change_db`).
- Not a threshold, but a decision: a take refused with the vibrato filter is
  read once more without it, and the second reading is kept only if it is not
  refused too (`analysis.analyze`).

**Measured on the new accuracy benchmark** (`tools/eval/accuracy_bench.py`,
the quick set of 180 synthesised takes: four instruments, bowed and plucked,
six ways of playing, five rooms). Synthesis, not recordings — see its
docstring — so these say the detector now hears these models correctly, not
that it hears a phone in a practice room correctly.

| | before | after |
|---|---|---|
| analysed at all | 97.78% | 99.44% |
| each note timed within 12 ms of the truth | 81.94% | 93.12% |
| left-out notes reported, played notes not | 96.84% | 98.56% |
| each bar's average and tempo | 77.78% | 92.01% |
| the verdict's direction and bars | 89.44% | 98.33% |
| wrong notes named, and nothing else | 62.07% | 68.97% |
| **overall** | **88.28%** | **95.44%** |
| room: 20 dB of noise | 74.36% | 96.16% |
| room: a phone (reverb, 25 dB noise, clipping, dynamics) | 82.93% | 94.56% |
| violin, bowed with 10–24 cents of vibrato | 86.12% | 97.23% |
| double bass, plucked | 78.67% | 94.98% |
| double bass, bowed | 82.17% | 89.14% |
| violin, plucked | 99.24% | 99.00% |

p95 timing error against the truth fell from 456 ms to 14 ms: the long tail
was notes paired with the wrong attack, because there were attacks that were
not notes.

### Why each

**The floor.** Log-spectral flux is level-blind by design, and the room's
noise flickers a few decibels in every band, every frame. A band the
instrument never reaches contributes that flicker and nothing else: on a
plucked bass take at 20 dB SNR the bands above 2 kHz flickered as much
between the notes as at them (mean flux 0.76 at the attacks, 0.75 elsewhere),
and the take was heard as 101 attacks for 32 notes. Swept: the 5th, 10th and
20th percentiles land within 0.2 points of each other (95.42, 95.44, 95.56%);
a 3 dB margin lets the flicker through (94.29%), 6 and 10 dB do not.

**The filter.** Vibrato swings every partial a quarter of a semitone each way
five or six times a second, and each swing is a rise in the band it swings
into. With noise on top, a violin take was heard as 62 attacks for 35 notes.
Below 1 kHz the mel bands are 26 Hz apart, more than a semitone under 450 Hz,
and three of them hide the step to the next note. Applied to every band, on
its own, the filter cost three notes in four on a double bass line in a
2-second room — the floor wins those back — and, floor or not, the note played
over a sounding one in `test_varied_rhythm`. With the floor, starting at
400 Hz or below still lost that note, and from 500 Hz it was kept. 600 is
chosen for the margin: 95.44% against 95.68% from 500, inside what this
benchmark can tell apart, and 94.87% from 1000.

**The retry, and the cost it pays back.** A quiet bass note under a loud one's
tail looks to the filter like the loud note's partials moving. On
`test_degraded_audio`'s page with every other note 20 dB down in a 0.9-second
room, the first pass now finds 12 of 24 notes where it found 16, and at 45%
wet the take was refused. A starting frequency for the bass alone could not
fix it: the bass's vibrato gain is all below 1.5 kHz (89.1% bowed from 600 Hz,
83.6% from 1500, 82.5% from 3000) and the room take needs 2.5 kHz or more. Up
to 16 dB of alternating dynamics, with and without the filter read that page
identically; only at 20 dB does it cost — one note missed at 30% wet, and the
refusal at 45%, which without the filter reads at quality 0.97 with nothing
missed. So the refusal is retried. Two other routes were measured and
rejected: the second look reading the unfiltered envelope (95.51%, and the
refused take stays refused — its first alignment is too broken to predict
from), and requiring a rise to last 90 ms instead of filtering (87.09%).

**The fall.** With the bands held at their floors, the envelope between notes
is flat, and the little spray of a note's release is left standing alone: a
page with bars 1–4 played twice had a note recovered off the end of its last
note, 1.6% of the envelope peak and 42 dB above the room, where the level fell
by 29 dB. Every note the second look recovers on the room takes sits between
−8.6 and +2.5 dB; the two releases fell 29 and 30 dB.

### Regression across the six fixtures

Unchanged, clip by clip — status, quality, attacks heard, notes missed and
extra, and the verdict:

| clip | before and after |
|---|---|
| `01_detache_clean` | ok, 0.999, 32 heard, 0 missed, 0 extra, "Steady all the way through." |
| `02_detache_rushing` | ok, 0.999, 32, 0, 0, "Bars 2–8 ran ahead." |
| `03_detache_dragging` | ok, 0.999, 32, 0, 0, "Bars 2–8 fell behind." |
| `04_slurred` | ok, 0.998, 8, 0, 0, "Steady all the way through." |
| `05_open_e_long` | ok, 1.000, 1, 0, 0, "Steady all the way through." |
| `06_pizzicato` | ok, 0.999, 16, 0, 0, "Steady all the way through." |

All six are still the synthetic stand-ins; none is a recording yet.

### Tests re-based, and why each was right to be

- `test_audio.py`'s envelope-against-librosa check runs with the floor and the
  filter off. With them on the envelope is not librosa's, by design; that the
  floors are as global as the peak is `test_onset_envelope.py`'s, with a
  mutation check that per-block floors fail it.
- `test_degraded_audio.py`: the room take the second look exists for moved
  from 45% wet to 50%, because the 45% take now reads without it. The
  ceilings on quiet notes lost under reverb came *down*, 0.75 → 0.50 and
  0.60 → 0.50: the first pass got worse there on purpose, and a ceiling left
  above it could not see that, or see it come back.
- `test_note_chain.py`'s loose-timing take moved from seed 0 to seed 1: on
  seed 0 timing alone now pairs 26 attacks as bars 1–3 at 69 BPM at quality
  0.411, a hair over `broken_quality`. The chain reads it, and timing alone
  still refuses the other 11 of the 12 seeds surveyed.

## 2026-10-23 — Intonation: new `[intonation] note_trim_cents = 150.0`

**Old value:** none — `note_cents` read the straight median of every voiced
frame in a note's window. **New value:** `note_trim_cents = 150.0`, a second
pass that drops frames further than 150 cents from the window's own raw
median before re-reading the median on what remains (`MIN_FRAMES = 3` or more
must survive, else the untrimmed reading is kept).

**Why:** a short note's window can still catch a few frames of a bow's
residual noise, the previous note's tail bleeding past `RELEASE_S`, or a YIN
octave slip — those frames don't move the median *value* when they're a
minority of the window, but they can still shift the median's *position* in
the sorted order when combined with an in-between cluster (e.g. the previous
note a semitone off), pulling the reading toward that cluster rather than the
true pitch. `backend/app/tests/test_intonation.py::TestNoteCents::test_a_couple_of_octave_slip_frames_are_trimmed_out`
is the synthetic case: 5 true-pitch frames, 4 a semitone off, 2 a full octave
off — untrimmed reads 100 cents off (the semitone cluster wins the sorted
middle), trimmed reads 0.

150 cents is wide enough that ordinary vibrato (recorded 14–15 cents typical
spread against a take's own tuning, 2026-09-25 entry below) is never touched,
and tight enough to reject a bled-in neighbour a semitone (100 cents) or more
away.

**Not yet regression-tested against the six fixture clips or real
recordings** — this is a change to `intonation.py`, not the onset/tolerance
pipeline those six clips exercise, and there is no recorded-audio corpus for
intonation yet (same gap the 2026-09-25 intonation entry below notes). Covered
by the synthetic unit test above and by the existing intonation suite, which
all still pass; honest status per the batch's own DoD note.

## 2026-09-30 — Saxophone: two new rows, no existing value changed

`[onset.instrument.alto_sax]` and `[onset.instrument.tenor_sax]`, both
`delta = 0.07` and `highpass_hz = 0.0`: exactly the treble path an instrument
without a row already took, so adding them changes no reading, a string take's
included.

**Not tuned, and it cannot be yet.** There is no saxophone recording in
`fixtures/audio/` or anywhere in this repository. A tongued attack is a sharper
onset than a bow change, which is the easy case for a log-flux detector; a slur
under one breath has no onset at all, which the page's slurs already exclude.
Whether 0.07 is right for either is an ear-and-recordings question.

What did change is not a threshold: the analysis now listens for a saxophone
where it sounds (alto −9, tenor −14 semitones from the page) rather than where
it is written. `test_saxophone.py` holds it — with the transposition removed,
an alto playing its page read **+300.9 cents** and a tenor **−199.4**, and a
fingered wrong note went unnamed.

### Regression across the six fixtures

Unchanged by construction: the six are string takes and none of their rows
moved. Full backend suite 2944 passed, 2 skipped, 2 xfailed.

## 2026-09-26 — Player mistakes, new: `[mistakes]`, and 0.3 → 0.2 on the first real take

New thresholds, no existing one changed. `services/player_mistakes.py` names
wrong notes and miscounted rests (DECISIONS, 2026-09-26).

- `wrong_note_max_share = 0.25` — more than this share of paired notes named
  wrong names none: a page read in the wrong key or clef.
- `clear_note_semitones = 0.2` — after the take's own tuning, a note must sit
  within this of a semitone other than the written one. **First written as
  0.3**, from synthetic takes alone; see the owner's takes below.
- `rest_entry_min_beats = 0.75` — an entrance after a rest named when this many
  quarter beats off at the take's own pace. A whole beat late measured 0.98,
  half a beat (phrasing) 0.5.

### Synthetic takes (`test_playing_habits.py`, 8 bars of quarters, violin and bass)

    take                                   named
    clean                                  nothing
    every F♯ played as F                   4 notes, "F" for "F#", in their bars
    one note a minor third high            bar 4
    the tune an octave up                  nothing
    one note 50 cents sharp                nothing
    one note 72 cents sharp                nothing (named at 0.3)
    one note played as the note before     nothing
    every note a tone high                 nothing (over a quarter: wrong key)
    two-bar rest counted right             nothing
    came in 4 beats early                  rest at bar 5, −4 beats, bar of 4
    came in 1 beat late                    rest at bar 5, +1 beat
    came in half a beat late               nothing
    whole take at 2/3 speed, rest in step  nothing
    six clean notes, then a stop           "Only 6 notes. Play a little further to be timed."

### The owner's two real bass takes (Opus, phone microphone, locally)

At 0.3, take 0313 named one note: bar 14, "B where the page has B♭". The
note is the B♭2 of a fast chromatic run with octave leaps (B2 B3 B♭3 B♭2 A2
…), 0.28 semitones from B after the take's +25-cent tuning — 2 cents inside
the threshold — with B♭ still at 0.48 of the chroma, 0.02 under "the written
note sounded too". A B♭ played 72 cents sharp on the shift down is as likely
as a B, and the rule's standard is *clearly*. The owner's typical note sits
14.7–15.7 cents from their tuning (`[intonation]`); 0.2 asks a wrong note to
sit about as close to its semitone as their right notes sit to theirs.

Every note on either take read as a semitone other than the written one, and
what kept it back (dist = semitones from the heard semitone; wrel = the written
class's share of the chroma):

    take  bar  written → heard  dist  wrel  held back by
    0313   3   Eb3 → D          0.05  0.29  the note before/after
    0313  11   Gb3 → G          0.15  0.60  written note sounded too
    0313  11   G4, Gb4          0.18–0.43   between / no chroma reading
    0313  12   F3, Eb3, D4      0.19–0.38   several
    0313  14   Bb2 → B          0.28  0.48  **named at 0.3**; between at 0.2
    0313  14   A3 → Bb          0.44  1.00  several
    0313  18   D3, Db3, C3      0.13–0.40   neighbour / written note sounded
    0313  20   C3 → B           0.20  0.70  neighbour, written note sounded
    0313  25   D3 → C#          0.34  1.00  several
    1940  12   D3 → C#          0.23  0.44  the note before/after
    1940  20   B2 → Bb          0.15  0.55  written note sounded too
    1940  21   E3 → C           0.27  0.34  the two readings disagree

**Listen to these before loosening anything:** 0313 bar 11's G♭3 and 1940 bar
20's B2 read cleanly as the semitone beside them (0.15) and are held back only
by the chroma. 1940 bar 20's is a B♮ in B♭ major — exactly the accidental a
player forgets. They may be real wrong notes this rule is too cautious to name.

Rests: the page has no whole bar of rest — bar 24's three and a half beats
end inside the bar — so there is nothing on either take for the rule to judge,
and a rest shorter than a bar is outside it by design.

### Regression

- Six clips: every verdict identical; none names a wrong note or a rest.
- The owner's takes: verdicts identical ("Bars 13–25 went at 81.", "Bars
  15–24 went at 96."); at 0.2, nothing named.

## 2026-09-25 — Settling in and winding down: `[tolerance] settling_bars = 2`, new

New threshold, no existing one changed. The owner asked whether the app allows
for the time it takes to find the tempo after the count-in, "and same with the
end". It allowed for the silence (the count-in is discarded, timing runs from
the first note, up to three stray sounds are trimmed at each end), not for the
playing: a first bar or two off the tempo was the verdict line.

**Rule** (`classification._Edges`): a run of bars, or of notes, lying wholly
inside the first or last `settling_bars` bars the take played is not named.
The notes of a spared end leave the note rule too, and after a spared entrance
the note rule measures drift from where the take settled. On a short take the
ends shrink so one bar is neither. `settling_bars = 0` is the old behaviour
exactly, which is how the "before" column below was run.

### Synthetic takes (12 bars of quarters, target 100)

    take                           before                    after
    bar 1 at 86                    Bar 1 went at 86.         Steady all the way through.
    bars 1–2 at 86, 93             Bars 1–2 went at 89.      Steady all the way through.
    bars 1–2 at 116, 108           Bars 1–2 went at 112.     Steady all the way through.
    last bar at 84                 Bar 12 went at 84.        Steady all the way through.
    bars 11–12 at 92, 82           Bars 11–12 went at 88.    Steady all the way through.
    settle, then bars 6–7 at 88    Bars 1–2 went at 89.      Bars 6–7 went at 88.
    bars 1–4 at 88                 Bars 1–4 went at 88.      (same)
    bars 6–7 at 88                 Bars 6–7 went at 88.      (same)
    held 97 throughout             Bars 1–12 went at 97.     (same)
    settle, then held 96           —                         Bars 3–12 went at 96.
    settle, then held 92           —                         Bars 1–12 went at 92.

Two intermediate versions were measured and rejected: sparing the bars alone
let the note rule say "Bars 1–12 fell behind." after a slow bar 1, because its
lag is carried into every later note; and sparing the entrance's notes but not
the ending's made an 8-bar take at 100 against 104 that eased off into
"Bars 1–8 went at 96." rather than "Bars 1–6 went at 100."

### Regression

- Six clips: every verdict and direction identical (01, 04, 05, 06 steady;
  02 "Bars 2–8 ran ahead."; 03 "Bars 2–8 fell behind.").
- The owner's takes (Opus, locally): identical — 0313 "Bars 13–25 went at
  81.", 1940 "Bars 15–24 went at 96.", leads unchanged. Neither named run is
  at an end, so no re-run is needed.

## 2026-09-25 — Intonation, new: `[intonation]` and what it was measured on

New thresholds, no existing one changed. `services/intonation.py` reads each
paired note from 60 ms after its attack to 30 ms before the next, as the
median of the YIN track, octave-folded.

**The owner's two real bass takes** (Opus, phone microphone):

    take   tuning vs A440   typical note from tuning   notes kept / paired
    0313   +25.1 cents      15.7 cents                 67 / 88
    1940   -25.7 cents      14.7 cents                 76 / 85

- Per note, before dropping: 61% within ±50 cents of written (octave-folded),
  19% beyond ±100 — the previous note ringing into the window far more than a
  wrong note. Against the take's own tuning, 51% within ±25.
- 68 of 88 notes of 0313 read an octave *below* written: the bass sounding
  where it sounds. Folding is what makes that invisible.
- Bars, 0313: mostly within ±20; bars 17–18 at −50 and −94 (the slow ending);
  bar 2 at +53.

**Thresholds** (`config.toml` `[intonation]`): in tune ≤ 15 cents, slightly
off ≤ 30, a note beyond 100 from the tuning is not that note, at least 8 notes
for a take to say anything, tuning said when ≥ 10 off A = 440.

**Synthetic check** (`test_intonation.py`): a violin line detuned +20 cents,
bar 3 a further −40 — read as tuned +20 (±6), bar 3 at −40 (±10), the others
within ±10.

**Regression:** every existing field of the six fixture clips is unchanged;
they only gain the new ones. The synthesised pitch reads as it was made — in
tune: 01, 02, 03 and 06 tuned +5.4 cents with a spread of 0.0–0.1 (under the
10 cents that would be said); 04 (slurred) and 05 (one long open string) have
too few notes to read, and say nothing about pitch.

## 2026-09-25 — Wording only: the run sentence gives where and the tempo; the lead never repeats it

No threshold changed. The owner found the verdict's top saying one thing three
times. `_run_verdict` now says "Bars 13–25 went at 81." (the run's tempo)
rather than "You dragged bars 13–25 by 23 BPM.", and "ran ahead" / "fell
behind" where there is no tempo to quote; `lead_finding(verdict_names_run=)`
drops tempo and drift under such a sentence.

### Regression

- Six clips: every field identical except two sentences —
  02 "You rushed bars 2–8." → "Bars 2–8 ran ahead.";
  03 "You dragged bars 2–8." → "Bars 2–8 fell behind." No lead on any of them,
  before or after.
- The owner's takes (Opus, locally):

      take   sentence                  lead (was → now)
      0313   Bars 13–25 went at 81.    You slowed down by 15 BPM. → Your half notes lagged.
      1940   Bars 15–24 went at 96.    You played at 98, not 104. → Your half notes ran ahead.

## 2026-09-25 — The verdict line names the bars the chart shows; five notes per bar tempo

**Real take.** Re-run on #149's analysis, the owner's take (de5493f3) drew its
bars in BPM — about 100 through bar 6, 81–93 in bars 7–11, about 78 from bar
18 — under the sentence "You dragged bars 1–12 by 7 BPM." The note rule reads
drift from the target held since the first note, so in a take played slow
every note is behind and the longest run was the stretch before a re-anchor.
The owner chose "match the graph" (asked, 2026-09-25), and asked whether the
chart should be smoothed.

### What changed

- **`MIN_NOTES_FOR_BAR_TEMPO` 3 → 5.** Measured on forty synthetic takes of
  the owner's piece (true tempo known per bar: 102 / 87 / 100 / 80; onset
  jitter 25 ms; one note in twelve unmatched):

      estimator             mean err  p90   bars of 1–2 notes  error at the two steps
      3 points (was)          1.6     3.0        2.2                 1.4
      5 points (now)          0.7     1.6        0.6                 1.9
      6 points                0.7     0.8        1.0                 9.5
      3 points + 3-bar smooth 1.8     5.9        2.7                 2.1

  Six borrows across a real change; smoothing the drawn line is worse than
  nothing. Re-measured at 15 and 40 ms of jitter: five points read 0.4 and
  1.1 against three's 1.3 and 2.0; four sat between (0.6, 1.3) with the
  steps a little sharper (0.8, 1.9 against 1.2, 2.9). The
  first bars, with nothing before them to borrow, now borrow the bars after.
  The owner's take: bar-to-bar jumpiness 8.8 → 5.4 BPM; bar 16 73 → 82, bar
  17 104 → 85 (one note, the spike that split the slow ending in two).

- **`generate_verdict` given `tempi` names the longest run of bars off the
  target in one direction**, each bar banded as the card bands it
  (`(1 − bpm/target) × 100`), bars under a written change or with nothing
  timed left out. At least `MIN_VERDICT_RUN` timed notes; one bar alone only
  when clearly out. The figure is `tempo_across_bars` — the same fit over the
  whole run. With no such run, the note rule speaks as before.

### Regression

- **Six clips: identical, every field.** Their bars are 59.5–60.5 against 60
  — on, bar by bar — so the rushing and dragging clips fall through to the
  note rule and keep "You rushed bars 2–8." / "You dragged bars 2–8."
- **The owner's two takes** (Opus copies, locally):

      take   was                                  now
      0313   You dragged bars 13–21 by 7 BPM.     You dragged bars 13–25 by 23 BPM.
      1940   You dragged bars 1–13 by 5 BPM.      You dragged bars 15–24 by 8 BPM.

  0313 on the server (WAV) read "bars 1–12 by 7"; the lead lines are
  unchanged ("You slowed down by 15 BPM." / "You played at 98, not 104.").

## 2026-09-25 — Each bar's tempo, for charts in BPM; unevenness against the player's own pace

**Real take.** The owner's first working take through the app (Elijah, bass,
104): steady-ish at 90 BPM with two stops. The verdict screen's "Across the
take" sat on its floor from bar 2, bar 22's card said "More than a beat
behind", and the lead line said "Right on average, uneven note to note". All
three read the same number: each note's lateness from where it would fall had
the take held 104 from its first note — 6% of a beat in bar 1, 305% by bar 11,
773% by bar 24. The owner asked for the graph in BPM.

### What changed

- **`insights.tempo_by_bar` → `PerMeasure.played_bpm`.** Each bar is its
  notes plus the next bar's first (downbeat to downbeat); one with fewer than
  three borrows the bar before. The slope is **Theil–Sen** — the median of the
  slopes between every two notes — over pairs whose gap implies a tempo inside
  `alignment.MIN_TEMPO_RATIO`–`MAX_TEMPO_RATIO` of the target, within a
  stretch the page times (a fermata starts a new one). Least squares was tried
  first and read a skip to the last note as 142 BPM, and one stray attack as
  148; splitting at the pulse's own re-anchors cut ordinary gaps and read a
  bar as 43.

      owner's take, bars 1–25 (Theil–Sen):
      104 97 104 102 101 103 | 93 86 81 | 95 102 101 98 97 | 82 – 104 81 95 78 75 88 72 79 79

- **`insights.steadiness`** is detrended per stretch of the pulse
  (`Delta.pulse`, new) against written time. One line through deltas that
  re-anchor at a stop measured the jump: 140% for this take, now 36%. Note
  values are grouped by the same residuals (`detrended`): raw, the half notes
  "lagged" 210% because they come late in the page.
- **`lead_finding`** drops "Right on average, uneven note to note" when a
  tempo difference is itself worth saying. This take now leads "You slowed
  down by 15 BPM." (drift outranks tempo by design); the earlier take (1940)
  "You played at 98, not 104."

### Regression

- Six clips: verdict, per-note, per-measure, trend identical; `played_bpm`
  added (60.0 on the clean clips, 60.4–60.5 rushing, 59.5–59.6 dragging); a
  one-value `by_note_value` now reads 0.0 (against its own pace). Not shown by
  the app.
- The owner's two takes: verdicts unchanged.

## 2026-09-25 — "Not played" is not said of a take the alignment refuses anyway

**Real takes, the second re-run** (#147, on the analysis of #146). 2aac1ba8
lost its false "rushed bars 42–45" and 242082ca its "not played" — it is now
refused for too much sound, which it has (91 attacks for 75 notes). But read
from bar 7, 2aac1ba8's timing paired one note, and `not_tonal` then told it
"Try again closer to your instrument": tonal 0.48, under `played_tonal`, at
quality 0.000. So did four more bass takes the timing could not pair, at
0.59–0.69 — the band the owner's accepted take sits in (0.66).

**Rule 3 (`not_tonal`) now fires only between `broken_quality` and
`warn_quality`**, where the alignment would otherwise give a verdict. That is
the case it was written for: talking fit a page at 0.47 and was given one.
Under 0.4 the alignment refuses the take anyway, and says why.

    take      tonal  quality  was                  now
    2aac1ba8  0.48   0.000    not played           refused by the alignment
    a54ccd57  0.69   0.000    not played           refused by the alignment
    068323bd  0.60   0.000    not played           refused by the alignment
    ae148002  0.59   0.000    not played           refused by the alignment
    b83e75e4  0.62   0.000    not played           refused by the alignment
    talking   0.35   0.47     not played           not played (unchanged)

`no_pitch` (under 0.3 — a metronome, a room) and `one_pitch` are unchanged:
five takes of 0.00–0.27 stay not played, and their audio would say whether
that is right.

### Regression

- `test_nothing_played_on_the_measured_numbers`: every measured case holds;
  three added (two real bass takes, talking fit for a verdict).
- Whole takes: a metronome, a knock and talking are still refused; talking
  on its own at 0.22 was already `alignment_failed`.
- Six clips: untouched (every one is over `warn_quality`).

## 2026-09-25 — The first re-run of real takes: a fragment read from its start, and "not played" asked of the pitch track

**Real takes, fifteen of them.** Every refused take on the owner's account was
run through the analysis of #142–#144 from its Opus playback copy
(`rerun-analyses.yml`). One came back right, one came back wrong, and ten were
told "Try again closer to your instrument" by a rule calibrated on synthetic
takes.

    take      page, tempo              re-run said                           the pitch track
    99aecbad  Elijah, bass 104         ok — dragged bars 1–13 by 5 BPM       79 of 88 notes at pitch
    2aac1ba8  AiP from bar 7, bass 80  ok — "rushed bars 42–45 by 39 BPM"    1 of 11 at pitch
    242082ca  Elijah, bass 116         not played (no_pitch, tonal 0.29)     15 of 59, seven pitches
    3bc2e100  AiP from bar 7, bass 80  not played (no_pitch, tonal 0.14)     7 of 17, three pitches
    a54ccd57  Elijah, bass 104         not played (not_tonal, tonal 0.69)    2 of 5 paired
    068323bd  Elijah, bass 160         not played (not_tonal, tonal 0.60)    1 of 1 paired
    ae148002  Elijah, bass 116         not played (not_tonal, tonal 0.59)    6 of 23
    b83e75e4  AiP from bar 7, "violin" not played (not_tonal, tonal 0.62)    0 of 2
    four more                          not played (no_pitch, tonal 0.0–0.27) 0–1 paired
    three more                         alignment_failed                      —

**The owner's good take holds a pitch after 0.66 of attacks.** `played_tonal`
(0.8) says instruments hold one after 0.87 or more, which was true of every
synthetic take and is not true of a double bass on a phone. So `not_tonal` —
"less steady than an instrument, and a poor fit" — describes a real bass take
the timing cannot read, and it cannot be moved: talking measured 0.23–0.77.
**Unchanged here, and the known limit below.**

**Not a codec artefact.** Three synthetic tunes, violin and bass, written as a
48 kHz WAV and through `take_archive.to_opus` (61 kbps): the same status,
quality, tonal share and page share either way, to the third decimal.

### What changed

- **`alignment.PREFIX_START_BEATS` (new, 2.0).** A take matched as a stretch of
  its page begins on a written note within two beats of the page's first, or
  on either of the first two. 2aac1ba8 was placed at bars 42–45 at 0.931 by
  rhythm alone; from its start at bar 7 it scores 0.000 and is refused. Replayed
  from its stored onsets, with the score trimmed to bar 7 as the worker does:

      take      before (placed at)   now
      2aac1ba8  0.931 (bars 42–48)   0.000 (from bar 7)
      3bc2e100  0.739 (bars 20–22)   0.000 (from bar 7)
      5d6011ba, 44975f56, b83e75e4   0.000 either way

  Where else a take begins is pitch's to say (`align_chain` with `passage`,
  `_placed_by_pitch`), which is unchanged.
- **`analysis._heard_by_pitch` (new).** A pairing with notes at their exact
  written pitch beyond chance (`[pitch]` `chance` 0.15, `significance` 0.05,
  the numbers `why_not_played` already holds the chroma to) on at least
  `confirmed_min_pitches` (3) pitches is somebody playing: `why_not_played` is
  not asked. It decides which refusal, never whether. 242082ca (15 of 59) and
  3bc2e100 (7 of 17) pass it; 9 of 59, 2 of 5, and 12 of 16 on one or two
  pitches do not.

### Regression

- Six clips: byte-identical against `main`.
- The twenty habits and the replay sweep: identical output.
- Wrong takes (`chain_refuse`, 9 kinds × 6 seeds): none newly given a verdict;
  one refused that was not (the page shuffled, seed 0 — "ok" by timing with 0
  of 26 notes at pitch); two keep their timing verdict with another pairing.
  The passage sweep calls `align_chain`, which this does not touch.
- The owner's take: unchanged ("You dragged bars 1–13 by 5 BPM").
- Pinned: `test_timing_reads_a_short_take_from_where_the_page_begins` (on
  `main` the take is placed at note 19, quality 1.000),
  `test_the_page_heard_beyond_chance_is_somebody_playing`.

### Known limit

- **Four real bass takes are still told they were not played**, at a tonal
  share the owner's accepted take shares. Their timing pairing paired one to
  five notes, too few to be beyond chance, and a refused stretch of a page is
  never chained (the passage false positives of the entry below). Their audio
  is what would settle it.

## 2026-09-25 — A passage played twice is heard as played twice

**Synthetic.** The known limit of the entry below: bars 1–4 then bars 1–4
again, on an even rhythm, was paired straight through as bars 1–8 by timing,
and restarts were only ever looked for at a pause and in a take timing could
not read. The owner asked for it fixed.

    played (measured on main at 4c754f12)  main                            now
    bars 1–4 twice, no pause               bars 1–8, paired straight on    restarted at bar 1, bars 1–4
    bars 1–4 twice, 2 s pause              bars 1–8, 3 missed              restarted at bar 1, 0 missed
    bars 1–6, back to bar 5, to the end    8 extra                         restarted at bar 5, 0 extra
    whole page, then bars 5–8 again        16 extra                        restarted at bar 5, 0 extra
    bars 1–4 twice, five other pages       0 of 5 read as a restart        5 of 5, 0 missed

### How

- **Where the chain stops being the page.** Paired straight through, the
  first time is heard at the page's pitches and the second only by chance.
  `_replay_break` splits the take's attacks where the share heard falls from
  at least `REPLAY_BEFORE` (0.8) to at most `REPLAY_AFTER` (0.6) — **over the
  attacks, not the pairs**: the chain leaves out what matches nothing, so the
  pairs after a replay looked eight in ten heard. The attacks after the split
  are placed on the page by pitch (their start only, so a take can go back
  again); where they begin at or before the split, the take went back.
  Up to `REPLAY_LOOKBACK` (8) paired attacks before the split are tried too:
  a replay's first notes can match the bars after by chance, and the split
  then landed a bar late ("restarted at bar 2").
- **A run of eight or more unpaired attacks** that carries on from the note
  before it and covers notes the take then plays again is a first try (going
  back mid-take left the first time through as extras).
- **Ties leave the end of the page unpaired** (`CHAIN_LATE_SKIP_DISCOUNT`,
  0.01 over the page): a take that stops early is likelier than one that jumps
  ahead, and on a page that repeats its pitches the chain had paired a
  replay's last five notes with bars 5–8.
- **The guard is what a pairing claims** (`_claimed_unheard`: paired at
  another pitch, or missed inside the bars it says were played). Missed notes
  alone blocked the skipped bar; all unheard notes blocked the replay, whose
  unplayed bars 5–8 are unheard however it is read.
- A take timing accepts can be re-paired this way (`_placed_by_pitch`) and is
  not then refused or caveated; a refusal is still only overridden by a whole
  page heard at pitch.

### Regression

- Six clips: byte-identical against `main`. The twenty habits: unchanged.
- Wrong takes: nothing paired by the chain but the page itself — and "the
  first half twice", now read as the restart it is on 5 of 6 pages.
- The owner's take: unchanged ("You dragged bars 1–13 by 5 BPM", 79 of 88).

### Known limit

- **Bars 1–2 three times, on a page whose bars 3–6 share their pitches**, is
  still paired straight through: the third time through matches bars 3–4 at
  5 in 8, above `REPLAY_AFTER`, and loosening it would read chance as a
  replay on ordinary pages. The timing verdict is right; the bar numbers are
  not.

## 2026-09-25 — What playing does between the notes: holds, tuning, skips, restarts, half a page

**Synthetic, like everything before the entry below.** The owner asked what
natural playing would break. Twenty habits were run through `analyze()` on an
8-bar G-major violin page at 90 BPM, on this branch and on `main`. Four were
reported wrong, and the owner asked for all four fixed. Two more turned out to
have been wrong all along, hidden by an even rhythm.

### Before and after

    habit                                 main                                   now
    holds a note 1 / 2 beats too long     1 / 2 notes "missed"                   0 missed, steady
    tunes 4 open strings after the end    2 notes "missed", q 0.71               0 missed, q 1.00
    retunes mid-take (4 strings, 5 s)     "You dragged bars 4–5 by 35 BPM"       steady, 4 extra
    plays only bars 1–4 / only 5–8        16 "missed" / and paired as bars 1–4  0 missed, bars 1–4 / 5–8
    skips bar 4                           bar 8 "missed", bars 4–7 timed         bar 4 missed, steady
                                          against the wrong notes
    plays bar 3 twice                     0 extra; 29 of 32 notes paired to      4 extra, steady
                                          the wrong attack (3 heard at pitch)

Unchanged on all fourteen others, including a real restart (still read as
"restarted at bar 3"), half speed and 25% fast (right BPM), tremolo, trills,
added grace notes, 15 s of silence first, and warm-up notes.

### What was wrong, and each fix

- **A hold was absorbed by throwing away the first note.** `align_take`'s trim
  search discarded the first real note as noise, which shifted the whole first
  half one note early and lined the hold up with the grid: quality 0.966,
  "Steady", one note "missed", every note before the hold timed against the
  attack of the note after. Half of them heard at the wrong pitch — which is
  what now catches it: **the note chain also audits takes timing reads well**
  (`CHAIN_GAIN_NOTES` = 2 more notes heard at pitch to replace a pairing at or
  over `warn_quality`), and **may not leave more written notes unheard** than
  the timing pairing did (a take playing bars 1–4 twice otherwise paired its
  second time through against bars 5–8, half matching by chance).
- **Tuning after the end** pushed the last two notes out of the timing
  pairing. Fixed by the same audit: the chain leaves the open strings out.
- **Retuning mid-take was read as a restart.** Four open strings fit the
  rhythm of "restarted at bar 4", three of the four at another pitch; refused
  that, the same strings fit "a first try at bar 5, then bar 5 again". A
  restart now stands only if **both** copies of the replayed bars are heard at
  pitch — asked only where the take pairs by pitch at all (the chain trusts
  it), so a click track's restarts stand as timing reads them.
- **Half a page** was reported as 16 missed notes. Notes before the first bar
  the take reached and after the last are **not reached**, not missed
  (`analysis._not_reached`); a note unheard inside the bars played is still
  missed. The app's "Passage" already names the bars from the per-bar results.
- **Bars 5–8 were paired as bars 1–4**: on an even rhythm every stretch looks
  alike. A take timing has found to be a stretch of the page is chained as a
  passage (free edges), and placed where its pitches are.
- **A skipped bar read as rushing.** Every note after it arrives a bar early.
  `classification.skipped_ahead` finds where a pairing went past written notes
  without spending their time, and each stretch between is its own pulse. The
  recovery pass no longer searches inside one.

### New thresholds

    CHAIN_GAIN_NOTES     2     more notes at pitch to re-pair a take read well
    skip                 a gap nearer one played interval than the written span
    restart replay       each copy at least half heard at pitch

### What had to be narrowed, measured

- **A passage cannot be trusted like a page.** Over a stretch the chain picks,
  the share of its notes heard is high by luck: 24 notes of the page played
  backwards passed in 13 of 20 seeds. Requiring the take's *attacks* to be
  heard too brings a different same-key tune to at most 1 in 20 and the
  reversed passage to 4 in 20 — not enough to override a refusal, so it does
  not: `_placed_by_pitch` only chooses which bars a take was, for a take
  timing already gives a verdict. Trust that overrides a refusal stays
  whole-page (`_trusted_by_pitch`, 0 of 420 wrong takes).

      take of the page's 32   own passage   other tune   shuffled   reversed
      8 notes                 8/20          0/20         1/20       0/20
      12                      19/20         0/20         0/20       0/20
      16                      20/20         0/20         1/20       1/20
      24                      20/20         1/20         0/20       4/20

- **Skips only in a pairing made by pitch.** First written for every pairing,
  it read three notes a live room swallowed as a skipped bar, the recovery
  pass stopped looking for them, and `test_a_take_the_room_swallowed_is_read_
  instead_of_refused` failed: a timing pairing that lost notes looks exactly
  like one that went past them.

### Regression

- **Six clips:** byte-identical `AnalysisResult` JSON against `main`.
- **The owner's take:** still `ok`, 79 of 88 notes at pitch; now "You dragged
  bars 1–13 by 5 BPM" (was "1–16 by 4"). Bar 14 leaves out one note of its
  octave pairs, and the stretch after is now measured from where the player
  picked up; `insights` reads 6.5 slow.
- **Wrong takes:** the sweep of 2026-09-25 rerun end to end — none paired by
  the chain except the page itself with loose timing.

### Known limits

- **A passage played twice** (bars 1–4, then bars 1–4 again) is still paired
  straight through by timing on an even rhythm. It is no longer made worse,
  and it is not yet read as the restart it is: restarts are only looked for
  in a take timing cannot read.
- **The trim that dropped the first note is still there**; the chain audit
  corrects its result where pitch can see it, which on a page of one repeated
  pitch it cannot.

## 2026-09-25 — The chain of notes: a take whose pitches are the page's is judged, not refused

**The first real take in this log.** Everything above is synthetic. This began
with the owner's double-bass take (analysis 99aecbad, 104 BPM set, about 97
played, 62 s): every note of its 25-bar page in order, refused as "Same notes,
different times". The audio is the owner's and is not in the repository; the
numbers below are what it measured.

**Two faults, both in the matcher, neither a threshold.**

- **Timing alone lost its place.** 105 attacks against 95 written notes — bow
  changes, strings ringing on, a note heard twice — and `align_dtw` pairs every
  attack with some note. Its pairing implied a tempo jumping between 28 and
  203 BPM, and heard 25 of the page's 75 notes at their written pitch (0.33).
- **Pitch class could not tell the octaves apart.** Bars 11–13 are octave
  leaps (F3 F4 E4 E3 …); by chroma every note of them matches both of its
  neighbours.

**Tried first and replaced: pitch as a cost in the DTW** (the WIP commit
5eb2356c). With pitch added at 0.5–16 typical gaps, its pairing of this take
as written confirmed 38–59 of the 75 notes, with a median timing error of
370–1040 ms against one straight line. DTW still gives every extra attack a note, and the
timing terms still pull the path off the chain.

### New: `alignment.align_chain`

An edit distance on pitch: every attack is a written note or left out, every
written note is heard or skipped, in order. Twice — once on pitch alone, once
more with where each attack falls against a running median of the notes the
first pass heard at pitch, which settles which of two equal pitches is which.
Scored by the same `_scored_mapping` as `align_dtw`. Used only when the timing
pairing is under `warn_quality`, and kept only when its pitches are the page's
and the timing pairing's are not (or are fewer).

    CHAIN_SKIP              0.6   leaving an attack or a written note out
    CHAIN_SKIP_OPTIONAL     0.05  ...a slurred note or an ornament
    CHAIN_TIME_WEIGHT       0.3   an attack a played gap from its place, saturated
    CHAIN_PLACEMENT_NOTES   9     running median the placement is read from

`CHAIN_SKIP` sits between half a wrong note and a whole one: a wrong note
where the counts agree stays paired (the owner's rule — the out-of-tune note
in the middle is still that note), a wrong-pitched attack the counts do not
need is left out. The placement was interpolated through the first pass's
pairs at first; it kept whatever the first pass had picked between two equal
pitches, and four notes of this take went to a re-attack a second after the
one on time. The running median fixed all four.

### New: the pitch, with its octave (`pitch_evidence.pitch_track`)

YIN over the instrument's sounding range, **on the waveform before the 80 Hz
high-pass** — that filter removes the bottom octave's fundamentals, which is
where a bass's E1–E2 live. A double bass is matched an octave below where it
is written.

    _IN_TUNE_ST     0.6   within this many semitones: the written note (0)
    _OTHER_NOTE_ST  1.4   beyond: another note (1); a ramp between
    _OCTAVE_AWAY    0.5   the same letter an octave off

pyin was measured against yin on this take: they agree within half a semitone
on 88% of attacks and differ by an octave on 3%, at 13.7 s against 1.7 s per
minute of audio. yin.

### New thresholds (`[pitch]`, none existed)

    confirm_mismatch       0.25  an attack confirms its note at or under this
    confirmed_share        0.7   of the notes the page asks for, heard at pitch
    confirmed_min_notes    8
    confirmed_min_pitches  3

**Counted against the page's notes, not the notes paired** — and this was
learned the hard way. As first written (share of paired notes ≥ 0.6, coverage
≥ 0.5), a different tune in the same key with loose timing was trusted in two
of six seeds and given a verdict: a chain free to leave notes out pairs only
the ones that match. Measured with the final rule, 20 seeds each, violin
synth, loose timing (every gap within ±50% of a beat):

    what was played against the page        of the page's notes at pitch
                                            16 notes      32         64
                                            med   max   med  max   med  max
    the page itself                         0.94  1.00  0.91 0.97  0.90 0.97
    a different tune, same key              0.28  0.62  0.23 0.47  0.19 0.42
    the scale up and down                   0.31  0.50  0.34 0.50  0.34 0.45
    the page's notes shuffled               0.44  0.56  0.41 0.69  0.33 0.55
    the page reversed                       0.41  0.62  0.42 0.62  0.38 0.59
    the page a step up in the key           0.44  0.56  0.42 0.53  0.46 0.55
    random chromatic notes                  0.12  0.31  0.16 0.25  0.17 0.22
    one pitch throughout                    0.12  0.25  0.09 0.22  0.08 0.19

    trusted: the page 59 of 60; every other row 0 of 60.

The owner's take: 0.83 as written, **0.85 legato** (every written note an
attack — how it was played), 0.90 after the recovery pass.

### The owner's take, before and after

    before   alignment_failed  q 0.000  timing 0.000  "Same notes, different times"
    after    ok                q 0.496  timing 0.517  coverage 0.960  read legato
             "You dragged bars 1–16 by 4 BPM."  played 97.5 BPM (-6.5)
             79 of the 88 notes asked for heard at pitch, 23 different pitches

The pairing, checked by hand against the heard pitch of every note: right
throughout except bar 12 (octave leaps the tracker hears in the lower octave —
paired, unconfirmed) and bar 21, where the page says G E G E and the take plays
G E B A — very likely a misread by the scan, and exactly the case the owner
described: the note in between is wrong, the chain is not.

### Regression — the six clips

Byte-identical `AnalysisResult` JSON on all six against `main` (sha256 of the
sorted JSON, same config): every clip reads at 0.998–1.000, so the chain step
never runs on them.

    clip                  status  quality  direction  onsets
    01_detache_clean      ok      0.999    on         32
    02_detache_rushing    ok      0.999    rush       32
    03_detache_dragging   ok      0.999    drag       32
    04_slurred            ok      0.998    on          8
    05_open_e_long        ok      1.000    on          1
    06_pizzicato          ok      0.999    on         16

### Cost

The pitch track runs on every take: this take's analysis went from 1.67 s to
2.06 s (best of three, measured while the test suite ran on the same machine).

### Known limits, measured

- **The verdict's figure is a run's pace, not the take's tempo.** The run
  "bars 1–16" spans a hesitation in bar 15, after which `compute_deltas`
  measures from the new level (`pulse_anchors`), so the pace fitted across it
  is 4 BPM slow where `insights` reads the take, correctly, as 97.5 against
  104. Not changed here: it is how every verdict reads a run.
- **A different tune in the rhythm of the page still gets a timing verdict**,
  as on `main`: the chain never runs on a take timing can read. Refusing on
  wrong notes would refuse a real take against a misread page, which the
  2026-09-23 entry measured and chose not to do.
- **Half the page** is under 0.70 of its notes by construction, so a partial
  take never takes the chain; timing's subsequence matching still reads it.
- **One real take.** Every threshold here is set with a margin against chance
  on synthetic tunes, and checked on one recording.

## 2026-09-23 — A take nobody played is refused, by its pitch

**All synthetic, like everything above.** The owner asked what happens when
there is talking in the room, when nothing is played, or when a bow knocks the
stand. Measured before this change, through the real `analyze()`:

    what was recorded (nothing played)    before
    a metronome clicking in an empty room  ok, "Steady all the way through", q 1.00
    talking, against a bass page           ok, "You dragged bars 2–8 by 1 BPM", q 0.47
    an empty room                          refused, "Same notes, different times…"
    one to three knocks on a stand         refused, "Only 3 of 32 notes came through. Move the mic closer."

The onset detector is amplitude-invariant by design, so every one of those is a
run of notes to it. New: `services/pitch_evidence.py` asks what pitch held after
each attack, and `analysis.nothing_played` refuses a take as `not_played` —
"We didn't hear you play" / "Try again closer to your instrument." — when the
page's pitches were not heard and the sound was not an instrument's.

### New thresholds (`[pitch]`, none existed)

    steady             0.6   one class leads this share of a window's frames
    min_share          0.2   ...and holds this share of its energy
    top                2     a written class is heard if among the two strongest
    min_relative       0.5   ...and at least half as strong as the strongest
    low_register_midi  45    a page whose middle is below A2 is heard via CQT
    low_instruments    [double_bass]  ...and so is any take on these
    not_played_page    0.25  at or above: the page was heard, never "not played"
    chance             0.15  ...and more confirmed notes than luck would give at
    significance       0.05    this rate per note, one-sided binomial
    not_played_tonal   0.3   below: nothing held a pitch
    one_pitch          0.9   one pitch every time, on a page with several
                             (the page's classes counted over the whole page)
    played_tonal       0.8   below, with quality under warn_quality: talking

### Regression — the six clips

Byte-identical `AnalysisResult` JSON on all six against `main` before this
commit, compared with `cmp`:

    clip                  status  quality  direction  onsets   tonal  page
    01_detache_clean      ok      0.999    on         32       1.00   1.00
    02_detache_rushing    ok      0.999    rush       32       1.00   1.00
    03_detache_dragging   ok      0.999    drag       32       1.00   1.00
    04_slurred            ok      0.998    on          8       1.00   1.00
    05_open_e_long        ok      1.000    on          1       1.00   1.00
    06_pizzicato          ok      0.999    on         16       1.00   1.00

### What it separates (final settings)

Bowed takes are 40 harmonics at 1/k with vibrato, a bow scratch and a 50 ms
ring after the bow lifts; talking is voiced syllables at 3–6 a second with
gliding pitch plus two short voice clips from LibreOffice's sound gallery;
clicks are 30 ms decaying sines (1.5 kHz) or noise bursts; the "long beep" is
100 ms of A5.

    played                                   tonal  page   status
    violin G-major scale, page right         0.97   1.00   ok
    ... page a third off (a misread clef)    0.97   0.00   ok
    sixteenths at 120, page a third off      0.97   0.00   ok
    spiccato sixteenths at 160               0.97   1.00   ok
    bass scale from open E1, page right      1.00   1.00   ok
    bass under talking at 0 dB               0.97   0.94   ok (verdict skewed — see below)
    violin under a click leaking at -10 dB   0.97   1.00   ok
    violin with four knocks through it       0.97   1.00   ok

    nothing played                           tonal  page   status
    empty room                               0.00   0.00   not_played
    beep / woodblock metronome               0.00   0.00   not_played
    talking (bass page / violin page)        0.71 / 0.23  0.06 / 0.00   not_played
    knocks / stand tings / glasses           0.60–1.00  0.00–0.25  not_played (one pitch: 1.00)
    100 ms beep, page of several pitches     1.00   0.19   not_played (one pitch)
    four notes of a different piece          1.00   —      alignment_failed, as before (one pitch 0.33)

**What forced each piece of the design:**

- **Page share alone** would call a real take against a misread page silence
  (0.00 against a page a third off). Hence every "not played" rule requires
  the page's pitches to be at chance (below 0.25) *and* something else.
- **A 36-bin CQT chroma**, tried first, smeared spiccato sixteenths into each
  other (tonal 0.06, page 0.03 — correct page, called not played). **A 93 ms
  STFT chroma** fixed that and failed the bass's bottom octave (0.35 on a scale
  from open E). So the page's register chooses: CQT below A2, STFT above.
- **Rank alone** confirmed notes by chance against a pure tone: a 1.5 kHz beep
  "held" 0.31 of a G major page, because the second-strongest class is noise.
  Hence `min_relative`.
- **The page's register alone** chose the STFT for a bass take against a page
  that reads as treble — a bass part scanned in the wrong clef — and the take
  held a pitch after 0.00 of attacks. Hence `low_instruments`.
- **A share over a handful of notes** is chance: three glass clinks against a
  bass page "held" 2 of 8 matched notes, 0.25 — one in three by luck. A flat
  minimum of three notes fixed that and broke a player who stopped after two
  notes, both held (one in fifty). Hence a binomial test, `chance` and
  `significance`.
- **"Hardly any attacks" as a rule** caught knocks and rings, and also a
  musician who played four notes of a different piece — who should be told it
  is the wrong piece. What separates them is that a stand, a glass or a knock
  is one object struck again: one pitch every time (1.00), where four notes of
  music are several (0.33). The rule was dropped; the one-pitch rule does its
  work, once the page's pitches are counted over the page rather than over the
  one or two notes a knock happens to match.

### Known limits, measured

- **A page of one repeated pitch** cannot use the one-pitch rule: a pitched
  beep against it is a verdict ("Steady", q 1.00), and knocks or a glass keep
  the older refusal ("Only 3 of 32 notes came through"). Indistinguishable
  there from a real open-string take against a misread page, which must not
  be refused.
- **Notes too fast for the detector** — sixteenths at 180–200 BPM and 32nds at
  100–132 (57–83 ms), where it found 4–19 of their attacks — were refused
  before and are refused now, but as "not played", which they were not.
- **Talking that holds each syllable steady** (a stand-in voice measured 0.94
  tonal) is not caught by pitch; the alignment still refuses it (quality 0.22),
  with the older sentence. No talking-only take reached a verdict.
- **Talking under a real take still skews its timing** — the violin under
  talking at -20 dB: "You dragged bars 6–7 by 8 BPM", q 0.47. Tried and not
  shipped: dropping matched notes whose attack did not carry the written
  pitch. Across eight talking seeds, the notes it flagged were not the notes
  that were mistimed; on a sustained line the written pitch is sounding
  wherever a syllable lands. That needs pitch-aware onset detection, not a
  check afterwards.

## 2026-09-22 — An audit of what the analysis gets wrong, and eight fixes

**Every number below is from synthetic takes.** The six corpus clips are still
unrecorded (`fixtures/audio/README.md`), so nothing here is tuned against a real
instrument in a real room. What these changes do is remove readings that were
wrong *by construction* — arithmetic, clocks, a matcher tie — which no
recording would have made right. Each repro below ran against the commit before
this one and against this one.

### Regression — the six clips

    clip                    quality (before -> after)   status   direction   notes
    01_detache_clean          0.988 -> 0.999              ok        on         32
    02_detache_rushing        0.988 -> 0.999              ok        rush       32
    03_detache_dragging       0.988 -> 0.999              ok        drag       32
    04_slurred                0.990 -> 0.998              ok        on          8
    05_open_e_long            1.000 -> 1.000              ok        on          1
    06_pizzicato              0.990 -> 0.999              ok        on         16

Status, direction and note count identical on every clip. Quality rises from
onset placement (below). **The rushing clip's verdict changed and it is the
point of the first fix:** before, "You rushed across measures 2–8 by an average
of **9 BPM**"; after, "You rushed across measures 2–8." That clip drifts 8 ms a
beat at 60 BPM, which is **60.5 BPM** — half a BPM fast, which rounds to no
figure. The 9 was a position read as a tempo. Dragging: the same.

Full backend suite: 2568 passed, 2 skipped, 2 xfailed (was 2525 passed; the
difference is the new tests).

### 1. The verdict's "BPM" figure is a tempo now

`target_bpm × mean(|delta_pct|) / 100` → the pace across the run: the slope of
the drift against written time over the run and the note before it
(`classification.run_tempo_difference`). No figure when it rounds to zero or
points the other way from the verb.

    played (target 60)   before                     after
    63 steady            "by an average of 48 BPM"  "by an average of 3 BPM"
    61.5 steady          25                         1
    57 steady            52                         3

### 2. The origin is several notes, not the first one

`pulse_anchors` read each stretch's level from one note. Now: the median of the
first `LEVEL_NOTES` = 6 usable notes, each projected to the stretch's start
along a Theil–Sen pace over `PACE_NOTES` = 8 notes. Perfect take at 120 BPM with
only the first note 40 ms late: before, 27 of 32 notes `slight` and "You rushed
across measures 1–4 by an average of 9 BPM"; after, "Steady tempo".

`PACE_NOTES` sweep, level error at the start of a steadily accelerating take
(the late-first-note and jitter cases read identically at every value):

    PACE_NOTES     8     12     16     64
    level error   25 ms  53 ms  78 ms  102 ms

A median of consecutive intervals was tried first and was worse than one note:
it snaps to one side of the frame grid's 21/22-frame alternation, a 2.5% pace
error, and a steady player was told they drifted on 34 of 40 seeds.

### 3. A drift needs four notes, or two far out

`MIN_VERDICT_RUN` = 4 consecutive same-direction notes, or 2 all past the
middle band. No drift, each note independently jittered, 40 seeds at 120 BPM:

    jitter sd          8 ms    12 ms    18 ms
    told they drifted  2 -> 0  13 -> 1  30 -> 3

**The one to revisit with real recordings**: it was set against simulated
spread, and how a real player's timing wanders is what a recording knows.

### 4–5. Readings: slurs, repeats, restarts

See `DECISIONS.md`. Before → after, every note on time:

    legato slurs, slurred notes heard            0.376 refused  -> 0.996 ok
    legato slurs, 3% fast                        "dragged by 31 BPM" -> "rushed by 2 BPM"
    random half of slurred notes heard (12 seeds) 0/12 clean    -> 12/12
    printed repeat not taken                     0.000 refused  -> 0.998 ok
    stop in bar 6, restart from bar 5            0.134 refused  -> 0.997 ok
    stop in bar 5, restart from bar 3            0.000 refused  -> 0.997 ok

The mixed slur case needed three matcher changes, each measured on it:
intervals measured back across unheard optional notes (0.512, two bow changes
missed → no misses), the path's cost of crossing an optional note capped at
the position cap (one detection swept six slurred notes and past a bow change →
fixed), and the set tempo and the take's span tried as paces when the page has
optional notes (median gap 2.6× the written one, ratio clamped at 0.6 → 12/12).

### 6. `highpass_hz` changes no onset — declared, not moved

Envelope correlation, bowed bass with a 58 Hz room mode, with and without:

    waveform high-pass 80 Hz              0.9999   onsets identical
    cutoff as the lowest mel band, 80 Hz  0.9999 dry, 0.9993 in a 0.9 s room
    50 Hz notes, bands from 150 Hz        8/8 still found (leakage)
    45–60 Hz boom at 5x note peak         not detected with no filter at all

The band floor was built, measured and reverted. `config.toml` says so beside
the knob.

### 7. Onsets placed on a 2.9 ms grid

`audio.refine_onset_times`. Bowed notes, 90 BPM, rise 5–120 ms:

                           spread across rise    spread within one
    violin, dry            34.8 -> 12.6 ms        6.9 ->  1.4 ms
    violin, 0.8 s room     29.0 -> 13.5 ms        8.1 ->  2.1 ms
    bass, dry              19.3 ->  6.3 ms        8.7 ->  4.0 ms
    bass, 0.8 s room       50.3 -> 32.2 ms       11.0 -> 12.7 ms

**And it exposed a matcher tie the frame grid had been breaking by luck.**
After a bar held exactly one beat long, seven notes of a later bar of eighths
paired two ahead; the correct path cost 4.057 and the slid one 3.969. New knob,
`STEP_PENALTY_CAPS` (a sideways DTW step, in position caps), swept on the
varied page's five attribution cases:

    STEP_PENALTY_CAPS   0    1    1.5   2    3    4    6
    held bar wrong      7    7    0     0    0    0    0
    hurried bar wrong   10   0    0     0    0    0    0
    clean/drop/add      0    0    0     0    0    0    0

Three: the middle of the flat region. **Two readings changed with it, and both
were wrong before:**

- An unmarked `rit.` (60 → 45 BPM) was read "low confidence, dragged across
  5–8" with **25 of its 32 notes paired to the wrong written note** — the path
  slid through the slowing bars to shrink the residuals. Paired honestly, a
  steady-tempo alignment cannot explain it: refused at 0.324, "check the tempo".
- Straight eighths played 2:1 swung were refused at 0.100 — by the same slide.
  Paired one to one they score 0.677 and are analysed, the side of the line
  `test_long_takes.py` already put 3:1 swing on deliberately.

The penalty also let the trim search drop four real notes to turn an even take
into a "passage" scoring 1.000 with bars misnamed; a trimmed candidate may no
longer switch into passage mode the untrimmed take was not in.

### 8. Calibration

Window sized from `bpm_max` instead of left at the ±464 ms cap; typical gap
instead of median. Bowed notes:

    played   120     135            150    180    208
    before   117.5   out_of_range   49.7   60.1   103.4
    after    120.0   135.0          149.9  179.8  207.7

(No client calls `/v1/calibration` today.)

### And a bug found on the way: the second look searched the wrong clock

`_recover_missed_onsets` predicted on the take's clock and searched the
recording's, so a lead-in moved every search by its own length. On the room
take with a 2 s lead-in its recoveries sat 0.2–0.4 s from any note on the
page. With the clock fixed it then "recovered" a dropped note from room tone,
so it now also requires the recording to be sounding there:

    [onset.recovery] min_level_db   (new)   10.0

Room tone sits at the take's floor (5th percentile of frame RMS); the quiet
notes it exists for are 30+ dB above it. Ten is a margin in that gap.

### What this does NOT do

Nothing here was checked by ear or against a real instrument. `MIN_VERDICT_RUN`,
`[onset.recovery] min_level_db` and the restart search's reach
(`RESTART_BARS_BACK` = 8) are the values a session with the corpus should look
at first.

## 2026-09-22 — Per-instrument onset settings, seeded at today's values

**No threshold changed.** The six clips are **identical** — quality, status,
direction and per-note count, clip by clip. This is a restructuring, logged
here because it touches `[onset]` and because it is the thing that has to exist
before any of the tuning below can be done at all.

### What was wrong

The analysis could tell a double bass from "everything else" and nothing
finer. `analysis_runner` collapsed the instrument to a boolean before calling
`analyze()`, so violin, viola and cello shared the path whose `delta = 0.07`
was chosen for a violin:

    instrument     high-pass   delta      open strings
    violin              none    0.07      G3 196 · D4 294 · A4 440 · E5 659
    viola               none    0.07      C3 131 · G3 196 · D4 294 · A4 440
    cello               none    0.07      C2  65 · G2  98 · D3 147 · A3 220
    double bass        80 Hz    0.05      E1  41 · A1  55 · D2  73 · G2  98

A cello's lowest fundamental sits below the cutoff only the bass was given, and
its attack envelope has far more in common with a bass than with a violin. None
of that could be acted on, because the analysis was never told.

### The change

`[onset.instrument.<name>]` per instrument, resolved once by
`audio.onset_settings_for`. Seeded with exactly the values each instrument was
already getting, so violin, viola and cello are identical rows today. That is
deliberate and it is not a claim that they should be.

### Regression — the six clips

    clip                    quality (before -> after)   status   direction   notes
    01_detache_clean          0.988 -> 0.988              ok        on         32
    02_detache_rushing        0.988 -> 0.988              ok        rush       32
    03_detache_dragging       0.988 -> 0.988              ok        drag       32
    04_slurred                0.990 -> 0.990              ok        on          8
    05_open_e_long            1.000 -> 1.000              ok        on          1
    06_pizzicato              0.990 -> 0.990              ok        on         16

Identical, by construction: every instrument resolves to the number it
resolved to before, and the corpus is all one instrument anyway.

Full backend suite: 2523 passed.

### What this does NOT do, and what it is owed

**It does not improve any instrument's reading.** Viola and cello are still
read with a violin's threshold and no high-pass. Whether either should have its
own is precisely the question this repository cannot answer yet:
`fixtures/audio/README.md` records that none of the six clips is recorded, and
"only a real instrument in a real room can answer that". Values invented for a
cello here would be the failure that file exists to prevent.

**What the corpus now needs is four times over.** The six clips were specified
for one instrument. Splitting `[onset.instrument]` apart honestly needs the
same passage recorded on each instrument that is going to get its own row —
same room, same mic placement, per the README's own rule about not tuning
against the room.

**A cello is the first one worth recording.** It is the instrument furthest
from the settings it currently gets: bass clef, a 65 Hz open C under an 80 Hz
cutoff it does not receive, and a bowed attack closer to a bass's than to a
violin's.

---

## 2026-09-21 — One attack reported twice is not two notes

**No threshold changed, and nothing was added to `config.toml`.** The floor
this introduces is derived from two constants that already exist. The six clips
are **identical** — quality, status, direction and per-note count, clip by clip.

### The defect

The owner played the **first half** of a 25-bar part, starting at bar 1. The
run reported `onsets=77/75`: more attacks than the whole page writes, from half
of it. It was refused with "check you're on the right piece".

Two things went wrong together, and the second is the one worth recording.
`subsequence` is the machinery for a take covering part of a page, and it is
gated on two tests:

    detected.size < expected.size          77 < 75   -> False   (vetoes)
    take_span * MAX_TEMPO_RATIO < page_span  49.5 < 58.2 -> True  (correct)

The span test was right. The count test vetoed it, because over-detection had
pushed ~43 played notes to 77 reported ones. So the match fell back to the
corner-anchored path, which stretches a half-take across the whole page, and
every residual was enormous.

**The diagnosis before this one was wrong**, and it is worth saying so: the
same numbers — 29.1 s of take against a 58.2 s page — were read as a take of
the whole piece played at twice the tempo. A half-take at the right tempo and a
whole take at 2x are the same ratio, and `MAX_TEMPO_RATIO`'s own comment names
2.0 as exactly the number it cannot resolve. The owner said which it was.

### The change

Drop detections too close together to be two of *this page's* notes, after
detection and before alignment.

**The floor is derived, not chosen.** `closest_expected_gap` is the nearest two
notes the page prints; `MAX_TEMPO_RATIO` is the fastest the matcher will
believe a performance of it. Their quotient is the closest two of this page's
notes can honestly arrive. On the page in question: 294 ms / 1.7 = **173 ms**.

`wait_ms` in `[onset]` stays at 60 ms. It is a fact about how fast a string can
be re-attacked and it does not know what is on the stand; this is the page's
floor. They are different claims and both are wanted.

Measured on that page, a take of its first 43 notes:

    doubled attacks   onsets   as shipped   collapsed
                  0       43        0.974       0.974
                 10       53        0.607       0.974
                 20       63        0.536       0.974
                 34       77        0.000       0.974

### Two things it must not do, and the guards for them

**An ornamented page is left alone entirely.** An acciaccatura sits a fraction
of a beat before the note it decorates — inside any floor derived from the
required notes — so the pair would be collapsed and the attack kept would be
the *grace's*. The main note is the required one, and handing it a timestamp
60 ms early is a timing error invented on a note that was played correctly.

**The opening pair is left to `align_take`.** Found by
`test_a_bow_settling_before_the_first_note_no_longer_writes_the_verdict[0.5]`,
which this broke: a bow settling 0.5 s before the first note is, in times
alone, indistinguishable from that note being reported twice, and the two want
opposite repairs — here the *second* sound is the music. At 60 BPM the floor is
588 ms, so the scrape swallowed the first note and the take read as half a beat
early. `align_take` already decides the origin with a trim search that pays for
what it discards, and it is better informed than this rule.

The cost of that second guard is honest: one doubled attack survives at the
origin, and across takes of 15 to 18 notes the result lands between 0.478 and
0.967 rather than at 0.974. The claim the test makes is the stable one — the
take stops being **refused** and gets a verdict against the passage it played.

### Regression — the six clips

Old rule against new, in one process, same decoded audio:

    clip                    quality (off -> on)   status   direction   notes
    01_detache_clean          0.988 -> 0.988        ok        on         32
    02_detache_rushing        0.988 -> 0.988        ok        rush       32
    03_detache_dragging       0.988 -> 0.988        ok        drag       32
    04_slurred                0.990 -> 0.990        ok        on          8
    05_open_e_long            1.000 -> 1.000        ok        on          1
    06_pizzicato              0.990 -> 0.990        ok        on         16

**Identical on all six.** Expected rather than lucky: the corpus is a
synthesised click track with no doubled attacks in it, so there is nothing here
for this to remove. The corpus proves no regression and cannot prove the fix.

Full backend suite: 2513 passed. The three new tests fail against a stubbed-out
`collapse_double_attacks`, checked.

### Still owed

The recording that prompted this was never replayed — the session proxy refuses
both the API host and storage, and the buckets are private. So the trigger is
reproduced from the production log's own numbers and from synthetic takes built
on the real score, not from the audio. **Whether the owner's take actually had
34 doubled attacks is unknown**; what is known is that it reported 77 onsets
for a half-take, and that a page-derived floor is the principled repair for
that shape. The next real take is the test.

---

## 2026-09-21 — The steady tempo comes out before the hesitation detector

**No threshold changed.** `broken_quality` is still 0.40, `warn_quality` still
0.70, `[tolerance.pulse]` untouched. What changed is the *order* of two steps
inside `_residuals`, and the six clips are **identical** — quality, status,
direction and per-note count, clip by clip.

### The defect

Eleven consecutive takes in production, from 2026-09-12 to 2026-09-20, every
one refused. **None has ever produced a verdict.** All eleven are
`alignment_failed` with `alignment_quality = 0`, and the three still inside the
host's log retention name the cause:

    refused, quality=0.000 (timing=0.000 coverage=0.720) onsets=77/75 take_span=29.1s page_span=58.2s
    refused, quality=0.000 (timing=0.000 coverage=0.880) onsets=84/75 take_span=30.0s page_span=51.2s
    refused, quality=0.000 (timing=0.000 coverage=0.787) onsets=88/75 take_span=32.6s page_span=74.2s

Coverage is healthy in all three and the onset counts are close to the page's
75 — the microphone, the transcription and the OCR all did their jobs. Only
`timing` is broken, and it is broken to exactly 0.

`quality` exists to ask whether an alignment can be trusted, and `_residuals`
takes a straight line out so that a take played evenly at another pace still
reads as the right piece — the comment above the call in `align_dtw` is
explicit that a take "at 95% of the marked tempo" must score 1.0. It did. 92%
scored 0.000.

The cause is that `pulse_anchors` ran **before** the line was removed. It
judges a step against the spread of the take's other steps, and a steady tempo
difference moves every note in proportion to its own length: at 1.3x an eighth
drifts 68 ms and a half drifts 271 ms, from one cause. The long notes then read
as a run of disturbances, the anchor resets part way down the ramp, and what
reaches `polyfit` is a sawtooth rather than a line. Measured on the 25-bar
production page at 102 BPM, same notes, played steadily faster:

    pace    fitted rate (want)      residual    quality
    1.05x   0.9524 (0.9524)              0 ms     1.000
    1.08x   0.9909 (0.9259)            357 ms     0.000
    1.30x   0.9560 (0.7692)            955 ms     0.000
    2.00x   0.9412 (0.5000)           1331 ms     0.000

The mapping was the identity in every row and coverage was 1.000: all 75 notes
matched, and the score was thrown away afterwards.

**The usable window was about 0.95x to 1.07x of the tempo the player set**, and
outside it the musician was told to check they were on the right piece. It was
also erratic rather than monotonic — on one page shape 0.50x and 0.70x passed
while 0.92x and 1.40x failed — because whether the trip happens depends on how
the proportional steps land against `max(6 x spread, 0.1667 x beat)`.

### The change

Remove the steady pace first, hand `pulse_anchors` only what a steady pace
cannot explain, then fit the line as before. The pace is a **median of
per-interval rates**, not a least-squares slope, because the series this has to
survive is the one `pulse_anchors` exists for.

Three estimators were measured on the hesitation case (one bar held a beat, the
pulse then resuming), against 0.640 for the old rule:

    median of per-interval rates     0.640   <- unchanged, chosen
    least-squares slope              0.569   dragged by the held interval
    typical_gap(played)/typical_gap(written)
                                     0.220   its core filter drops the long
                                             gaps, so the ratio of two filtered
                                             means is not a rate when the two
                                             gap distributions differ

### Regression — the six clips

Run old rule against new in one process, same decoded audio:

    clip                    quality (old -> new)   status   direction   notes
    01_detache_clean          0.988 -> 0.988         ok        on         32
    02_detache_rushing        0.988 -> 0.988         ok        rush       32
    03_detache_dragging       0.988 -> 0.988         ok        drag       32
    04_slurred                0.990 -> 0.990         ok        on          8
    05_open_e_long            1.000 -> 1.000         ok        on          1
    06_pizzicato              0.990 -> 0.990         ok        on         16

**Identical on all six**, including the two that carry a direction. That is the
expected result rather than a lucky one: the corpus is a click track at a
single pace, so the ramp this fixes is not present in any of the six. The six
prove the arithmetic still runs and still points the right way; they cannot
prove the fix, and the page that can is in `test_alignment.py`.

### What still refuses

Checked on a page built through `compute_expected_onsets` with eighths,
quarters, halves and a bar of rest — the shape the failures were found on.
Unchanged from the old rule in every case: every other note 0.000, note values
drawn at random 0.000, uniform noise 0.000 across eight seeds, a swung rhythm
and a part-take unchanged to three decimals. Widening what counts as a pace did
not widen what counts as music.

`test_a_take_played_evenly_at_another_pace_is_still_the_right_piece` fails at
six of its nine paces against the old rule and passes at all nine against the
new one. On an even grid of quarters it passes against both, which is why the
page it runs on has mixed note lengths and says so.

### Still owed

This is arithmetic verified against synthetic takes built from a real score,
not against the recordings that failed — those need a service-role key this
session does not have. The numbers above reproduce the production log's
`page_span` to 0.1 s on all three retained failures and reproduce
`quality=0.000 timing=0.000`, so the mechanism is confirmed; replaying the
actual WAVs is not done. **The threshold question the corpus README raises is
untouched and still open**: whether 0.5 beats of average error is the right
anchor needs real recordings and an ear.

---

## 2026-09-19 — Two new thresholds, after a third approach was built and reverted

**New section `[onset.recovery]`: `search_share = 0.25`, `floor_ratio = 0.015`.**
No existing value changed. The six clips are **byte-identical** — by
construction, not by luck, and that is the whole argument for this shape.

### The defect

Measured with new degradation models (`add_noise_at_snr`, `add_room_reverb`,
`apply_clipping` in `audio_helpers`). Noise, clipping and reverb *alone* do not
break detection — 0 dB SNR, hard clipping and a 2-second room all keep 24/24
notes. **Dynamic range against a reverberant room does:**

    20 dB range, dry          24/24      30 dB range, dry          24/24
    20 dB range, RT60 0.9s    16/24      30 dB range, RT60 0.9s    12/24

Precision stays 1.00 — the quiet notes are gone, not mistimed. End to end at
92 BPM the 20 dB case is **refused outright**: coverage 0.667, quality 0.248,
and a musician who played the page correctly is told to check the piece.

### The approach that was reverted

Replace the absolute `delta` on a globally-normalised envelope with a local
one: `envelope / max(local_mean, floor × peak)`. The diagnosis behind it is
correct and still stands — a quiet note's peak collapses from 0.22 to 0.030
while `delta` stays 0.07, so it is rejected by about the width of `delta`.

It fixed the target case (20 dB + reverb 0.67 → 1.00) and **passed all six
corpus clips at every setting tried**. Against the full audio suite it failed
at every window:

    adaptive_avg_s   0.10    0.20    0.35    0.50
    failures           14      13      14      13        (baseline: 0)

Chief casualty: every assertion in `test_varied_rhythm.py`. A local baseline
computed as a **mean** is raised by dense passages and lowered by sparse ones,
so on mixed note values the threshold moves with the rhythm it is meant to be
a reference for. No window escapes that; it is structural. Reverted before it
left the working tree, as the 2026-09-14 change was.

**A methodological note, because it nearly shipped.** The window was swept
against a *subset* of the suite, where 0.50 looked like it fixed everything —
the bowed re-trigger, the noise case, and the dynamics win together. Against
the full suite that same value is 13 failures. A sweep against a subset is
fiction.

### What shipped instead

A second pass, after alignment, that looks **only where the score writes a
note and the alignment found none**, and can only add an onset there. Two
properties follow and both were the reason for the shape:

  * A take that missed nothing is **byte-identical** — `missed_expected` is
    empty and the pass returns before touching the audio. The six clips are
    therefore unchanged without needing to be re-tuned.
  * A phantom cannot appear where the page writes no note.

`floor_ratio = 0.015` is far below anything the detector reports, and the
first value tried — 0.08 — was wrong for exactly that reason: the population
it exists to find peaks at 0.030, so 0.08 rejected all of it and recovered
nothing. **The window is the guard, not the floor**: a quarter of the closest
written gap, around a time the page and the take's own fitted pace agree on,
with an interior local maximum required.

Placement mattered as much as the numbers. It was first written *below* the
refusal check, where it was useless — a take refused on coverage returns early
and never reaches the code written to rescue it.

### Regression

| | without | with |
|---|---|---|
| Six corpus clips | pass | pass, **byte-identical** |
| 92 BPM, 20 dB + RT60 0.9s | `alignment_failed`, q 0.248 | **`ok`, q 0.603** |
| Clean take, same page | `ok`, q 0.970 | `ok`, q 0.970, same onsets |
| Full backend suite | 2,321 passed | **2,332 passed, 0 failed** |

Still open: 30 dB + reverb at 92 BPM, and everything at 120 BPM, remain
refused. The pass helps and does not yet close the case.

---

## 2026-09-14 — Bowed attacks measured, and a threshold change written and thrown away

**No value changed**, and the first draft of this entry changed one. Recorded
in full because the wrong answer was *convincing*, and the thing that caught it
is the reason this file's own README says a synthesised clip cannot settle a
threshold.

### The wrong answer

A bowed attack was modelled as a squared ramp on a **pure sine**, and against
that model raising `[onset] delta` from 0.07 to 0.12 looked excellent — every
struck take bit-identical, and a 120 ms attack going 0.000 → 0.789. It survived
a dynamics sweep (0.20 went deaf, 76 detections for 95 notes; 0.12 did not) and
the six corpus clips were byte-identical at both values, because they are click
tracks and `delta` does not reach them.

The repository already had a far better model — `audio_helpers.synth_bowed_note`,
a Helmholtz sawtooth under a raised-cosine rise, in a room with one mode and a
mic floor, written precisely to test low-register detection. Re-run against it,
the answer **inverts**:

| take (repo bowed model) | delta 0.07 | delta 0.12 | delta 0.20 |
|---|---|---|---|
| violin, 35 ms rise | **0.984 / 95** | 0.919 / 93 | 0.286 / 78 |
| violin, 80 ms rise | **0.984 / 95** | 0.393 / 81 | 0.380 / 78 |
| violin, 120 ms rise | **0.872 / 97** | 0.233 / 80 | 0.370 / 78 |

A pure sine carries one partial and almost no flux at onset; a bowed string
carries a full harmonic series and plenty. The detector was never the problem
for bowed **violin** — 0.07 reads it correctly — and the "fix" would have cost
15 of 95 notes on a real one. Reverted before it left the working tree.

### What is actually true, on the good model

`double_bass`, five attack times, `double_bass_delta` on the left as it ships:

| rise | δ 0.05 (ships) | δ 0.08 | δ 0.12 | δ 0.18 |
|---|---|---|---|---|
| 35 ms *(the model's own default)* | **0.976 / 95** | 0.932 / 94 | 0.524 / 73 | 0.524 / 73 |
| 60 ms | 0.806 / 97 | **0.926 / 94** | 0.000 / 78 | 0.603 / 73 |
| 90 ms | 0.641 / 101 | **0.895 / 94** | 0.538 / 76 | 0.755 / 73 |
| 120 ms | **0.000 / 104** | 0.658 / 91 | 0.603 / 73 | 0.603 / 73 |
| 160 ms | 0.230 / 104 | 0.578 / 93 | 0.602 / 73 | 0.602 / 73 |

δ 0.08 wins four rows of five and turns a refusal into a reading at 120 ms.
**It was still not taken.** The one row it loses is the rise the model's author
chose as typical, and `[onset.double_bass]` already documents the opposite
reasoning — "slow attack envelopes, broad onset peaks… *lower* delta" — for
catching soft attacks. Moving a threshold against a documented decision, on
evidence from a synthesiser, in the direction that makes a detector deafer, is
the move this project has twice written down as wrong. It wants one real bass
recording, which is what `fixtures/audio/README.md` has been asking for since
Batch 3.

### The mechanism, which is not what "over-detection" suggests

Measured on a 95-note page at a 120 ms bass rise:

- **No note is double-triggered.** The closest two detections sit **279 ms**
  apart against a closest written gap of 375 ms. `pre_max`/`post_max`, derived
  per take from that gap, already exclude a re-trigger. The extra 9 detections
  over 95 notes come from elsewhere in the take, not from notes firing twice.
- **Every onset lands late, and the lateness moves**: +61 ms after a long note,
  +123 ms inside a run of eighths. A *constant* lag is free — `_residuals` fits
  offset and rate before quality is measured — so it is the variation that
  survives and costs the take.

`test_bowed_attacks.py` pins all three findings.

### One knob found inert

`[onset] wait_ms` is passed to librosa as `wait` and changes nothing: swept
60 → 100 → 150 → 200 ms across five attack times, every reading
byte-identical. Peak-picking already requires each onset to be the maximum over
±`peak_window_frames` (16 frames, 372 ms, on a page of eighths at 80 BPM)
against this value's 3. Documented in `config.toml` beside `post_max`, which
was found the same way.

### What this entry cannot claim

Every number above comes from a synthesiser. The six corpus clips are click
tracks and were byte-identical before and after everything tried here, so they
vetoed nothing and validated nothing. **The pipeline has still never been run
against a real instrument.**

## 2026-09-14 — Every take the app had ever analysed was refused, and no threshold was wrong

**No value changed.** Nothing in `config.toml` moved. What changed is what
`align_dtw` compares a take against, and the reason is that the thresholds were
never the problem — they had simply never been asked a question they could
answer.

**The readings.** All eight rows in `analyses` on the live project, 2026-09-12 to
2026-09-14, finished `done` with `result_json.status = alignment_failed` and
`quality` **exactly 0.000**:

| analysis | detected | expected | coverage ceiling | quality |
|---|---|---|---|---|
| `a967f5ee` | 6 | 74 | 0.081 | 0.000 |
| `d578857b` | 11 | 74 | 0.149 | 0.000 |
| `3bc2e100` | 23 | 76 | 0.307 | 0.000 |
| `2aac1ba8` | 29 | 76 | 0.387 | 0.000 |
| `b83e75e4` | 29 | 76 | 0.387 | 0.000 |
| `44975f56` | 34 | 76 | 0.453 | 0.000 |
| `5d6011ba` | 39 | 76 | 0.520 | 0.000 |
| `8c4e2c8a` | 52 | 75 | 0.693 | 0.000 |

`quality` is `timing_quality * coverage` and `coverage <= n_detected /
n_expected`, so the fourth column is a ceiling that applies before a note is
compared. **Five of the eight sat under `broken_quality` (0.4) on the onset
counts alone** — no performance of those recordings could have passed, and
lowering the cutoff to admit them would have had to reach below 0.08.

**Why no threshold could have been read off these.** The takes ran 2 to 56
seconds against pages spanning 74 to 82. `librosa.sequence.dtw` was called with
`subseq` at its default `False`, which anchors the path corner to corner, so each
take was stretched across the whole page. A tuning pass against these readings
would have been measuring the stretch.

**Measured, on a reconstruction of the real 25-bar part** (`Elijiah`, the score
pulled from the live DB, rendered as a click track at its own `target_bpm` of 80,
so the grid matches what was played):

| take | before | after |
|---|---|---|
| the whole page, perfectly in time | 0.984 `ok` | 0.984 `ok` |
| the whole page, ±40 ms human jitter | 0.914 `ok` | 0.914 `ok` |
| the page's first 75% | 0.725 `ok` | 0.725 `ok` |
| the page's first 50% | **0.000 `alignment_failed`** | **0.487 `ok`** |
| the page's first 25% | **0.000 `alignment_failed`** | **0.984 `ok`** |
| the middle 40% | **0.000 `alignment_failed`** | **0.985 `ok`** |

**What is still refused, and is a separate fault.** Over-detection — more attacks
heard than the page writes — is untouched, because a subsequence match is not
defined when the query is the longer sequence. Rendered with a 120 ms bowed
attack the detector reports 114 onsets for 95 notes and the take still scores
0.000; at 60 ms, 0.239. That is the next thing to measure and it wants real
audio, not a synthesised attack envelope.

**On the regression this entry does not claim.** CLAUDE.md asks for a clip-by-clip
run across all six fixtures. `fixtures/audio/README.md` says in its first
paragraph that **none of the six were ever recorded**; `make_synthetic.py` stands
in for them and its own header says a synthesised click "cannot tell you whether
a threshold is right". The six are exercised by `test_corpus_regression.py` and
pass, and that is worth exactly what it is worth. The readings above are from
click tracks too. **The pipeline has still never been run against a real
instrument in a test**, which is the condition this failure was hiding in.

The four real takes are also unavailable for one: `keep_playback_copy`
re-encodes to Opus and deletes the WAV after a successful run, and
`storage.objects` now holds only `.opus` for all eight.

## 2026-09-08 — The tuning dashboard was detecting twice the onsets the pipeline does

**No value changed.** `analyze()` is untouched; every threshold in
`config.toml` is what it was. What changed is that the dashboard now reports
the pipeline's numbers on a page with an ornament on it, which it did not.

`diagnostics.py` had copied `analyze()`'s preamble — decode, high-pass, read
the score, detect — and the copy called
`closest_expected_gap(expected)` where the original calls
`closest_expected_gap(expected, optional=grace_onsets)`. One keyword.

With no grace notes on the page the two arguments are the same value, which is
why nothing caught it: `test_diagnostics_matches_analyze` uses eight plain
quarters and agrees either way.

Measured, one acciaccatura on a bar of eight quarters played exactly on the
grid:

| | detector `min_gap_s` | onsets detected |
|---|---|---|
| `analyze()` | 1.00 s | **8** for 8 clicks |
| dashboard, as it was | 0.15 s | **16** for 8 clicks |

That is the failure `closest_expected_gap`'s own docstring records — the window
shrinking everywhere to chase an acciaccatura, "14 onsets detected for 8
clicks" — happening to the tool that exists to tune it away.

**What this means for readings already taken.** Nothing in `TUNING_LOG.md`
records a value chosen off an ornamented clip, and no threshold has been moved
yet, so there is nothing here to revise. But any onset count, envelope or
matched-pair reading taken from the dashboard on a clip whose score carries a
grace note was not what the pipeline would have produced, and should be taken
again.

**Fix.** The preamble is now one function, `analysis.prepare_for_alignment`,
which both call — two implementations of one order of operations cannot be kept
in step by reading them. `test_diagnostics.py` gains the ornamented case; it
fails against the old call and passes against the shared one.

## 2026-09-04 — The blast radius of changing a band, before anyone changes one

**No value changed.** Read this before the first real tuning pass.

### `config.toml` is not the whole surface

`audio_config.py` claimed every threshold the pipeline uses lives in the file.
It does not. Eleven decision constants live in Python: `ORNAMENT_SHARE`,
`MIN_TEMPO_RATIO` / `MAX_TEMPO_RATIO`, `MIN_ONSETS_TO_ESTIMATE_TEMPO`,
`MAX_EDGE_TRIM`, `MIN_TRIM_GAIN`, `POSITION_WEIGHT`, `POSITION_CAP_GAPS`,
`_GAP_CORE_LOW` / `_GAP_CORE_HIGH`, `TAKE_TOO_LONG_RATIO`.

Most are structure rather than knobs and their own comments say so with
measurements — `POSITION_WEIGHT` behaves identically anywhere from 0.25 to 2.0;
`MIN_TRIM_GAIN` repairs failures running 0.029 → 0.988. Leave them.

**`ORNAMENT_SHARE` is the one for this session.** Its comment: *"Chosen against
two synthetic takes and no real recording, which is the honest limit on it."*
It decides where a grace note and the note it decorates are placed, and those
notes are reported to a musician as "not timed" precisely because the number
was invented. It is not in `config.toml`, so nothing in the file will remind
anyone it exists.

### Changing a band changes the app, in a way that is easy to get backwards

`FALLBACK_INNER_PCT = 5` and `FALLBACK_OUTER_PCT = 20` in
`mobile/src/lib/tempo.ts` are the bands the app assumes for a take that carries
no tolerance of its own — rows finished before the pipeline started storing the
numbers it judged by.

They currently equal the shipped config, and their docstrings said they
*matched* it. **They must not follow it.** A take analysed on today's bands was
judged by 5 and 20; re-banding it by whatever the bands become re-judges a
performance nobody re-recorded, and a musician's history changes under them for
no reason they can see. Leave the constants alone unless the old bands were
*wrong* rather than merely untuned.

`backend/app/tests/test_fallback_bands.py` fires the moment the two diverge and
states both answers. Two neighbours in it are worth knowing before you widen
one side:

  * the fallback is **one** number standing in for a rushing/dragging pair, so
    it is honest only while the two sides are equal — and the tuning appendix
    says to widen dragging;
  * `bandFor` infers the mid band as **half the outer**, which is where the
    spec's starting values put it and is not a law.

Both are app-side consequences of a one-line config edit, and neither is
visible from `config.toml`.

Measured: widening the dragging bands to 7/26 fires three of those cases,
passes all 1504 mobile tests, and fails exactly one existing backend test —
`test_classify_band_dragging_side`, about the pipeline. Update that one and the
app is still wrong.

---

## 2026-09-04 — Two of the twenty-two knobs turn nothing, and the file gave no sign

**No value changed.** This is about the instrument the tuning session will use.

The whole argument for `config.toml` is CLAUDE.md §1 rule 7 and
`audio_config.py`'s own first line: *"change a number, re-run the fixtures, log
it here; no code edit."* Batch 3's thresholds are still the spec's starting
values because tuning needs real ears on real recordings, so that session has
yet to happen — and when it does, it happens by editing this file.

**A knob that turns nothing is the worst way that loop can fail.** The tuner
changes a number, the corpus reads identically, and the honest conclusion from
that evidence is *"this parameter does not matter."* It would be logged here as
a measurement, and it would be a measurement of nothing.

Measured: of the 22 fields `AudioConfig` declares, **20 are read by the
pipeline and 2 are not**.

| knob | why it is inert |
|---|---|
| `onset.post_max` | The peak-pick window is no longer *chosen*. `peak_window_frames` derives it per take from the smallest note gap the score and `target_bpm` imply, and passes the one number to librosa as **both** `pre_max` and `post_max`. `pre_max` survives as the cap on that; `post_max` is read by nothing. |
| `alignment.slur_tolerance_pct` | The threshold for the whole-slur duration check in spec §4, which was never built. `alignment.py` says so itself on `is_slur_boundary`. What exists is `is_slur_interior`, which *excludes* those notes from the trend and the verdict rather than measuring a phrase against a tolerance. |

`post_max` is the one that would have cost time. It sits directly beneath
`pre_max`, reads as its pair, and `peak_window_frames`'s docstring is a long
argument about exactly this window — the measured table of *"window 3:
sixteenths 32/32 found; window 20: 4/32"* is the most consequential detector
finding in this repository. Anyone re-opening it would reach for both numbers.

**Neither is deleted and neither is wired up.** Removing a key is a decision
about the remote-config row a deployment may already be sending; wiring
`post_max` means deciding whether an asymmetric window is right, which is a
question for this session with the corpus and an ear, not for a commit that
cannot hear anything. What was wrong was that the file gave no sign: both sat
beside live values with a spec citation each. They now say so where the tuner
is looking, and `backend/app/tests/test_tuning_knobs.py` holds it — a *new*
dead knob fails, and so does a stale entry for one that has since been wired.

---

## 2026-09-04 — Baseline: what the pipeline says about all six corpus clips today

**Nothing in `config.toml` changed.** This is the corpus read out, so the
tuning session that is still waiting on real recordings has a stated starting
point rather than a memory of one.

Each clip analysed through `analyze()` with its own `manifest.json` entry — the
score it was played from, its `target_bpm`, its `double_bass` flag — on the
shipped config:

    clip                  direction  quality  verdict
    01_detache_clean      on         0.988    Steady tempo — you held it within
                                              tolerance across the piece.
    02_detache_rushing    rush       0.988    You rushed across measures 2–8 by
                                              an average of 9 BPM.
    03_detache_dragging   drag       0.988    You dragged across measures 3–8 by
                                              an average of 9 BPM.
    04_slurred            on         0.990    Steady …
    05_open_e_long        on         1.000    Steady …
    06_pizzicato          on         0.990    Steady …

**Every one matches what the manifest's `expect` field says in words**, which
had never been checked either way. `04_slurred` at 0.990 is the one worth
noting: `build_timeline`'s comment records it scoring **0.196** and reporting
`alignment_failed` while an onset was expected under every bow stroke, so
slurred playing could not be analysed at all.

### A test over this, written and reverted

I wrote `test_tuning_corpus.py` to hold the table above, on the argument that
the corpus is the artefact the whole tuning story rests on and nothing ran it —
`test_cli.py` prints one line from one clip, `test_audio.py` borrows another as
a block of audio to filter, and `test_analysis.py` synthesises its own clicks
in-test.

Then I mutated the pipeline to find out what it was holding. Five mutations,
each run against the new file alone and against the suite without it:

| mutation | existing suite | corpus file |
|---|---|---|
| inner bands 5% → 40% (nothing is ever rushing) | 10 failures | 2 |
| an onset expected under a bow stroke again — the slur bug | **7 failures** | 2 |
| `wait_ms` 60 → 5 | 0 | 0 |
| `delta` 0.07 → 0.005 | 1 | **0 — passes** |
| `pre_emphasis_coef` 0.97 → 0.0 | 1 | **0 — passes** |

Not one unique catch, and the last three are the reverse of what I predicted: I
expected real timbre — a decaying bow stroke, pizzicato ring, a two-second open
E — to be *more* sensitive to detector settings than a synthesised click track,
and it is less.

Its docstring also claimed the slur fix was held by nothing. Seven tests hold
it, including `test_alignment.py::test_a_slurred_passage_played_as_written_
aligns_perfectly`. That claim was written from CLAUDE.md's account of the bug
rather than from measurement, and measurement contradicted it.

So the file was reverted, and the `direction` field it added to
`manifest.json` with it — an unread field is the same debt one level over.
Same call as two other tests dropped today, for the same reason: a test that
adds no discrimination makes the next person believe the corpus is guarded when
the guarding lives somewhere else.

**What would change that.** When real recordings replace the synthetic clips,
nothing else in the suite will touch those files, and a test saying "the corpus
still reads as its manifest describes" earns its place then. Writing it now, to
be useful later, is how unread code gets made.

---

## 2026-09-04 — Measured: how far the steady band can be narrowed before a perfect take is accused

**Nothing in `config.toml` changed.** This records a measurement that the
pending Batch 3 tuning needs, and corrects a piece of reasoning I had wrong.

### The clip

`fixtures/audio/app_encoder_click_track_48k.wav` — 8 bursts 0.5 s apart, which
is 8 quarter notes at exactly 120 BPM, written by the app's own
`encodeWavBytes`. Judged against a two-bar 4/4 score at a target of 120. The
take is **perfectly in time by construction**, so anything but "steady" is the
pipeline accusing a musician who did nothing wrong.

### `tolerance.rushing_inner_pct` and `dragging_inner_pct`, walked down together

    5.0 (shipped)  Steady tempo — you held it within tolerance across the piece.
    4.0            Steady
    3.0            Steady
    2.0            Steady
    1.5            Steady
    1.0            Steady
    0.5            "You rushed across measures 1-2 by an average of 2 BPM."

**Roughly five times the headroom under the shipped value.** `quality` is
0.975 at every one of them — the inner band moves the sentence, not the score.

### The reasoning I had wrong

I expected the floor near **6%**. The detector reports these attacks +10 to
+31 ms late (`test_app_encoder_wav.py` tabulates all eight), and 31 ms is 6.2%
of a beat at 120 BPM, so it looked as though narrowing past that would accuse
everyone.

It does not, because a *constant* lateness never reaches the bands:
`to_timeline_base` re-zeros the detected onsets on the first of them, and
`pulse_anchors` re-anchors after a disturbed run. Only the **spread** survives
— about 10 ms here — and that is what sets the floor between 0.5% and 1.0%.

Worth writing down because it points the other way from the obvious reading of
the detection times: the detector's absolute bias is not a constraint on
tuning, and its jitter is much smaller than that bias.

### Two things this does not say

It is one synthetic clip of eight identical bursts — the cleanest possible
input, and no substitute for the real recordings the tuning is actually
waiting on. And the outer bands were not walked; only the inner one, which is
the boundary between "steady" and being told something.

---

## 2026-09-02 — Measured: the onset detector is amplitude-invariant. One new threshold, and it is zero.

**Nothing in `config.toml` changed.** No clip moved, because nothing the
pipeline does was altered — this entry records a *measurement* that decided a
new threshold in the app, and corrected a sentence the pipeline was telling
musicians.

### The measurement

Every fixture, scaled to a series of peak levels and **requantised to 16 bit at
each one** — a float scaled to -90 dBFS is not the same object as one that
survived a WAV file, and the app uploads WAV. Onset counts from
`detect_onsets` under the shipped config:

    fixture                              0dB  -20  -40  -50  -55  -60  -65  -70  -80  -90
    01_detache_clean.synthetic            32   32   32   32   32   32   32   32   32   32
    02_detache_rushing.synthetic          32   32   32   32   32   32   32   32   32   32
    03_detache_dragging.synthetic         32   32   32   32   32   32   32   32   32   32
    04_slurred.synthetic                   8    8    8    8    8    8    8    8    8    8
    05_open_e_long.synthetic               1    1    1    2    1    1    1    1    1    1
    06_pizzicato.synthetic                16   16   16   16   16   16   16   16   16   16

At -90 dBFS the samples are barely more than one LSB and the reading is
unchanged. The single cell that moves — `05_open_e_long` reading 2 at -50 dBFS
— is a one-note clip whose reading was never stable enough to build on.

Then the shapes that are not music, ten seconds each:

    digital silence          0 onsets
    silence + 1 LSB dither  11 onsets
    white noise -60 dBFS    10 onsets
    white noise -20 dBFS    10 onsets
    DC offset only           0 onsets

**Level is not what separates a take with notes in it from one without.**
`onset_strength` differences a dB-scaled mel spectrogram, so scaling a waveform
shifts every frame by the same constant and the differencing removes it. The
detector is amplitude-invariant by construction, and the measurement is the
construction showing through.

### What it changed

1. **The `no_onsets` message said "try re-recording a bit louder."** That is
   advice that cannot work: the only recording that reaches `no_onsets` is a
   digitally silent one, and playing louder into a muted microphone produces
   the identical file. It now names the input. The same branch also fires when
   the *score* has no notes, where it was blaming a musician for a page the app
   failed to read — that case is now named first and separately.
2. **A new threshold in the app, `capturedNothing`, and it is exactly zero.**
   `mobile/src/lib/audio/level.ts` refuses a take whose every sample is zero,
   before the upload and before it costs one of three free monthly analyses.
   The measurement is what sets the value: since a take at the bottom of 16-bit
   resolution analyses exactly as well as a loud one, **any** non-zero floor
   would take a verdict away from a musician who could have had one. This is
   the rare threshold that is not a judgement call.

### What this does not claim

The fixtures are synthetic and normalised to 0.9 peak by `make_synthetic.py`,
so they say nothing about the level a real phone records a real violin at. They
do not need to: the finding is that level does not matter, which is a property
of the detector rather than of the corpus.

---

## 2026-09-02 — Two new thresholds in `[tolerance.pulse]`. Nothing existing moved.

**No existing value in `config.toml` changed, and all six clips are
bit-identical** — status, quality, note count, missed, extra, summed delta and
full verdict text. `02_detache_rushing` still reads "rushed across measures 2–8
by an average of 9 BPM".

### What the new values are for

The verdict measured every note from the first note of the take, so a musician
who held one bar was told every later bar dragged. The user chose the other
reading — *"one bar dragged, measure against your own pulse"* — which needs the
reference to re-anchor across a break in the pulse and **not** across a steady
drift. Those are a step and a ramp, and telling them apart is a threshold.

    disturbance_deviations  = 6.0     robust deviations of the take's own
                                      interval errors
    disturbance_floor_beats = 0.1667  a floor under that, as a fraction of a beat

### Why these numbers are not delicate

The two things being separated are twenty-five times apart:

    a steady rush (02_detache_rushing)        8 ms per beat, note after note
    a bar held a quarter longer than written  208 ms, on one interval

Six deviations sits in the middle of a very wide gap. The floor exists for a
different reason — a take played to machine precision has a median deviation
near zero, so a pure multiple would make the threshold zero and read *every*
interval as a disturbance. A sixth of a beat is "a musician who broke their
pulse by less than this did not break it".

### Behaviour, measured on offset series directly

    steady rush 8 / 30 ms per beat       accumulates untouched, every note
    steady drag 50 / 120 ms per beat     accumulates untouched
    played exactly                       zero throughout
    one 300 ms pause                     +300 ms on that note, zero after
    four notes held +200 ms (a slow bar) +200/+400/+600/+800, zero after
    rush → pause → rush                  the pause on its own note, and the
                                         rushing on both sides preserved
    steadily accelerating                accumulates quadratically, untouched

The fourth row is why the reference re-anchors after a **run** rather than a
single interval: a bar played slow is four stretched intervals, and absorbing
them one at a time would call the bar clean, which is the opposite mistake.

### Still unmeasured

Everything above is synthetic. What a real hesitation looks like on a real bass
— whether it is one long interval or a smear across three — is the thing that
decides whether six deviations is right, and only the six recordings can say.
Both values are starting points.

---

## 2026-08-31 — First measurements on a bass-like signal. No threshold changed.

**`config.toml` is untouched.** All six clips are bit-identical; nothing here
moved a number. This is evidence, filed against the open questions below.

### What had never been tested

`double_bass=True` switches on two things: a 4th-order high-pass at 80 Hz and
`delta` 0.07 → 0.05. It has had plumbing tests since it was wired up — does the
stored instrument reach `analyze()` — and no signal tests at all. Every audio
fixture in the repo is an 880 Hz decaying sine. That is five octaves above the
instrument the spec names in its first paragraph, with an attack no bow can
produce. The low-register path had never been shown a low register.

`app/tests/audio_helpers.py` now synthesises one: a Helmholtz sawtooth (bowed
strings are close to one, and the partials are what carries the attack once the
fundamental is filtered away), a 35 ms raised-cosine rise, a resonant room mode
at 58 Hz, and a −60 dBFS floor.

### Results

| clip | result |
|---|---|
| open E (41.2 Hz), 8 bowed notes at 60 BPM | 8/8 |
| open A (55 Hz) | 8/8 |
| open G (98 Hz), above the corner | 8/8 |
| scale, sixteenths at 72 BPM (208 ms apart) | 16/16 |
| scale, notes 100 ms apart (sixteenths at 150 BPM) | 15/16 |
| double-bass path vs default, same clip | never fewer |

**Detection lag ≈ +50 ms, and it is flat.** A bowed attack peaks in the flux
tens of milliseconds after the note starts, so every onset is reported late.
That is harmless if it is constant — `to_timeline_base` shifts the sequence to
a zero origin and a uniform offset cancels — and dangerous if it varies with
note density, because then it is reported as the musician speeding up at
exactly the bar where the writing changes.

Measured on a passage dead on the grid, quarters → sixteenths → quarters at
72 BPM:

    quarters    n=12   median lag  +46 ms   spread 21 ms   =  +5.5% of a beat
    sixteenths  n=16   median lag  +54 ms   spread 10 ms   =  +6.5% of a beat
    differential                    +9 ms                  =  +1.0% of a beat

1.0% of a beat, against an inner tolerance band of 5%. The lag is a constant,
and constants cancel. Pinned by a test at 3%.

### What this cannot settle, measured rather than assumed

**The high-pass corner is not constrained by any of it.** Moving it from 80 Hz
to 400 Hz leaves every test passing. That is a property of the signal: an
idealised sawtooth carries its attack across the whole spectrum, so throwing
half of it away costs nothing. A real bass's high partials are weaker and
noisier, which is precisely the difference that would make a wrong corner
audible.

**Nor can it show the filter helping.** The stated justification is rejecting
room-mode ring that fakes an onset (§7.5 problem 1/3). Swept the mode gain
0.55 → 3.0 with no filter, 80 Hz, and 400 Hz: **zero spurious onsets in all
nine combinations.** A linear resonance ringing down smoothly produces no flux
rise, so it never looks like an attack. A real room's early reflections are
discrete arrivals and would; this model has none.

So the high-pass remains unjustified by measurement in either direction. It is
also still the open question below — the spec contradicts itself about whether
the low register wants a *boost* (§1281) or a *high-pass* (§2490), and these
tests cannot break the tie.

### Standing open questions

1. **Boost or high-pass for double bass?** §1281 says boost 80–300 Hz; §2490
   says high-pass. The code high-passes. Needs the six clips and a human ear.
2. **The corner frequency**, per above. 80 Hz is the spec's number and nothing
   has tested it.
3. **`delta` 0.05 for the low register.** The only parameter these tests do
   constrain: raising it to 0.6 fails them. That is a floor, not a value.

All three need `01_detache_clean.wav` and the five after it. Recording them is
still the blocker, and no amount of synthesis substitutes for it.

---

## 2026-08-30 (last) — The peak-picking ceiling, resolved without a threshold change

**`config.toml` is untouched.** `pre_max` stays 20 and is now a *cap* rather
than the value. All six clips are bit-identical — they are all at 60 BPM, where
the derived window resolves to the cap and nothing changes.

### The ceiling, as arithmetic

`pre_max`/`post_max` make a peak the largest in a window, so a window wider than
the gap between two notes means the quieter of them is never reported. At 20
frames — **±464 ms**:

| note value | detectable below |
|---|---|
| quarter | 129 BPM |
| eighth | 65 BPM |
| triplet eighth | 43 BPM |
| **sixteenth** | **32 BPM** |

Nobody practises sixteenths at 32 BPM. Most étude and excerpt writing was
invisible. `librosa`'s own default for this sample rate is **1** frame.

### The corpus could not decide it, and that is a finding

Swept 1 → 20 frames across all six clips: **121/121 onsets, 0 spurious, at every
value**. The clips are all quarters or eighths at 60 BPM — gaps of 500–1000 ms,
where a 464 ms window suppresses nothing and there is no ring to over-detect.
The corpus cannot see this parameter at all.

### Why no constant works

The window is wide because it stops one note being detected twice. Probed
against the failure shapes the spec names:

| signal | window 3 | window 20 |
|---|---|---|
| ringing pizzicato | 8 hits / **8 spurious** | 8 / 0 |
| one note, heavy vibrato | 1 / 26 | 1 / 4 |
| sixteenths @ 100 BPM | **32/32 found** | **4/32 found** |

The wide window is doing real work. And no constant can do both, for an exact
reason: a **5.5 Hz ring beat is 182 ms apart** and **sixteenths at 100 BPM are
150 ms apart**. They are the same time scale, and nothing in the timing
distinguishes them.

Separating the two knobs was tried and failed — raising `pre_avg`/`post_avg`
(never configured; librosa defaults them to 100 ms) improved sixteenths from 12
spurious to 2, and did **nothing** for ring or vibrato.

### What the score already knows

It says which note values are written; `target_bpm` says how fast. The smallest
gap to expect is known before a sample is read. The window is now half of it,
capped at `pre_max`:

| signal | derived | fixed 20 |
|---|---|---|
| ringing pizzicato | 8/0 (window 20) | 8/0 |
| heavy vibrato | 1/4 (window 20) | 1/4 |
| sixteenths @ 100 BPM | **32/1** (window 3) | 4/0 |

Slow music is untouched because the derivation returns the cap there. Fast music
becomes detectable at all.

**Still synthetic.** The ring and vibrato signals are the failure *shapes* the
spec names, not recordings of them. What is not synthetic is the ceiling: a
window wider than the gap cannot report both notes, and that is arithmetic.

---

## 2026-08-30 (later) — Matching bounded. No thresholds changed, corpus unmoved.

`config.toml` untouched. All six clips identical to the entry below —
0.988 / 0.988 / 0.988 / 0.990 / 1.000 / 0.990, same onset counts, same worst
deviations. Every one of them is a full take at its target tempo, which is
exactly the case this change leaves alone.

### What it fixes

Matching normalised each sequence onto its own unit span. That is *unbounded*:
it stretches whatever it is given until the two ends line up, so it **asserts**
that the take covers the score. A musician who played the first half of a piece
had those notes smeared across all of it — every delta measured against the
wrong written note, reported confidently. On a 40-note score, a take of notes
0–19 mapped to written notes 0–39.

A clamped ratio of median inter-onset intervals cannot do that. The bound is
what makes it safe rather than merely different: reading a half take as a whole
one needs **2×**, reading every-other-note as a complete slow take needs
**0.5×**, and neither is reachable at [0.6, 1.7].

| case | span (was) | bounded (now) |
|---|---|---|
| perfect | 1.000 | 1.000 |
| 5% fast | 1.000 | 1.000 |
| 20% fast | 1.000 | 1.000 |
| gradual rush 13% | 0.725 | 0.725 |
| first half | 0.400 | **0.500**, and maps to 0–19 not 0–39 |
| every other note | 0.301 | **0.119** |
| WRONG PIECE | 0.248 | **0.000** |

Better or equal everywhere. Wrong-piece rejection improves most.

### Why there is a minimum take length

A median over two intervals is not a median, and a *missed* note inflates one —
`[0.5, 1.0]` medians to 0.75 and compresses a take that was played evenly. That
showed up as a real regression on a four-note test before the minimum went in.

It is also unnecessary below that length, and for the same reason it is
unreliable. The sliding error scaling exists to prevent grows with the take, so
at 20% fast:

| notes | unscaled | scaled |
|---|---|---|
| 3–6 | **1.00** | 1.00 |
| 8 | 0.38 | 1.00 |
| 32 | 0.09 | 1.00 |

Six notes or fewer match perfectly with no scaling at all. `expected` is built
at `target_bpm`, so below the crossover the score's own units are simply used.

### An alternative measured and rejected

Estimating the rate from a first DTW pass and refitting — more robust to a
missed note than a median, and it does fix the four-note case. It also **breaks
tempo-invariance**, which is the property the whole normalisation exists for: a
32-note take played 20% fast mapped to written notes 0–26 instead of 0–31,
because the first pass is exactly the sliding match the second pass is supposed
to be estimating from. Not adopted.

---

## 2026-08-30 — The whole corpus passes for the first time. No thresholds changed.

`config.toml` untouched. One correctness fix in `build_timeline`.

### Regression, all six clips, before → after

| clip | status | quality | expected | detected | worst dev |
|---|---|---|---|---|---|
| 01 détaché clean | ok → ok | 0.988 → 0.988 | 32 → 32 | 32 | 20.1 ms |
| 02 rushing | ok → ok | 0.988 → 0.988 | 32 → 32 | 32 | 256.8 ms |
| 03 dragging | ok → ok | 0.988 → 0.988 | 32 → 32 | 32 | 233.9 ms |
| **04 slurred** | **failed → ok** | **0.196 → 0.990** | **32 → 8** | 8 | — → 18.5 ms |
| 05 open E | ok → ok | 1.000 → 1.000 | 1 → 1 | 1 | 0.0 |
| 06 pizzicato | ok → ok | 0.990 → 0.990 | 16 → 16 | 16 | 20.1 ms |

Five clips are bit-identical. The sixth had never passed.

### Why it could never pass

`build_timeline` emitted an expected onset for every non-rest note, **including
the notes inside a slur**. A slur is one bow stroke: the notes under it are not
attacked and no onset will ever be detected for them.

`04_slurred` writes 32 notes, 8 of which are bow changes. The detector found
**all 8** — a perfect reading — and quality is weighted by coverage, so it could
not exceed 8/32 = 0.25. It scored 0.196 and reported `alignment_failed`.

Slurred playing could not be analysed at all, and slurring is not an edge case
on a bowed instrument. The clock still advances for those notes; only the
expectation of hearing them is dropped.

### The trade, stated plainly

A musician who bows every note separately against written slurs now produces 32
attacks against 8 expected, and **fails** where it previously produced a
verdict. Same for a page whose slurs the model invented.

That is a real cost and it is accepted for two reasons. It is a genuine
mismatch between the page and the playing — the spec files detecting those as
V2 — and the alternative was that the correct, common case never worked. The
failure is now told apart from a wrong page and says so: *"We heard every note
the score expects, and a lot more besides — this usually means the slurs on the
page aren't the ones you played."* Sending someone to re-photograph a score that
is fine would have been the worse error.

### An alternative measured and rejected

Computing quality *after* fuzzy matching, over the pairs that survive it, would
have removed the cost — détaché-against-slurs recovers from 0.000 to 0.750. It
also lets a **wrong piece** through: 32 random onsets scored 0.100 before and
**0.698** after, above the 0.4 broken threshold and nearly at the 0.7 warn line.
Fuzzy matching discards whatever does not fit, and eight points that fit a line
can always be found among thirty-two random ones. Not adopted.

---

## 2026-08-29 — Novelty bake-off. Flux kept. No thresholds changed.

**A negative result, and the corpus could not have produced a positive one.**
`config.toml` untouched.

The audit asked whether complex-domain or phase-based novelty (FMP C6S1) beats
librosa's spectral flux on the soft attacks a bowed double bass produces —
replace only if it wins under the same regression clips. It does not win.

Reproducible: `cd backend && uv run python ../tools/novelty-bakeoff.py`. The
four novelty functions are the FMP reference implementations written out in that
file rather than a `libfmp` dependency.

### The six clips cannot decide it

Hits / spurious against **the times the generator actually placed**, swept over
`delta` 0.02–0.2:

| clip | flux (current) | energy | phase | complex |
|---|---|---|---|---|
| 01 détaché clean | 32/0 | 32/0 | 6/27 | 32/0 |
| 02 rushing | 32/0 | 32/0 | 8/25 | 32/0 |
| 03 dragging | 32/0 | 32/0 | 3/30 | 32/0 |
| 04 slurred | 8/0 | 8/0 | 3/13 | 8/0 |
| 05 open E | 1/0 | 1/0 | 1/1 | 1/0 |
| 06 pizzicato | 16/0 | 16/0 | 4/13 | 16/0 |

Flux, energy and complex are **all perfect on all six**. Nothing beats 100%, and
that is the honest reading: these are click tracks with hard attacks, and the
comparison is about soft ones. The fixtures are at ceiling.

**A methodology error caught mid-experiment, recorded because it would have
inverted the conclusion.** The first run scored every clip against the
*metronomic* timeline, which made flux look poor on 02 and 03 — clips that drift
**on purpose**. It was measuring the drift, not the detector. Ground truth is
now reconstructed from `make_synthetic.py`'s own placement.

### Attack softness, which is the actual question

A 41 Hz bass tone, twelve notes, attack time constant swept. Hits of 12 /
spurious:

| method | 5 ms | 20 ms | 40 ms | 80 ms | 150 ms | 250 ms |
|---|---|---|---|---|---|---|
| **flux (current)** | 12/5 | 12/4 | 12/4 | **12/2** | **12/2** | **12/2** |
| energy | 12/0 | 12/1 | 12/3 | 12/3 | 12/3 | 8/7 |
| phase | 1/4 | 1/4 | 1/4 | 0/6 | 0/6 | 0/6 |
| complex | 12/3 | 12/3 | 11/4 | 9/6 | 6/7 | 4/9 |

**The hypothesis is refuted, and by the method it was about.** Complex-domain
novelty degrades *fastest* as the attack softens — 12 → 9 → 6 → 4 — while flux
holds every note and sheds spurious ones. On reflection the mechanism is
obvious: complex-domain novelty predicts steady state and measures the
deviation, and a very slow attack **is** close to steady state frame to frame,
so it spreads thin instead of peaking. Flux integrates magnitude increase, which
accumulates. Phase-based novelty is unusable throughout.

**Recommendation: keep `librosa.onset.onset_strength`.** No change made.

### What this does not say

Synthetic tone: no bow noise, no rosin, no vibrato, no room. It says which
method degrades first on a modelled attack, not what any of them do on a bow.
Re-run the tool when real recordings land — that is when it becomes evidence.

And it points elsewhere: the sweep over `delta` moved almost nothing, which is
consistent with the ±464 ms peak-picking window (2026-08-27 §2) being what
actually limits detection, not the novelty function. **The window is still the
first thing to attack with real clips.**

---

## 2026-08-28 — Matching made tempo-invariant. Regression across all six. No thresholds changed.

**Not a threshold change.** `config.toml` is untouched. Two correctness fixes in
the alignment and onset layers, regression-checked against all six clips as the
rule requires.

### Regression, all six clips, before → after

| clip | status | quality | detected | worst dev |
|---|---|---|---|---|
| 01 détaché clean | ok → ok | 0.988 → 0.988 | 32 → 32 | 20.1 → 20.1 ms |
| 02 détaché **rushing** | ok → ok | 0.872 → **0.988** | 32 → 32 | 256.8 → 256.8 ms |
| 03 détaché **dragging** | ok → ok | 0.872 → **0.988** | 32 → 32 | 233.9 → 233.9 ms |
| 04 slurred | failed → failed | 0.247 → 0.196 | 8 → 8 | — |
| 05 open E long | ok → ok | 1.000 → 1.000 | 1 → 1 | 0.0 → 0.0 |
| 06 pizzicato | ok → ok | 0.988 → **0.990** | 16 → 16 | 20.1 → 20.1 ms |

No status changed, no onset was gained or lost on any clip, and every worst
deviation is identical — the *measurements* are untouched. The two clips that
improved are exactly the two the change was aimed at.

### 1. Matching ran on absolute seconds, so rushing broke it

DTW compared raw times with a euclidean metric. A uniform tempo difference
makes the absolute gap grow along the piece, so the cheapest warp path is not
note-to-note but one that **slides** — further the deeper in. Measured on takes
played at a steady but different tempo, fraction of notes matched to the right
written note:

| | 2% fast | 5% fast | 10% fast |
|---|---|---|---|
| 32 notes | 78% | 31% | 16% |
| 64 notes | **39%** | 16% | 8% |

A musician who rushes is the entire audience for this app, and their notes were
being attributed to the wrong bars. Above ~5% the alignment failed outright and
told them to check they were on the right piece.

Each sequence is now put on its own unit span before matching. **Deciding which
onset is which note cannot depend on how fast it was played; deciding whether it
was early or late must** — and only the first is changed. `compute_deltas` still
works in real seconds, so the verdict reports the rushing the matching ignores,
which is pinned by a test.

Quality now removes a best-fit *line* (offset and rate) rather than a constant
offset. A tempo difference is a ramp, not an offset, so the old residuals grew
with the **square** of the take's length — 64 notes at 1% drift scored 0.514 and
quality had become a measure of how long the piece was.

By span, not by a tempo ratio from median inter-onset intervals: IOI scored
better on a wrong-piece take (0.000 vs 0.248) and much worse on the case that
actually harms someone — a take with every other note missing gets rescaled
until it looks complete, and a dropped-notes performance comes back as a
confident analysis of bars that were never played. Span keeps the real
correspondence and scores it 0.30, which fails honestly.

### 2. The recording beginning was being heard as a note

Onset strength is spectral flux; at the first frames the STFT compares against
its own zero-padding, and the step from padding into the room's noise floor is a
large positive flux. It fired at **0.070 s on every take with any noise floor at
all** — three frames in, at 41% of the envelope maximum — and only a signal
starting in perfect digital silence escaped it. That is why all six fixtures
missed it and why every real recording would have had it.

Being first, it became the alignment origin. On a dead-on-time bass take it
displaced the first note and produced *"You dragged across measures 3–4 by an
average of 59 BPM"* for someone playing perfectly.

The `n_fft // hop_length` frames the padding reaches — 93 ms — are silenced.
Bounded deliberately: the corpus's own clicks start at 200 ms, and a test holds
that a note there is still heard.

### Still open, and still needing a real instrument

- **The ±464 ms peak-picking window**, unchanged, still capping quarter notes at
  ~128 BPM. See the 2026-08-27 entry.
- **Noise-triggered false onsets.** With the deterministic boundary artifact
  gone, what remains is `delta` against a real room's noise floor. On a
  synthetic take with a long noise-only tail it still fires spuriously, and one
  spurious onset at an *end* skews the span the matching normalises by. This is
  the first thing the recordings will settle, and `06_pizzicato` will argue
  against raising `delta` because string ring is the opposite failure.
- **04_slurred cannot pass as things stand.** `build_timeline` emits an expected
  onset for every non-rest note including slur interiors, which produce no
  attack — 8 detectable attacks against 32 expected onsets caps coverage at
  0.25, and quality is coverage-weighted. Pre-existing, unchanged by today, and
  a design question rather than a threshold: the timeline and the detector
  disagree about what counts as an onset.

---

## 2026-08-27 — Dry run against a real-format file. No thresholds changed.

**Not a tuning result.** Preparation for one. The corpus is still six synthetic
click tracks; nothing here was measured on an instrument.

What was done: a 48 kHz **stereo 24-bit** file — the format an interface or a
phone actually produces — was dropped in as `01_detache_clean.wav` to walk the
path a real recording will take, then deleted. The synthetic clips are all
22.05 kHz mono, which is exactly what the loader wants, so resampling and
downmixing had never once been exercised. They work: librosa resolved 48k
stereo 24-bit to 22.05k mono without complaint, and `load_corpus` picked the
real file over the stand-in automatically.

Three things surfaced. One is fixed; two are for the session with real clips.

### 1. Fixed — the recording's clock was never put on the score's clock

`build_timeline` returns "seconds since start of the first note".
`detect_onsets` returns seconds since the **recording** started. Nothing
reconciled them before DTW, so a musician who tapped record, picked up the bow
and then played was compared against a score assuming they began instantly.

Measured on a perfectly played take — pure arithmetic, no audio, no fixture:

| lead-in | alignment quality |
|---|---|
| 0.5 s | 1.000 |
| 1 s | 0.908 |
| 2 s | 0.762 |
| 3 s | 0.566 |
| **5 s** | **0.053** — "check you're on the right piece and re-record" |

Not even monotonic through the audio path: 0.45 s passed, 0.50 s failed,
0.75 s passed, 1.5 s failed. Five seconds is tapping record, putting the phone
down and picking up the bow. All of them are 1.000 once both sequences share a
clock. `compute_deltas` already knew this — "the recording's lead-in latency is
not a timing error" — but it runs last, and the two stages before it did not.

Fixed in `alignment.to_timeline_base`, applied in both `analyze()` and
`analyze_with_diagnostics`. **This is a correctness fix, not a threshold
change; `config.toml` is untouched.**

### 2. To measure — the peak-picking window caps the playable tempo

`pre_max`/`post_max` are **20 frames each**. At hop 512 and 22.05 kHz a frame
is 23.2 ms, so the window is **±464 ms**. A peak has to be the maximum across
it, so notes closer together than that suppress one another.

Measured, 12 evenly spaced clicks:

| BPM (quarters) | gap | detected of 12 |
|---|---|---|
| 40–120 | 1500–500 ms | **12** |
| 132 | 455 ms | 7 |
| 160 | 375 ms | 2 |

A clean cliff exactly at the window. That is a ceiling of about **128 BPM in
quarter notes — roughly 64 BPM in eighths**. Kreutzer No. 2, in the app's own
demo library, is continuous sixteenths and sits far above it.

Untouched deliberately: it is a threshold, it needs the six real clips and the
regression rule, and `06_pizzicato` is the clip that will argue *against*
narrowing the window, since `wait_ms` and this window are what stop string ring
reading as extra onsets. **Check this first when the recordings exist.** It
also caught a test sitting on the cliff — `test_analyze_rushing_recording…` ran
at 132 BPM, so the detector saw 5 of 8 clicks and it passed at quality 0.430
against a 0.400 threshold. Moved to 110 against 100, where all eight are seen
and the test measures the verdict rather than the peak-picker.

### 3. To watch for — a spurious onset at the very start of a noisy recording

On the 48 kHz file, the detector fired an onset at **0.070 s** — about three
frames in, with the first real note at 0.500 s. It appears on the raw signal,
before the high-pass or pre-emphasis, so it is `librosa`'s peak-picker: at the
start of the signal the pre-window is truncated, so an early frame is trivially
a local maximum.

**It does not appear on the synthetic clips** and would never have been found
with them, because it needs a noise floor and they begin in digital silence. A
real room has a noise floor.

It matters because the first onset is now the alignment origin. On that file
the spurious mark was matched to the first written note, the *real* first note
was discarded as an extra, and a perfectly timed take reported "dragged by
25 BPM" — a confident wrong verdict where before there was an honest failure.

**Not fixed, deliberately.** Every candidate fix is a heuristic, and the only
evidence available today is one file fabricated this afternoon; DTW quality
cannot even tell the right origin from the wrong one (0.806 either way). This
is the first thing to look at on clip 01: the dashboard draws detected marks
against the waveform, so a stray mark before the first note is visible at a
glance. Leave about a second of room tone at the head of each take so it is
easy to see.

---

## 2026-08-16 — Tuning dashboard built. No thresholds changed.

**Not a tuning result.** The appendix's step 2 — build the readout before
touching a threshold — is now done, so the next entry in this file can be a
real one.

`backend/tuning_dashboard/` serves two pages: one clip in detail (waveform,
detected vs expected onsets, per-note deviation bars coloured by band, counts,
and the numbers pre-formatted for a tuning prompt) and all six at once, which
is what makes the regression rule cheap. Any tunable can be overridden per
request — `?onset.delta=0.05` — so three candidates can be compared without
editing `config.toml`. Nothing is written back; a value that wins gets moved by
hand, with an entry here.

`backend/app/services/diagnostics.py` exposes the pipeline's intermediate state
by calling the same functions `analyze()` calls with the same config object.
`test_diagnostics.py` asserts the two agree on status, verdict, quality and
every per-note delta — if they ever drift, the dashboard is measuring a model
of the pipeline rather than the pipeline.

**`config.toml` is untouched.** Every value is still the spec's §4 starting
number from the baseline entry below.

### The corpus is still missing, and that is what blocks the DoD

None of the six clips exist. `fixtures/audio/make_synthetic.py` generates click
tracks as stand-ins so the dashboard runs, and the UI labels every one of them
`synthetic`. They have exact known onset times — enough to show the dashboard
and the pipeline agree — and none of what a threshold actually has to survive:
bow noise, room reflection, a bass's slow attack, string ring.

### What the stand-ins show at the current (untuned) values

Useful only as a sanity check that the instrument reads:

| clip | detected / expected | missed | extra | worst | quality |
|---|---|---|---|---|---|
| 01 détaché clean | 32 / 32 | 0 | 0 | 20 ms | 0.988 |
| 02 détaché rushing | 32 / 32 | 0 | 0 | 257 ms | 0.872 |
| 03 détaché dragging | 32 / 32 | 0 | 0 | 231 ms | 0.872 |
| 04 slurred | 8 / 32 | — | — | — | 0.247 → `alignment_failed` |
| 05 open E 2s | 1 / 1 | 0 | 0 | 0 ms | 1.000 |
| 06 pizzicato | 16 / 16 | 0 | 0 | 20 ms | 0.988 |

Two observations that are about the synthesis, not the pipeline, and should not
be mistaken for findings:

- **The slurred clip failing alignment is by construction.** The generator
  gives slur-interior notes no attack at all, which is the honest worst case;
  8 detected against 32 expected is DTW correctly reporting it cannot align.
  The appendix expects this clip to fail in v1 on real audio too, but for a
  softer reason.
- **The 20 ms floor on the clean and pizzicato clips is frame quantisation**,
  not playing or detection error. librosa's default hop of 512 at 22.05 kHz is
  23.2 ms per frame, so no onset can be located more precisely than that. It is
  the resolution limit of the instrument and it bounds how tight the clean clip
  can ever look — worth knowing before reading ±15 ms as a target.

### A generator bug worth recording, because it looked like a pipeline finding

The first version of the synthetic notes cut the decay envelope off at a
non-zero value. A step discontinuity is a transient, so the detector fired on
every note's *end* as well as its start: 64 detections against 32 expected on
the dragging clip, 2 against 1 on the open E, and a phantom at the end of every
clip. It read exactly like a real over-detection problem that `wait_ms` should
have suppressed.

It was the fixture. The notes now fade to silence over their last 40 ms with a
raised cosine. The lesson generalises to the real recordings: a clip that stops
abruptly — a hard edit, a fade cut short — will produce phantom onsets that
look like a threshold problem and aren't.

## 2026-07-24 — Baseline: config.toml shipped with spec §4 STARTING values (untuned)

This is the starting point, not a tuning result. `backend/config.toml`
was created with the spec's default numbers, none of them yet validated
against real recordings:

- `onset.delta = 0.07`, `pre_max = 20`, `post_max = 20`, `wait_ms = 60`
- `onset.double_bass.delta = 0.05`, `highpass_hz = 80.0`
- tolerance bands symmetric: inner 5% / mid 10% / outer 20% (rushing == dragging)
- `alignment.warn_quality = 0.7`, `broken_quality = 0.4`, `sakoe_chiba_band = 0.2`
- `trend.window = 8`

**Not yet done (blocks closing the Batch 3 DoD):**
1. Record the six-clip corpus (01_detache_clean … 06_pizzicato) per the
   Tuning Appendix.
2. Set the tolerance bands empirically by ear (Appendix step 6). Expect
   the rushing/dragging bands to end up asymmetric — the config already
   has separate keys for each so tuning is a value change, no code edit.
3. Tune `delta` / `wait` against the slurred and pizzicato clips.

Every one of those changes gets its own entry below, with clip-by-clip
regression results. Until then, verdicts are directionally correct
(the pipeline is unit-tested) but the exact thresholds are provisional.

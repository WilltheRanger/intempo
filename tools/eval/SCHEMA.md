# Synthetic ground-truth take schema (v1)

What `synthetic_takes.py` writes for every rendered take, next to the audio
(never into the repo — see `README.md`). One JSON object per take.

```jsonc
{
  "schema_version": 1,
  "source_score": "fixtures/eval/tiny_phrase.json",   // path to the score JSON fed in
  "instrument": "violin",
  "target_bpm": 90,
  "soundfont": "mobile/assets/soundfonts/violin.sf2",  // see README for its license
  "injected_errors": [
    // the ground truth's own record of what was done to this take, in
    // generation order — not a summary, the actual error list the generator
    // applied. Shapes mirror the config the generator was called with.
    {"type": "tempo_drift", "from_measure": 5, "pct_per_bar": 2.0},
    {"type": "timing_offset", "global_index": 11, "ms": 80},
    {"type": "intonation_offset", "global_index": 11, "cents": 35},
    {"type": "intonation_offset", "measure_number": 3, "cents": -20},
    {"type": "wrong_note", "global_index": 20, "written": "F#4", "heard": "F4"},
    {"type": "missed_note", "global_index": 7},
    {"type": "extra_note", "after_global_index": 7, "pitch": "A4"},
    {"type": "restart", "at_global_index": 15},
    {"type": "accompaniment", "track": "piano", "level_db": -12},
    {"type": "degradation", "profile": "phone_mic_room"}
  ],
  "notes": [
    // one entry per note in the *expected* timeline (alignment.build_timeline),
    // in global_index order — the same indexing the analysis pipeline itself
    // uses, so a harness can zip this against AnalysisResult.per_note directly.
    {
      "global_index": 0,
      "measure_number": 1,
      "written_pitch": "A4",
      "expected_onset_s": 0.0,
      "played_onset_s": 0.0,       // null if missed_note
      "played_pitch": "A4",        // null if missed_note; differs from written on a wrong_note
      "cents_offset": 0.0,         // intonation offset actually applied, cents, signed sharp-positive
      "error_labels": []           // zero or more of: timing_offset, tempo_drift,
                                    // intonation_offset, wrong_note, missed_note, restart
    }
  ],
  "extra_notes": [
    // notes played that do not correspond to any expected note (error injection
    // "extra_note" entries), same per-note shape minus written_pitch/global_index
    {"after_global_index": 7, "played_onset_s": 2.1, "played_pitch": "A4", "error_labels": ["extra_note"]}
  ]
}
```

## Design notes

- **`notes` is keyed by the expected timeline's `global_index`**, the same
  value `alignment.ExpectedNote.global_index` and `AnalysisResult.per_note[].global_index`
  use, so comparing a real analysis run against this ground truth is a zip,
  not a re-alignment.
- **Timing and pitch errors are independent dimensions on the same note.**
  A note can carry both a `timing_offset` and an `intonation_offset`
  `error_label` at once; `wrong_note`, `missed_note` and `restart` are
  mutually exclusive with each other (a missed note has no played pitch to
  get wrong) but not with a timing or intonation label on a neighbouring
  note shifted by a restart.
- **`injected_errors` is the audit trail, `notes`/`extra_notes` is the
  per-event result.** Keeping both means a harness can either replay "what
  did the generator decide to do" or just check "is the per-note ground
  truth internally consistent" without re-deriving one from the other.
- Degradation (`phone_mic_room`-style profiles) and accompaniment mix are
  recorded as applied at the *take* level, not per note — they change the
  audio's acoustic conditions, not the labelled timeline.

Open for discussion before the generator is relied on for tuning — comment
on this file's PR if a field should move or a label is missing.

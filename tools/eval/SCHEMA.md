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
    // v1 addition (JERA-571): every field below is applied to the render,
    // not just labelled — see `render_take` and `README.md`.
    {"type": "vibrato", "rate_hz": 5.5, "depth_cents": 30},
    {"type": "bow_envelope", "attack_ms": 25, "decay_ms": 60},
    {
      "type": "degradation",
      "profile": "phone_mic_room",
      "band_low_hz": 300.0,
      "band_high_hz": 3400.0,
      "noise_snr_db": 20.0,
      "reverb_wet": 0.15,
      "reverb_decay_s": 0.25,
      "compression_ratio": 4.0,
      "compression_threshold_db": -18.0,
      "seed": 0
    }
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
- Degradation (`phone_mic_room`-style profiles), accompaniment mix, vibrato
  and bow envelope are all recorded as applied at the *take* level, not per
  note — they change the audio's acoustic conditions or its whole-signal
  shaping, not the labelled timeline. (A per-note `vibrato`/`bow_envelope`
  label was considered and dropped: every sounded note in a take gets the
  same bend/envelope treatment, so a take-level entry says exactly as much
  as a label on every note would, for one entry instead of N.)
- **This is still schema v1.** `vibrato`, `bow_envelope` and `degradation`'s
  new fields (JERA-571) are additions to the open-ended `injected_errors`
  list this file already described as "the generator's own record" with no
  closed set of shapes — no existing field changed meaning or was removed,
  so nothing reading `notes`/`extra_notes` or an older `injected_errors`
  entry breaks. `schema_version` stays `1`; it moves only if that stops
  being true.

Open for discussion before the generator is relied on for tuning — comment
on this file's PR if a field should move or a label is missing.

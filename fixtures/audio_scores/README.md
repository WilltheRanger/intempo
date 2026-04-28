# Audio-fixture score JSON

Each `fixtures/audio/<name>.{wav,m4a,…}` recording pairs with a score JSON at
`fixtures/audio_scores/<name>.json` so the tuning dashboard knows what
the recording is supposed to be playing.

Format: a serialized `app.services.score_schema.ScoreJson`. Quickest way
to author one is to run a known photo through `/v1/scores`, copy the
`score_json` from the response, save it here as the recording's stem.

For the spec's six tuning clips, the recommended pairings are:
- `01_detache_clean.json` — 8 quarter notes at 60 BPM
- `02_detache_rushing.json` — same notes as 01 (the clip drifts; the score doesn't)
- `03_detache_dragging.json` — same notes as 01
- `04_slurred.json` — at least 4 bars of slurred notes (slurs marked in score JSON)
- `05_open_e_long.json` — single whole note
- `06_pizzicato.json` — at least 4 bars of detached notes (pizz isn't in the schema; only timing matters)

If a per-recording score isn't provided, the dashboard falls back to
`default.json` in this directory.

# OCR-response fixture cache

Cached real `OCRResponse` JSON for each fixture image so the test suite
can validate against actual provider output without burning tokens on
every CI run. One file per fixture, keyed by SHA-256 of the image bytes.

Regenerate by running `_cache_ocr.py` (deleted after this initial run).
Each cache file: `{fixture_filename, fixture_sha256, cached_at, ocr_response}`.

| Fixture | sha256 (first 16) | Provider | Confidence | Measures | Notes | Cost (USD) | Latency (ms) |
|---|---|---|---:|---:|---:|---:|---:|
| `01_simple_printed.jpg` | `c786b0e04378f277…` | `gemini-2.5-flash` | 0.95 | 8 | 32 | $0.0050 | 9264 |
| `02_medium_printed.jpg` | `093d2a6a1dd866f9…` | `gemini-2.5-flash` | 0.95 | 4 | 36 | $0.0056 | 12360 |
| `03_complex_printed.jpg` | `bcf3ac293fc388d6…` | `gemini-2.5-flash` | 0.90 | 4 | 32 | $0.0054 | 9125 |
| `04_handwritten_clean.jpg` | `80336ff5e9757008…` | `gemini-2.5-flash` | 0.90 | 3 | 24 | $0.0039 | 6703 |
| `05_handwritten_messy.jpg` | `96197472c434b54e…` | `gemini-2.5-flash` | 0.50 | 0 | 0 | $0.0007 | 3093 |

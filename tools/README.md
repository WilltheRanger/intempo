# tools

Things you run by hand, not part of the app or the API.

## `build-scan-bench.py`

```sh
cd backend && uv run python ../tools/build-scan-bench.py
```

Builds `scan-bench.html` — one file, no server, no install. Open it, paste an
API key, drop in a photograph of sheet music, and see what the pipeline reads
off it, with the beat-sum check already applied.

**The prompt and the model registry are read out of the backend**, not copied
by hand: `app/prompts/ocr_prompt.txt` and the provider registries. A bench that
asks a different question than production answers a question nobody has, so if
the prompt changes or a model is repriced, the bench changes on the next build.

The key goes straight from the browser to Google or Anthropic — there is no
server here to send it anywhere else — and is kept in `localStorage` so it need
not be retyped. Calls cost real money: about $0.005 a page on Flash, $0.03 on
Sonnet.

**iPhone photographs work.** A HEIC is converted to JPEG through the browser's
own decoder, which means Safari on macOS and iOS; on Chrome or Firefox, which
cannot open one, it is passed to Gemini untouched because Gemini accepts the
format. Only Claude on a non-Safari browser has no route, and it says so in
those terms rather than returning an API error about an invalid request.

The same step scales anything over 2000px down and bakes EXIF rotation into the
pixels. Both matter: a 12-megapixel photo goes from ~3 MB to ~30 KB, which the
models downsample anyway and which you are otherwise billed for, and an iPhone
stores portrait orientation in EXIF rather than the pixels, so a page that is
not rotated arrives on its side and reads as gibberish.

## `build-validator-sandbox.py`

```sh
cd backend && uv run python ../tools/build-validator-sandbox.py
```

Builds `validator-sandbox.html` — one file, no server, no keys, no install.
Open it in a browser.

It runs the beat-sum check from `backend/app/services/ocr/validate.py` against
the cached OCR responses in `fixtures/ocr_responses/`, and the JSON is editable,
so you can break a measure by hand and watch the verdict change — including the
exact text the model would be sent on a retry.

**Why it exists.** The check is arithmetic: the durations in a measure must sum
to what the time signature holds. That needs no ground truth and no second
model, which is why it can run on every score. Whether it is doing something
sensible is much easier to judge by poking at it than by reading a diff.

**The JavaScript in it is a port**, and a port drifts. `test_sandbox_parity.py`
runs both implementations over the same cases and fails if they ever disagree,
so the sandbox cannot quietly start teaching rules the pipeline does not follow.
Edit `validator-sandbox.template.html`, never the generated file.

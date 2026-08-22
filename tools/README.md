# tools

Things you run by hand, not part of the app or the API.

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

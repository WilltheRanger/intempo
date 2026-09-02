"""A stand-in for the FastAPI backend, serving the shapes the real one serves.

The app reads through `data/sources`, and one flag decides whether that goes to
fixtures or to HTTP. Fixtures prove the components render; they prove nothing
about the adapter in `sources/api.ts` — the joins, the null handling, the
signed-URL plumbing. This is how that half gets exercised without standing up
FastAPI, Supabase, and a real OCR key.

    python mobile/scripts/stub-api.py                     # serves on :8123

    # then, in mobile/, with USE_FIXTURES flipped to false:
    EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:8123 \
      npx expo export --platform web --clear

Serves `/v1/me`, `/v1/scores` (with signed `image_url`s pointing at the repo's
own public-domain score images), `/v1/scores/:id`, and `/v1/analyses`
newest-first. The dataset is deliberately uneven: one score has an analysis
from today, one from three days ago, one from twelve, and one has none at all —
so "practiced today", relative dates, and the missing case are all on screen at
once.

Not a mock of the backend's *behaviour* — it validates nothing and enforces no
auth. It is a fixture with an HTTP interface.
"""
import base64, json, http.server, socketserver, pathlib, mimetypes
from datetime import datetime, timedelta, timezone

ROOT = pathlib.Path('/home/user/intempo/fixtures/scores')
NOW = datetime.now(tz=timezone.utc)
USER = "11111111-1111-1111-1111-111111111111"
BASE = "http://127.0.0.1:8123"

def iso(d): return d.isoformat()

SCORES = [
    ("aaaaaaaa-0000-0000-0000-000000000001", "60 Studies for the Violin, Op. 45", "Franz Wohlfahrt", "01_simple_printed.jpg", 3),
    ("aaaaaaaa-0000-0000-0000-000000000002", "Sonata No. 1 in G minor, BWV 1001", "J. S. Bach", "02_medium_printed.jpg", 0),
    ("aaaaaaaa-0000-0000-0000-000000000003", "Suite No. 1 in G major, BWV 1007", "J. S. Bach", "03_complex_printed.jpg", None),
    ("aaaaaaaa-0000-0000-0000-000000000004", "Caprice No. 24 in A minor", "Niccolò Paganini", "04_handwritten_clean.jpg", 12),
    # A scan in flight and a scan that failed. Both are states the app can only
    # reach against a real backend and both have their own screen, so without
    # them here the only way to look at either is to photograph a page and hope
    # it does the thing you wanted to see.
    ("aaaaaaaa-0000-0000-0000-000000000005", "Six Suites for Cello, BWV 1010", "J. S. Bach", "02_medium_printed.jpg", None),
    ("aaaaaaaa-0000-0000-0000-000000000006", "Études, Op. 20", "Jacques Féréol Mazas", "04_handwritten_clean.jpg", None),
]

READING_ID = "aaaaaaaa-0000-0000-0000-000000000005"
FAILED_ID = "aaaaaaaa-0000-0000-0000-000000000006"

#: The stages `transcription_runner.py` reports, in order, handed out one per
#: request so a poll actually watches something move rather than sitting on one
#: word for as long as you care to look.
STAGES = [
    "Fetching the page",
    "Finding the staves",
    "Checking the reading",
    "Reading the notation",
]
_stage_calls = {"n": 0}


def _reading_stage():
    """The next stage, holding on the last one rather than finishing.

    Deliberately never completes: a stub that flipped to `done` after four
    polls would make the finished screen the thing you always ended up looking
    at, and the reading screen the one you could never catch.
    """
    n = _stage_calls["n"]
    _stage_calls["n"] = n + 1
    return STAGES[min(n, len(STAGES) - 1)]


def _note(pitch, duration="quarter"):
    return {"pitch": pitch, "duration": duration, "articulation": None,
            "tied_to_next": False, "dynamics": None}


#: Four bars with something wrong in them, on purpose.
#:
#: Bar 3 holds five beats in a 4/4 bar — a missed barline, which is OCR's
#: characteristic failure and the one the score screen has to name. A stub
#: whose every bar added up would leave that path unrenderable.
DEMO_MEASURES = [
    {"measure_number": 1, "notes": [_note(p) for p in ("D4", "E4", "F4", "G4")], "slurs": []},
    {"measure_number": 2, "notes": [_note("A4", "half"), _note("G4"), _note("F4")], "slurs": []},
    {"measure_number": 3, "notes": [_note(p) for p in ("E4", "F4", "G4", "A4", "B4")], "slurs": []},
    {"measure_number": 4, "notes": [_note("D4", "whole")], "slurs": []},
]

# Keyed by score id. Only some music has movements, which is the point — the
# column is nullable and the UI has to cope with both.
MOVEMENTS = {
    "aaaaaaaa-0000-0000-0000-000000000003": "I. Prélude",
}

def score_row(sid, title, composer, img, _):
    reading = sid == READING_ID
    failed = sid == FAILED_ID
    transcribed = not reading and not failed
    confidence = 0.94 if sid != FAILED_ID else None
    # One score reads back as uncertain, so the "wasn't confident" line has
    # somewhere to appear. 0.62 is under the chain's own 0.7 threshold.
    if sid == "aaaaaaaa-0000-0000-0000-000000000004":
        confidence = 0.62
    return {
        "id": sid, "user_id": USER, "title": title, "composer": composer,
        "movement": MOVEMENTS.get(sid),
        "source_image_url": f"https://proj.supabase.co/storage/v1/object/sign/score-images/{USER}/{img}?token=expired",
        "image_url": f"{BASE}/img/{img}?token=signed",
        "image_url_expires_at": iso(NOW + timedelta(hours=1)),
        "score_json": {
            "time_signature": "4/4",
            "key_signature": None,
            "tempo_marking": "Andante" if transcribed else None,
            "bpm_hint": 84 if transcribed else None,
            # No clef until something has read the page, exactly as the backend
            # now writes it.
            "clef": "treble" if transcribed else None,
            "measures": DEMO_MEASURES if transcribed else [],
            "repeats": [],
            "ocr_confidence": confidence or 0.0,
            "notes_to_human": (
                "Bar 3 was hard to read; the beaming under the third beat is a guess."
                if sid == "aaaaaaaa-0000-0000-0000-000000000004"
                else ""
            ),
        },
        "shared_with_studio": None, "ocr_confidence": confidence,
        "transcription_status": "reading" if reading else "failed" if failed else "done",
        "transcription_stage": _reading_stage() if reading else None,
        "transcription_accepted_at": None,
        "page_image_discarded_at": None,
        "transcription_error": (
            "The notation could not be read from this photograph. "
            "A flatter, better-lit shot of the page usually fixes it."
            if failed
            else None
        ),
        "created_at": iso(NOW - timedelta(days=20)), "updated_at": iso(NOW - timedelta(days=20)),
    }

# Band edges, as a percentage of one beat, copied from `backend/config.toml`
# `[tolerance]`. Copied rather than invented: a stub that bands its own numbers
# differently from the pipeline would let a client bug hide behind a colour
# that only this file believes in.
INNER_PCT, MID_PCT, OUTER_PCT = 5.0, 10.0, 20.0


def _band(delta_pct):
    magnitude = abs(delta_pct)
    if magnitude < INNER_PCT:
        return "on"
    if magnitude < MID_PCT:
        return "slight"
    if magnitude < OUTER_PCT:
        return "rush_drag"
    return "severe"


def _direction(delta_pct):
    # Negative is early, which is rushing — the sign convention in
    # `services/analysis.py`.
    if delta_pct < 0:
        return "rush"
    return "drag" if delta_pct > 0 else "on"


def _result(deltas_by_measure, notes_per_measure=4):
    """An analysis result in the shape `services/analysis.py` emits.

    The deltas are given, not computed from audio — nothing here listens to
    anything. What this reproduces is the *structure*: per-note deltas banded
    by the thresholds above, per-measure summaries derived from them by the
    same rule as `_summarize_measures`, and a trend series. Empty lists were
    what stood here before, and they made the aggregation in `sources/api.ts`
    unreachable: the Insights tab reported "No practice recorded yet" against
    three finished analyses, because a take with no measures carries no timing
    to aggregate. The app was right; the stub was not.
    """
    per_note, per_measure = [], []
    index = 0
    for measure_number, avg in enumerate(deltas_by_measure, start=1):
        group = []
        for note in range(notes_per_measure):
            # Spread the notes either side of the measure's average so the
            # per-note view has something to show and the average still holds.
            delta_pct = round(avg + (note - (notes_per_measure - 1) / 2) * 1.5, 2)
            group.append(delta_pct)
            per_note.append({
                "global_index": index, "measure_number": measure_number,
                # One beat at 96 BPM is 625 ms.
                "delta_ms": round(delta_pct / 100 * 625, 1),
                "delta_pct": delta_pct, "band": _band(delta_pct),
                "direction": _direction(delta_pct), "is_slur_interior": False,
            })
            index += 1
        worst = max(group, key=lambda d: (_band(d) == "severe", _band(d) == "rush_drag",
                                          _band(d) == "slight"))
        per_measure.append({
            "measure_number": measure_number, "note_count": notes_per_measure,
            "avg_delta_pct": round(sum(group) / len(group), 2),
            "worst_band": _band(worst), "direction": _direction(avg),
        })

    # `classification.rolling_trend`: one value per *note*, not per measure, and
    # **rush-positive** — it negates `delta_pct` on the way in, which is the one
    # sign flip in the whole payload. Getting either wrong here is not a
    # cosmetic stub detail: a per-measure, drag-positive trend drew the line
    # sloping toward "Behind" on a take whose own measure rows said "Slight
    # rush", so the screen contradicted itself on one screenshot. `TrendLine`
    # documents its input as rush-positive and `sources/api.ts` deliberately
    # does not flip it, both correctly.
    window = 8
    values = [-n["delta_pct"] for n in per_note]
    trend = [round(sum(values[max(0, i - window + 1):i + 1])
                   / len(values[max(0, i - window + 1):i + 1]), 2)
             for i in range(len(values))]
    return per_note, per_measure, trend


def _finish(row):
    """Complete a polled analysis, honouring the injected outcome."""
    outcome = FAIL["outcome"]

    if outcome in ("failed", "failed_recoverable"):
        # No result_json at all — the row failed before there was anything to
        # write. `failure_reason` is what `analysis_runner._finish_failed`
        # stores, and it is a token rather than a sentence.
        row["status"] = outcome
        row["failure_reason"] = ("audio_unavailable" if outcome == "failed"
                                 else "stuck_swept")
        row["result_json"] = None
        return

    row["status"] = "done"
    if outcome in ("alignment_failed", "no_onsets"):
        # The pipeline ran to completion and reports what it heard. It writes a
        # sentence and no measures — `analysis.py` returns early with exactly
        # this shape.
        row["result_json"] = {
            "status": outcome, "quality": 0.2, "low_confidence": True,
            "verdict": ("We couldn't line your playing up with the score. "
                        "Start from the first note and play the passage through."
                        if outcome == "alignment_failed"
                        else "Your recording is completely silent — no sound "
                             "reached the microphone at all. Check which input "
                             "your device is recording from, and that nothing "
                             "is muting it, then record again."),
            "verdict_direction": "on", "per_note": [], "per_measure": [],
            "trend": [], "n_detected_onsets": 0, "n_expected_onsets": 32,
            "n_missed_notes": 32, "n_extra_notes": 0,
        }
        return

    per_note, per_measure, trend = _result(
        [-1.0, -2.5, -4.0, -6.0, -9.0, -12.0, -15.0, -13.0])
    # `warn_quality` is 0.7; below it the screen adds its caveat.
    quality = 0.55 if outcome == "low_confidence" else 0.88
    row["result_json"] = {
        "status": "ok", "quality": quality,
        "verdict": "You rushed as the passage went on.",
        "verdict_direction": "rush", "low_confidence": quality < 0.7,
        "per_note": per_note, "per_measure": per_measure, "trend": trend,
        "n_detected_onsets": len(per_note), "n_expected_onsets": len(per_note),
        "n_missed_notes": 0, "n_extra_notes": 0,
    }


#: One shape per seeded take, so the screens that read them are not all looking
#: at the same picture: a rushing take, a steady one, and a drifting one.
TAKE_SHAPES = {
    # Steady, then rushing from measure 5 — which is what the verdict says.
    "aaaaaaaa-0000-0000-0000-000000000001": (
        [-1.0, -2.0, -3.5, -4.0, -11.0, -14.0, -16.0, -12.0],
        "You rushed across measures 5 to 8.", "rush", 0.91),
    # Inside tolerance the whole way. The screens need a take with nothing
    # wrong with it, or "good" is a state nothing has ever rendered.
    "aaaaaaaa-0000-0000-0000-000000000002": (
        [1.0, -1.5, 2.0, 0.5, -2.0, 1.5, -0.5, 2.5],
        "Steady the whole way through.", "on", 0.95),
    # Dragging, and worse as it goes — the shape a tiring player makes.
    "aaaaaaaa-0000-0000-0000-000000000004": (
        [2.0, 4.0, 7.0, 9.0, 12.0, 15.0, 19.0, 23.0],
        "You dragged, and it grew through the take.", "drag", 0.78),
}

ANALYSES = []
for sid, _t, _c, _i, days in SCORES:
    if days is None:
        continue
    at = NOW - timedelta(days=days)
    shape, verdict, verdict_direction, quality = TAKE_SHAPES.get(
        sid, ([-1.0] * 8, "Steady the whole way through.", "on", 0.9))
    per_note, per_measure, trend = _result(shape)
    ANALYSES.append({
        "id": f"bbbbbbbb-0000-0000-0000-{sid[-12:]}", "user_id": USER, "score_id": sid,
        "assignment_id": None, "status": "done", "target_bpm": 96, "bpm_source": "manual",
        "metronome_mode": "off", "audio_url": "x", "error_message": None,
        "created_at": iso(at), "updated_at": iso(at),
        "result_json": {"status": "ok", "quality": quality, "verdict": verdict,
                        "verdict_direction": verdict_direction,
                        # `warn_quality` in config.toml is 0.7.
                        "low_confidence": quality < 0.7,
                        "per_note": per_note, "per_measure": per_measure, "trend": trend,
                        "n_detected_onsets": len(per_note), "n_expected_onsets": len(per_note),
                        "n_missed_notes": 0, "n_extra_notes": 0},
    })
ANALYSES.sort(key=lambda a: a["created_at"], reverse=True)

#: Scores created through POST during this run, and the upload URLs that have
#: actually had bytes PUT to them. Both in memory — this is a fixture with an
#: HTTP interface, not a database.
CREATED: dict = {}
UPLOADED: set = set()

#: Sizes of every audio PUT this run, in order. Read back at `/__uploads`.
UPLOAD_SIZES: list = []

#: Takes submitted through POST /v1/analyses during this run, keyed by id.
#: Separate from ANALYSES because these carry a `_polls` counter that drives
#: the queued → running → done transition and must never reach the client.
SUBMITTED: dict = {}


def _public(row):
    """A stored analysis without the stub's own bookkeeping."""
    return {k: v for k, v in row.items() if not k.startswith("_")}

#: Failure injection for the error-handling paths. `GET /__fail?status=500`
#: makes every subsequent /v1/* answer with that status; `status=0` clears it.
#: Without this there is no way to see what a screen says when the server is
#: broken, which is exactly the copy most likely to be wrong and least likely
#: to be exercised.
FAIL: dict = {"status": 0, "tier_limit": False, "outcome": "", "empty": False}

#: How a submitted take finishes. `GET /__fail?outcome=X` sets it; empty means
#: a normal successful analysis.
#:
#:   alignment_failed | no_onsets  — the pipeline ran and heard nothing usable.
#:                                   `result_json.status` says so and carries a
#:                                   sentence; there are no measures.
#:   low_confidence               — a real result, but below `warn_quality`
#:                                   (0.7 in config.toml), so the screen adds
#:                                   its caveat.
#:   failed | failed_recoverable  — the *run* failed. No `result_json` at all,
#:                                   and `failure_reason` is a machine token.
#:                                   The recoverable one is what the sweeper
#:                                   writes for a stuck row, specifically so a
#:                                   retry can be offered.
#:
#: None of these could be reached before: a take always succeeded, so four of
#: the five screens the app can show after a recording had never rendered.
OUTCOMES = ("alignment_failed", "no_onsets", "low_confidence",
            "failed", "failed_recoverable")

def _next_month():
    """The first instant of next month — what `tier_limits.month_bounds` returns."""
    return (NOW.replace(year=NOW.year + 1, month=1, day=1, hour=0, minute=0,
                        second=0, microsecond=0)
            if NOW.month == 12
            else NOW.replace(month=NOW.month + 1, day=1, hour=0, minute=0,
                             second=0, microsecond=0))


ME = {"id": USER, "email": "you@example.com", "tier": "free", "role": "student",
      "studio_id": None, "baseline_profile": {}, "created_at": iso(NOW - timedelta(days=60)),
      # `routers/me.py` returns this block on every call, and the profile
      # screen's quota row is driven by it. Omitting it made the row vanish and
      # look like an app bug, when the app was correctly declining to invent a
      # count the server never sent.
      "analyses": {"used": 2, "limit": 3, "remaining": 1, "resets_at": iso(_next_month())}}


def _b64(obj):
    """base64url with the padding stripped, the way JWT segments are encoded."""
    raw = json.dumps(obj, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _session(email=None):
    """A Supabase auth session, in the shape supabase-js stores and reads.

    The access token is a real JWT *shape* with a real `exp` — auth-js reads the
    payload to decide when to refresh — and a garbage signature, because nothing
    here verifies it and pretending otherwise would be worse.
    """
    address = email or ME["email"]
    exp = int((NOW + timedelta(hours=1)).timestamp())
    token = ".".join([
        _b64({"alg": "none", "typ": "JWT"}),
        _b64({"sub": USER, "email": address, "aud": "authenticated",
              "role": "authenticated", "exp": exp}),
        "stub-not-a-signature",
    ])
    user = {"id": USER, "aud": "authenticated", "role": "authenticated",
            "email": address, "email_confirmed_at": iso(NOW),
            "phone": "", "created_at": iso(NOW - timedelta(days=60)),
            "updated_at": iso(NOW), "app_metadata": {"provider": "email"},
            # A non-empty identities list: an *empty* one is Supabase's signal
            # that the address already has an account, and the sign-up screen
            # now reads it.
            "identities": [{"id": USER, "user_id": USER, "provider": "email",
                            "identity_data": {"email": address, "sub": USER}}],
            "user_metadata": {}}
    return {"access_token": token, "token_type": "bearer", "expires_in": 3600,
            "expires_at": exp, "refresh_token": "stub-refresh", "user": user}

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        # Load-bearing for the scan flow. A cross-origin PUT is preflighted,
        # and a preflight that doesn't name PUT makes the browser drop the
        # upload with "Failed to fetch" — an opaque message that looks like the
        # app's bug rather than the stub's.
        self.send_header("Access-Control-Allow-Methods",
                         "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Max-Age", "86400")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_OPTIONS(self): self._send(204, b"")
    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/__fail":
            from urllib.parse import parse_qs, urlparse
            q = parse_qs(urlparse(self.path).query)
            FAIL["status"] = int((q.get("status") or ["0"])[0])
            FAIL["tier_limit"] = (q.get("tier_limit") or ["0"])[0] == "1"
            outcome = (q.get("outcome") or [""])[0]
            if outcome and outcome not in OUTCOMES:
                return self._send(400, json.dumps(
                    {"detail": f"unknown outcome; try one of {list(OUTCOMES)}"}).encode())
            FAIL["outcome"] = outcome
            # A brand-new account: no pieces, no takes, no analyses. The first
            # thing anyone who signs up actually sees, and until this existed
            # there was no way to look at it — every seeded screen assumed a
            # library that was already full.
            if "empty" in q:
                FAIL["empty"] = q["empty"][0] == "1"
            return self._send(200, json.dumps(FAIL).encode())
        if FAIL["status"] and path.startswith("/v1/"):
            return self._send(FAIL["status"],
                              json.dumps({"detail": "injected failure"}).encode())
        if path == "/__uploads":
            # `?reset=1` clears the list. Sizes accumulate across runs
            # otherwise, and a diagnostic listing four takes from three
            # previous runs is a diagnostic nobody can read.
            if "reset=1" in self.path:
                UPLOAD_SIZES.clear()
            return self._send(200, json.dumps({"sizes": UPLOAD_SIZES}).encode())
        if path == "/v1/me":
            if FAIL["empty"]:
                fresh = dict(ME)
                fresh["analyses"] = {"used": 0, "limit": 3, "remaining": 3,
                                     "resets_at": iso(_next_month())}
                return self._send(200, json.dumps(fresh).encode())
            return self._send(200, json.dumps(ME).encode())
        if path == "/v1/scores":
            if FAIL["empty"]:
                return self._send(200, b"[]")
            # CREATED holds both new scores *and* edited copies of seeded ones,
            # so it overrides by id rather than appending — otherwise renaming a
            # seeded piece listed it twice, once under each name.
            rows = [CREATED.get(s[0]) or score_row(*s) for s in SCORES]
            seeded = {s[0] for s in SCORES}
            rows += [r for sid, r in CREATED.items() if sid not in seeded]
            rows.sort(key=lambda r: r["created_at"], reverse=True)
            return self._send(200, json.dumps(rows).encode())
        if path.startswith("/v1/scores/"):
            sid = path.rsplit("/", 1)[-1]
            row = CREATED.get(sid) or next(
                (score_row(*s) for s in SCORES if s[0] == sid), None)
            return self._send(200 if row else 404, json.dumps(row or {"detail": "not found"}).encode())
        if path == "/v1/analyses":
            if FAIL["empty"]:
                return self._send(200, b"[]")
            return self._send(200, json.dumps(
                [_public(a) for a in SUBMITTED.values()] + ANALYSES).encode())
        if path.startswith("/v1/analyses/"):
            aid = path.rsplit("/", 1)[-1]
            row = SUBMITTED.get(aid)
            if row is None:
                match = next((a for a in ANALYSES if a["id"] == aid), None)
                return self._send(200 if match else 404,
                                  json.dumps(match or {"detail": "not found"}).encode())
            # The pipeline takes real seconds, and the client polls every 1.5 s
            # for up to a minute. Advancing one step per poll exercises the
            # waiting state instead of handing back a finished analysis on the
            # first request — which is the only way to find out whether the
            # screen says anything while it waits.
            row["_polls"] += 1
            if row["_polls"] == 1:
                row["status"] = "processing"
            elif row["_polls"] >= 2 and row["status"] != "done":
                _finish(row)
            row["updated_at"] = iso(NOW)
            return self._send(200, json.dumps(_public(row)).encode())
        if path == "/auth/v1/user":
            return self._send(200, json.dumps(_session()["user"]).encode())
        if path == "/auth/v1/settings":
            return self._send(200, json.dumps({"external": {}, "disable_signup": False,
                                               "mailer_autoconfirm": True}).encode())
        if path.startswith("/img/"):
            f = ROOT / path.split("/img/")[1]
            if f.exists():
                return self._send(200, f.read_bytes(), mimetypes.guess_type(f.name)[0] or "image/jpeg")
        self._send(404, b'{"detail":"not found"}')

    # ---- writes -----------------------------------------------------------
    #
    # The scan flow is upload → create, and neither half could be exercised
    # against a read-only stub. These accept the real requests the app makes
    # and answer in the real shapes, so `lib/scan/uploadPage.ts` and
    # `hooks/useScan.ts` run their actual code paths.
    #
    # OCR is not simulated in any interesting way: it returns a fixed three-bar
    # score. Inventing plausible notes for whatever image arrived would make
    # this stub the one place in the repo that fabricates a transcription, and
    # a test that passes against fabricated notes tells you nothing.
    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length) if length else b""

    def do_POST(self):
        path = self.path.split("?")[0]

        # ---- Supabase Auth, enough of it to hold a session -----------------
        #
        # The app is only on live data when it has BOTH a Supabase project and
        # an API host, and that same predicate turns on the sign-in gate. So
        # pointing the app at this stub without answering auth would park it on
        # a sign-in screen that cannot succeed, and none of the live code paths
        # below would ever run.
        #
        # This is not a security model. It accepts any address and any password
        # and issues an unsigned token. It exists so `sources/api.ts`,
        # `lib/scan/*` and `hooks/*` can be exercised end to end on a laptop.
        # The real backend verifies tokens through JWKS and would reject every
        # one of these.
        if path in ("/auth/v1/token", "/auth/v1/signup"):
            body = json.loads(self._read_body() or b"{}")
            return self._send(200, json.dumps(_session(body.get("email"))).encode())
        # Magic link, password reset and resend all post here and all answer
        # {}: the mail is the response, and the app must not read the empty
        # body as a failure.
        if path in ("/auth/v1/otp", "/auth/v1/recover", "/auth/v1/resend"):
            self._read_body()
            return self._send(200, b"{}")
        if path == "/auth/v1/logout":
            return self._send(204, b"")

        if path in ("/v1/upload/score-image", "/v1/upload/audio"):
            body = json.loads(self._read_body() or b"{}")
            ext = (body.get("filename") or "page.jpg").rsplit(".", 1)[-1]
            bucket = "score-images" if "score-image" in path else "audio-uploads"
            key = f"{USER}/{len(UPLOADED) + 1}.{ext}"
            # The same shape and the same path grammar the backend's validator
            # requires: /storage/v1/object/upload/sign/<bucket>/<user>/<file>.
            url = f"{BASE}/storage/v1/object/upload/sign/{bucket}/{key}?token=stub"
            return self._send(200, json.dumps({
                "upload_url": url,
                "public_url": f"{bucket}/{key}",
                "object_key": key,
                "expires_at": iso(NOW + timedelta(minutes=5)),
            }).encode())

        # The free-tier refusal, in the exact shape routers/analyses.py sends:
        # a structured detail the client is meant to act on.
        if path == "/v1/analyses" and FAIL["tier_limit"]:
            self._read_body()
            return self._send(403, json.dumps({"detail": {
                "code": "tier_limit", "limit": 3, "used": 3, "tier": "free",
                "resets_at": iso(_next_month()),
            }}).encode())

        if path == "/v1/analyses":
            body = json.loads(self._read_body() or b"{}")
            # `_assert_audio_url_owned_by` rejects a URL outside the caller's
            # own storage prefix, and the client is meant never to send one.
            if not body.get("audio_url"):
                return self._send(422, b'{"detail":"audio_url is required"}')
            aid = f"dddddddd-0000-0000-0000-{len(SUBMITTED) + 1:012d}"
            at = NOW
            SUBMITTED[aid] = {
                "id": aid, "user_id": USER, "score_id": body.get("score_id"),
                "assignment_id": None, "status": "queued",
                "target_bpm": body.get("target_bpm") or 96,
                "bpm_source": body.get("bpm_source") or "manual",
                "metronome_mode": body.get("metronome_mode") or "off",
                "audio_url": body["audio_url"], "error_message": None,
                "failure_reason": None, "alignment_quality": None, "finished_at": None,
                "created_at": iso(at), "updated_at": iso(at),
                "result_json": None,
                # Not part of the response — bookkeeping for the poll below.
                "_polls": 0,
            }
            # 202, matching `create_analysis`: the work happens after the
            # response, which is the whole reason the client polls.
            return self._send(202, json.dumps(
                {"analysis_id": aid, "status": "queued"}).encode())

        if path == "/v1/scores":
            body = json.loads(self._read_body() or b"{}")
            image_url = body.get("image_url")
            if image_url and image_url not in UPLOADED:
                # Mirrors the real failure: the backend downloads the URL it was
                # given, and a URL nothing was PUT to cannot be read.
                return self._send(502, json.dumps(
                    {"detail": "image download returned status 404"}).encode())
            sid = f"cccccccc-0000-0000-0000-{len(CREATED) + 1:012d}"
            row = {
                "id": sid, "user_id": USER,
                "title": body.get("title") or "Untitled",
                "composer": body.get("composer"),
                "movement": body.get("movement"),
                "source_image_url": image_url,
                "image_url": f"{BASE}/img/01_simple_printed.jpg?token=signed" if image_url else None,
                "image_url_expires_at": iso(NOW + timedelta(hours=1)) if image_url else None,
                "score_json": {
                    "time_signature": body.get("time_signature") or "4/4",
                    "key_signature": "D major", "tempo_marking": None,
                    "bpm_hint": body.get("bpm_hint") or 92,
                    "clef": body.get("clef") or "treble",
                    "measures": [
                        {"measure_number": 1, "slurs": [], "notes": [
                            {"pitch": p, "duration": "quarter", "tied_to_next": False}
                            for p in ("D4", "E4", "F#4", "G4")]},
                        {"measure_number": 2, "slurs": [], "notes": [
                            {"pitch": p, "duration": "quarter", "tied_to_next": False}
                            for p in ("A4", "G4", "F#4", "E4")]},
                        {"measure_number": 3, "slurs": [], "notes": [
                            {"pitch": "D4", "duration": "whole", "tied_to_next": False}]},
                    ],
                    "repeats": [],
                    "ocr_confidence": 0.0 if image_url is None else 0.91,
                    "notes_to_human": "",
                },
                "shared_with_studio": None,
                "ocr_confidence": None if image_url is None else 0.91,
                "created_at": iso(NOW), "updated_at": iso(NOW),
            }
            CREATED[sid] = row
            return self._send(201, json.dumps(row).encode())

        self._send(404, b'{"detail":"not found"}')

    def do_PUT(self):
        path = self.path.split("?")[0]
        # Setting a new password after a reset link, and changing an email.
        # supabase-js emits USER_UPDATED on the response, which is what ends the
        # app's `recovering` state.
        if path == "/auth/v1/user":
            self._read_body()
            return self._send(200, json.dumps(_session()["user"]).encode())
        if "/storage/v1/object/upload/sign/" in path:
            body = self._read_body()
            if not body:
                return self._send(400, b'{"detail":"empty upload"}')
            UPLOADED.add(f"{BASE}{self.path}")
            # Byte count only, never the audio. A test asserting that a retry
            # re-sent *the same take* has to measure something, and
            # Playwright does not expose a Blob request body — so the
            # measurement happens where the bytes actually land.
            UPLOAD_SIZES.append(len(body))
            return self._send(200, json.dumps({"Key": path}).encode())
        self._send(404, b'{"detail":"not found"}')

    def do_PATCH(self):
        path = self.path.split("?")[0]
        if path.startswith("/v1/scores/"):
            sid = path.rsplit("/", 1)[-1]
            row = CREATED.get(sid) or next(
                (score_row(*s) for s in SCORES if s[0] == sid), None)
            if row is None:
                return self._send(404, b'{"detail":"score not found"}')
            body = json.loads(self._read_body() or b"{}")
            if not body:
                return self._send(400, b'{"detail":"patch body must include at least one field"}')
            if "title" in body:
                if body["title"] is None:
                    return self._send(400, b'{"detail":"title cannot be null; omit it to leave it unchanged"}')
                row["title"] = body["title"]
            # Explicit null clears it — the distinction the real router now makes.
            if "composer" in body:
                row["composer"] = body["composer"]
            if "movement" in body:
                row["movement"] = body["movement"]
            CREATED[sid] = row
            return self._send(200, json.dumps(row).encode())
        self._send(404, b'{"detail":"not found"}')

    def do_DELETE(self):
        path = self.path.split("?")[0]
        if path.startswith("/v1/scores/"):
            sid = path.rsplit("/", 1)[-1]
            if any(a["score_id"] == sid for a in ANALYSES):
                return self._send(409, json.dumps({"detail":
                    "score has dependent analyses; delete those first (soft-delete is V2)"}).encode())
            if CREATED.pop(sid, None) is not None:
                return self._send(204, b"")
            if any(s[0] == sid for s in SCORES):
                SCORES[:] = [s for s in SCORES if s[0] != sid]
                return self._send(204, b"")
            return self._send(404, b'{"detail":"score not found"}')
        self._send(404, b'{"detail":"not found"}')


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", 8123), H) as httpd:
    httpd.serve_forever()

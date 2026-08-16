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
import json, http.server, socketserver, pathlib, mimetypes
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
]

def score_row(sid, title, composer, img, _):
    return {
        "id": sid, "user_id": USER, "title": title, "composer": composer,
        "source_image_url": f"https://proj.supabase.co/storage/v1/object/sign/score-images/{USER}/{img}?token=expired",
        "image_url": f"{BASE}/img/{img}?token=signed",
        "image_url_expires_at": iso(NOW + timedelta(hours=1)),
        "score_json": {"time_signature": "4/4", "clef": "treble", "measures": [],
                       "repeats": [], "ocr_confidence": 0.94, "notes_to_human": ""},
        "shared_with_studio": None, "ocr_confidence": 0.94,
        "created_at": iso(NOW - timedelta(days=20)), "updated_at": iso(NOW - timedelta(days=20)),
    }

ANALYSES = []
for sid, _t, _c, _i, days in SCORES:
    if days is None:
        continue
    at = NOW - timedelta(days=days)
    ANALYSES.append({
        "id": f"bbbbbbbb-0000-0000-0000-{sid[-12:]}", "user_id": USER, "score_id": sid,
        "assignment_id": None, "status": "done", "target_bpm": 96, "bpm_source": "manual",
        "metronome_mode": "off", "audio_url": "x", "error_message": None,
        "created_at": iso(at), "updated_at": iso(at),
        "result_json": {"status": "ok", "quality": 0.91, "verdict": "You rushed across measures 5 to 8.",
                        "verdict_direction": "rush", "low_confidence": False,
                        "per_note": [], "per_measure": [], "trend": [],
                        "n_detected_onsets": 32, "n_expected_onsets": 32,
                        "n_missed_notes": 0, "n_extra_notes": 0},
    })
ANALYSES.sort(key=lambda a: a["created_at"], reverse=True)

ME = {"id": USER, "email": "you@example.com", "tier": "free", "role": "student",
      "studio_id": None, "baseline_profile": {}, "created_at": iso(NOW - timedelta(days=60))}

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_OPTIONS(self): self._send(204, b"")
    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/v1/me":
            return self._send(200, json.dumps(ME).encode())
        if path == "/v1/scores":
            return self._send(200, json.dumps([score_row(*s) for s in SCORES]).encode())
        if path.startswith("/v1/scores/"):
            sid = path.rsplit("/", 1)[-1]
            row = next((score_row(*s) for s in SCORES if s[0] == sid), None)
            return self._send(200 if row else 404, json.dumps(row or {"detail": "not found"}).encode())
        if path == "/v1/analyses":
            return self._send(200, json.dumps(ANALYSES).encode())
        if path.startswith("/img/"):
            f = ROOT / path.split("/img/")[1]
            if f.exists():
                return self._send(200, f.read_bytes(), mimetypes.guess_type(f.name)[0] or "image/jpeg")
        self._send(404, b'{"detail":"not found"}')

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", 8123), H) as httpd:
    httpd.serve_forever()

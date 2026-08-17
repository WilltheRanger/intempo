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

#: Scores created through POST during this run, and the upload URLs that have
#: actually had bytes PUT to them. Both in memory — this is a fixture with an
#: HTTP interface, not a database.
CREATED: dict = {}
UPLOADED: set = set()

ME = {"id": USER, "email": "you@example.com", "tier": "free", "role": "student",
      "studio_id": None, "baseline_profile": {}, "created_at": iso(NOW - timedelta(days=60))}


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
        if path == "/v1/me":
            return self._send(200, json.dumps(ME).encode())
        if path == "/v1/scores":
            rows = [score_row(*s) for s in SCORES] + list(CREATED.values())
            rows.sort(key=lambda r: r["created_at"], reverse=True)
            return self._send(200, json.dumps(rows).encode())
        if path.startswith("/v1/scores/"):
            sid = path.rsplit("/", 1)[-1]
            row = CREATED.get(sid) or next(
                (score_row(*s) for s in SCORES if s[0] == sid), None)
            return self._send(200 if row else 404, json.dumps(row or {"detail": "not found"}).encode())
        if path == "/v1/analyses":
            return self._send(200, json.dumps(ANALYSES).encode())
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
        if "/storage/v1/object/upload/sign/" in path:
            body = self._read_body()
            if not body:
                return self._send(400, b'{"detail":"empty upload"}')
            UPLOADED.add(f"{BASE}{self.path}")
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

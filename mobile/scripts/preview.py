"""Serve the exported app locally, including client-side navigation routes.

Run from any directory: python mobile/scripts/preview.py
Missing assets stay 404; extensionless app routes receive the app shell.
"""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


class AppHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        requested = Path(self.translate_path(self.path))
        route = urlsplit(self.path).path
        if not requested.exists() and not Path(route).suffix:
            self.path = "/index.html"
        return super().send_head()

    def end_headers(self):
        # A rebuilt preview must not reuse the previous app shell or bundles.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404, "File not found")
        return None


if __name__ == "__main__":
    exported = Path(__file__).resolve().parents[1] / "dist"
    if not (exported / "index.html").is_file():
        raise SystemExit("Build the web app first: npm run build:web")
    server = ThreadingHTTPServer(
        ("127.0.0.1", 8082), partial(AppHandler, directory=str(exported))
    )
    print("InTempo preview: http://127.0.0.1:8082", flush=True)
    server.serve_forever()

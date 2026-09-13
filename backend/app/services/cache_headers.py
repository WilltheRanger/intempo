"""What an uploaded object says about its own cacheability.

**Measured 2026-09-13: every object in every bucket was `no-cache`** — all 34
of them, across `score-images`, `avatars` and `audio-uploads`. Supabase stores
whatever `Cache-Control` an upload carries and serves it back on every
download; with none set the default is `no-cache`, so nothing the app showed
was ever cached by a browser.

The corpus was 71 MB. The egress it generated was in gigabytes, because a
screen that draws a page draws it again from storage every time: the Library
draws one image per row, and a single visit re-downloaded the lot.

**A year, and `immutable`, is safe here because keys are never reused.**
`routers/upload.py::_build_object_key` mints `<user_id>/<uuid4>.<ext>` for
every upload, so a re-shot page or a new avatar is a new object at a new key.
Nothing behind a cached URL can change under it. `immutable` additionally
spares the revalidation request a warm cache would otherwise send on each view.

The one key that is written twice is the display derivative
(`page_image.display_key_for`), upserted when a score is re-transcribed — and
that is a deterministic resize of the same photograph, so the second write is
the same bytes.

**`private` rather than `public`**, deliberately. These URLs carry a signature
and the bytes are one musician's sheet music and recordings. The browser that
asked for it may keep it; a shared proxy in between may not.
"""

from __future__ import annotations

#: `Cache-Control` for every object this app uploads.
#:
#: Keep in step with `mobile/src/data/api/upload.ts`, which sends the same
#: value on the client's direct-to-storage PUT — the uploads that do not pass
#: through this service at all.
CACHE_FOREVER = "private, max-age=31536000, immutable"

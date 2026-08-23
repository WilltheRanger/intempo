import os
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


#: Browser origins allowed by default — local development only.
#:
#: The web build is served on 8081 by `expo start` and on 8899 by the browser
#: test harness, while this API runs on 8000, so even a single laptop is
#: cross-origin. A checkout that required configuration before a request could
#: be made at all would start broken in a way that looks like the app being
#: broken.
#:
#: Safe to keep in production: a page on someone's own localhost can already
#: make any request their browser can, and cannot obtain a token it does not
#: have.
_DEV_ORIGINS = [
    "http://localhost:8081",
    "http://127.0.0.1:8081",
    "http://localhost:8899",
    "http://127.0.0.1:8899",
    "http://localhost:19006",
    "http://127.0.0.1:19006",
]


class Settings:
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_KEY: str = os.getenv("SUPABASE_KEY", "")
    SUPABASE_SERVICE_ROLE_KEY: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    OCR_PROVIDER_CHAIN: str = os.getenv(
        "OCR_PROVIDER_CHAIN", "claude-sonnet-5,claude-opus-5"
    )

    #: The local OMR engine, used as a second opinion rather than a first read.
    #:
    #: Not in the default chain: it is not installed by default, it takes
    #: minutes rather than seconds, and it is worse than a vision model on
    #: handwriting. Its value is that it is wrong in *unrelated* ways, so
    #: agreement with a vision model is evidence in a way that two vision reads
    #: agreeing is not. Add `omr-local` to OCR_PROVIDER_CHAIN to use it.
    #:
    #: Any binary taking `<image> -o <dir>` and writing MusicXML will do —
    #: oemer, homr and Audiveris all fit.
    OMR_COMMAND: str = os.getenv("OMR_COMMAND", "oemer")

    #: How to invoke it. `{image}` and `{out}` are substituted; there is no
    #: convention between engines to rely on:
    #:
    #:     oemer      {image} -o {out}
    #:     Audiveris  -batch -export -output {out} -- {image}
    OMR_ARGS: str = os.getenv("OMR_ARGS", "{image} -o {out}")

    #: How many pages may be read at once.
    #:
    #: **Not a throughput knob — a memory ceiling.** `BackgroundTasks` runs
    #: sync work in Starlette's threadpool, which holds **40** threads, so
    #: without this forty people scanning at once means forty simultaneous
    #: transcriptions. Measured: ~81 MB per in-flight scan on the vision path
    #: alone, mostly Pillow decode buffers — a 12 MP photograph is ~36 MB as
    #: RGB before anything copies it. Forty of those is 3.2 GB.
    #:
    #: Two is sized for a 512 MB instance: ~150 MB baseline plus 2x81 leaves
    #: headroom. Raise it on a bigger box; the arithmetic is the whole story.
    TRANSCRIPTION_MAX_CONCURRENT: int = int(
        os.getenv("TRANSCRIPTION_MAX_CONCURRENT", "2")
    )

    #: How many OMR engine runs may overlap. One, and deliberately.
    #:
    #: Audiveris peaks at ~328 MB reading a page system by system. Two at once
    #: is 656 MB and an OOM kill takes the whole instance down, not just the
    #: scan that caused it — so this is the difference between a slow scan and
    #: a dead server.
    OMR_MAX_CONCURRENT: int = int(os.getenv("OMR_MAX_CONCURRENT", "1"))

    #: How long a scan waits for an engine slot before giving up on the second
    #: opinion. The vision chain then answers alone, which is what happens on
    #: every install with no engine at all — so this degrades to the ordinary
    #: path rather than failing the page.
    OMR_QUEUE_TIMEOUT_S: float = float(os.getenv("OMR_QUEUE_TIMEOUT_S", "120"))

    #: Provider to read the page BEFORE the vision model, whose answer the
    #: vision model is then shown and asked to check. Empty disables the step.
    #:
    #: Enabled by default and harmless when the engine is not installed: the
    #: attempt costs one failed lookup on PATH and the chain proceeds as
    #: before. It is deliberately NOT in OCR_PROVIDER_CHAIN, because that chain
    #: stops at the first provider that succeeds, and this engine's reading is
    #: accurate but incomplete — returning it directly would be worse than the
    #: vision model alone. A second opinion, not a first answer.
    OMR_CONFIRM: str = os.getenv("OMR_CONFIRM", "omr-local")
    STRIPE_SECRET_KEY: str = os.getenv("STRIPE_SECRET_KEY", "")
    STRIPE_WEBHOOK_SECRET: str = os.getenv("STRIPE_WEBHOOK_SECRET", "")

    #: Origins allowed to call this API from a browser, comma-separated.
    #:
    #: Needed because the app and the API are never same-origin: 8081 against
    #: 8000 in development, and a Cloudflare Pages site against wherever this
    #: ends up hosted in production. Without a match the browser refuses every
    #: request before it is sent, which surfaces as "Failed to fetch" — a
    #: message that names neither the cause nor the fix.
    #:
    #: A deployment has to name its own origin. That is deliberate: a default
    #: that quietly allowed the production site would also allow every other.
    CORS_ALLOWED_ORIGINS: str = os.getenv("CORS_ALLOWED_ORIGINS", "")

    @property
    def cors_origins(self) -> list[str]:
        """The origin list, split and cleaned.

        **Empty means unconfigured, not "allow nothing".** Writing
        `CORS_ALLOWED_ORIGINS=` in a `.env` — which is exactly what a commented
        template invites, and what this repo's own `.env` briefly held — would
        otherwise refuse every browser request while looking like a setting
        somebody had considered. There is no reason to want zero origins: the
        headers are simply absent if nobody asks for them. So the empty case is
        always a mistake, and is treated as one.
        """
        configured = [
            origin.strip()
            for origin in self.CORS_ALLOWED_ORIGINS.split(",")
            if origin.strip()
        ]
        return configured or _DEV_ORIGINS


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

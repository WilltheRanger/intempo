import logging
import os
import re
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
log = logging.getLogger(__name__)

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
    #: How much this service says about what it is doing.
    #:
    #: **INFO, because WARNING is what it was and nobody chose that.** Nothing
    #: configured logging at all, so the effective level was Python's default of
    #: WARNING and the root logger had no handler of its own — uvicorn's is what
    #: carried anything through. Twenty-seven `log.info` calls were thrown away
    #: in production, including the pipeline's own account of what it read:
    #: "read 10 systems separately: 78 measures, 431 notes" is the one line that
    #: says whether reading a page a stave at a time works, and it never left
    #: the process.
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    #: Which models to try, in order, and what to do when one is not known.
    #:
    #: The default is spelled with current model names and has to be kept that
    #: way: a stale name here is not a slow path, it is a crash. This shipped
    #: reading `gemini-2.5-flash,claude-sonnet-4-6,claude-opus-4-7` — two names
    #: from the previous Claude generation — so `_default_chain()` raised
    #: "unknown provider" on the first scan and no photograph could be read at
    #: all, whatever keys were set. `/v1/ready` reports it now, and the chain
    #: skips names it does not recognise rather than taking the feature down.
    OCR_PROVIDER_CHAIN: str = os.getenv(
        "OCR_PROVIDER_CHAIN", "gemini-2.5-flash,claude-sonnet-5,claude-opus-5"
    )



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
        exact = [o for o in self._cors_entries() if "*" not in o]
        if not self._cors_entries():
            return _DEV_ORIGINS
        return exact

    def _cors_entries(self) -> list[str]:
        return [
            origin.strip()
            for origin in self.CORS_ALLOWED_ORIGINS.split(",")
            if origin.strip()
        ]

    @property
    def cors_origin_regex(self) -> str | None:
        """One pattern covering every `*.` entry, or None if there are none.

        **Cloudflare Pages gives a project more than one hostname.** There is
        the production alias, `https://project.pages.dev` — and then a distinct
        one for every deployment, `https://a16c6845.project.pages.dev`, plus a
        branch alias. The dashboard shows the deployment-specific URL most
        prominently after a build, so it is the one you are most likely to open,
        and an exact-match list does not cover it. The request is refused before
        it is sent and the only thing the browser can say is "Failed to fetch",
        which looks exactly like the API being down.

        Listing them one by one is not an option: a new one exists after every
        push. So an entry may name a subdomain wildcard —

            CORS_ALLOWED_ORIGINS=https://*.project.pages.dev,https://project.pages.dev

        — and only that. The `*` stands for one hostname label and nothing else:
        it cannot cross a dot, cannot appear in the scheme, and cannot be the
        whole host. `https://*` would allow every site on the internet to read
        this API with a musician's token, which is the mistake this shape exists
        to make unavailable.
        """
        patterns = []
        for entry in self._cors_entries():
            if "*" not in entry:
                continue
            scheme, _, host = entry.partition("://")
            if not host or not host.startswith("*.") or "*" in host[2:]:
                # Anything else is a wildcard this does not know how to make
                # safe. Dropped rather than guessed at, and named in the log.
                log.warning(
                    "CORS_ALLOWED_ORIGINS entry %r is not a supported wildcard "
                    "(only 'scheme://*.rest.of.host'); ignoring it",
                    entry,
                )
                continue
            patterns.append(
                re.escape(scheme) + r"://[^.]+\." + re.escape(host[2:])
            )
        if not patterns:
            return None
        return "^(?:" + "|".join(patterns) + ")$"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

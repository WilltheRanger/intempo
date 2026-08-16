# Why there is no `_redirects`

Cloudflare's build log, 2026-08-16:

```
Parsed 0 valid redirect rules.
Found invalid redirect lines:
  - #1: /*    /index.html   200
    Infinite loop detected in this rule and has been ignored.
```

The rule is the one Cloudflare's own SPA documentation gives, and their current
parser rejects it: a request for `/index.html` matches `/*`, rewrites to
`/index.html`, and canonicalises back to `/`, which matches `/*` again. So the
file shipped, the platform ignored it, and every build printed a warning.

**It was also protecting nothing.** The app has no `linking` config on
`NavigationContainer`, so React Navigation never touches the URL — navigating
to Library, Insights, Profile or a pushed screen leaves the address bar on `/`.
Verified by driving the built export and reading `page.url()` at each step.
There is no deep link to fall back for, and `/` is served natively by Pages
without any rule at all.

A file the platform rejects is worse than no file: it reads as protection that
isn't there, and it puts a warning in every build log, which is how you learn
to stop reading build logs.

## When it needs to come back

The moment `linking` is added — the first time a screen has its own URL, or a
score is shareable by link. At that point a refresh on `/scores` has to serve
`index.html` instead of 404ing, and the fallback becomes load-bearing.

Whatever goes in then must be **checked against the build log**, not assumed
from the docs. Options, in order of preference:

1. **`wrangler.toml` with `pages_build_output_dir`** — the build log explicitly
   looks for one (`Checking for configuration in a Wrangler configuration
   file (BETA)`). Not added now because the account has other Pages projects
   whose dashboard root-directory settings are unknown, and a committed output
   path would override them.
2. **Route-specific rules** rather than a bare splat, e.g. `/scores/*
   /index.html 200`, which doesn't match `/` and so can't trip the loop
   detector.
3. A `_worker.js` that serves the shell for unmatched paths.

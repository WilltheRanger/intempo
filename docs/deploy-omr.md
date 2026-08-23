# Running the OMR second opinion

The API works without any of this. When no engine is on `PATH` the second
opinion is skipped, the vision chain answers exactly as it did before, and
nothing fails. Everything here is optional.

## What it is

A rule-based OMR engine reads the page first, then a vision model is shown the
photograph **and** the engine's answer and asked to check it.

Measured on one real photograph of a cello part:

| | the page | oemer | Audiveris 5.4 |
|---|---|---|---|
| measures | ~25 | 5 | **15** |
| clef | bass | treble | **bass** |
| key | two flats | C major | **Bb major** |
| worst measure | 4 beats | 43.25 | 10 |
| time | — | ~6 min | **42 s** |

Audiveris is reliable about structure — clef, key, where the barlines are —
and incomplete. A vision model is the opposite: it sees every measure and
invents notes it cannot read. Neither is asked to do the other's job.

A correction that breaks measures which previously added up is refused, because
beat sums are not an opinion.

## Install it

```sh
backend/scripts/install-audiveris.sh
```

Then put the two lines it prints into `backend/.env`. The second is not
optional — every engine takes different arguments:

```
OMR_COMMAND=/path/to/bin/Audiveris
OMR_ARGS=-batch -export -output {out} -- {image}
```

In Docker, build with `--build-arg WITH_AUDIVERIS=1`. Without it the stage is
skipped and the image is unchanged.

## Check it

```sh
cd backend
uv run python scripts/read_page.py YOUR_PHOTO.png --provider omr-local
```

## Three things that will bite

**A 20-megapixel ceiling.** Audiveris refuses larger images outright and exits
*zero* while doing it. A phone photo is routinely 24-48MP, so it must be scaled
down before it reaches the engine. The provider reports the refusal in
Audiveris's own words.

**Java 25 from release 5.9 onward.** `install-audiveris.sh` builds v5.4, the
last release targeting Java 21. With a JDK 25, `AUDIVERIS_TAG=5.11.0` is
preferable and untested here.

**`javax.media:jai-core` is served only from `repository.jboss.org`**, which
some networks block. The script removes it: it is a declared dependency whose
only trace in the Audiveris source is a property-key string, and the maintained
fork `jai-imageio-core` is already there. `KEEP_JAI=1` leaves it alone.

## Turning it off

`OMR_CONFIRM=` (empty) in the environment. It is deliberately **not** in
`OCR_PROVIDER_CHAIN`: that chain stops at the first provider that succeeds, and
this engine's reading is accurate but incomplete, so returning it directly
would be worse than the vision model alone.

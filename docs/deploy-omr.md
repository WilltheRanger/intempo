# Running the OMR second opinion

**Measured, not estimated.** Audiveris 5.4 built from source and run on a
3024x4032 page — the shape a phone actually produces:

| long edge | time | peak RSS | result |
|---|---|---|---|
| 1568 px | 1.4 s | 159 MB | **fails** — "interline value of 10 pixels … resolution is too low" |
| **2048 px** | **9.3 s** | **517 MB** | transcribed |
| 2400 px | 10.5 s | 543 MB | transcribed |
| 3024 px | 15.4 s | 723 MB | transcribed |

Two things follow, and both are load-bearing.

## The engine cannot use the image the model gets

`prepare_for_model()` targets 1568 px, which is what a vision model sees after
Anthropic's own resizing — exactly right for the model, and **below the floor
Audiveris can work at**. Handing the model's copy to the engine does not make
the second opinion worse; it removes it, and reports the removal as an engine
that found nothing.

So `prepare_for_engine()` prepares the same photograph separately at 2048 px,
quality 95 and no chroma subsampling — the engine is thresholding thin black
lines out of a photograph, and subsampling smears exactly those edges. 2048 is
chosen over the original resolution because it reads the same page in 40% of
the time and 70% of the memory.

## Reading it one system at a time halves the memory

A page is cut into staff systems and each is read by its own engine run,
sequentially. Same page, peak RSS sampled from `/proc`:

| approach | time | peak RSS | measures |
|---|---|---|---|
| whole page at 2048 px | 9.5 s | 512 MB | 10 |
| all strips, one JVM | 19.1 s | 570 MB | 10 |
| **per system, end to end** | **31.2 s** | **328 MB** | **10** |

**Half the memory, the same measures.** The saving comes from the process
exiting between systems, which is also what the extra wall-clock buys — one JVM
start per strip. Batching every strip into a single invocation is the obvious
optimisation and is worse than both: Audiveris holds them all and peaks higher
than the whole page.

**Systems, not measures.** A measure crop is not readable on its own — the clef
and key live at the head of the system, so a bar lifted out of the middle of
one has neither and every pitch in it is a guess. Printed music repeats the
clef and key on every system, which is exactly what makes a system the smallest
piece that still means something by itself.

Cut at **full resolution**: a strip keeps the interline spacing of the
original, which is the measurement Audiveris refuses a page for lacking. So
slicing sidesteps the resolution floor instead of fighting it.

Pages that will not split — one system, a blank scan, or a projection that
finds texture rather than staves — are read whole, exactly as before.

## Which plan it needs

With per-system reading, 328 MB alongside the ~150 MB the Python service holds
is about 480 MB.

| Render plan | RAM | OMR |
|---|---|---|
| Free | 512 MB | marginal — ~480 MB of 512, no headroom |
| Starter | 512 MB | marginal, same |
| Standard | 2 GB | yes, comfortably |

Before per-system reading this was a flat no on anything under 2 GB. It is now
close enough to try on the plan you already have, with the honest caveat that
480 of 512 MB leaves nothing for a second concurrent scan — the worker reads
one page at a time, so that is a real constraint rather than a theoretical one.

The API works without the engine — one failed lookup on PATH, a log line, and
the vision chain answers as it always did — so this remains an upgrade bought
for a specific gain, not a bug to fix.

## What the gain actually is

Audiveris is accurate about structure and incomplete about coverage. On the
bundled fixtures it read the clef correctly every time, including **bass** on
the handwritten page, and found the time signature and key on the cleanly
printed one. It also stopped at 2-6 measures on excerpts a model reads in full.

That is why it is `OMR_CONFIRM` and not part of `OCR_PROVIDER_CHAIN`: the chain
stops at the first provider that succeeds, and stopping at the engine would
return less than the model alone. The engine reads first, the model is shown
the photograph *and* the engine's answer, and is asked to check it.

## Turning it on

```
docker build --build-arg WITH_AUDIVERIS=1 -t intempo-api ./backend
```

Then set, in the service's environment:

```
OMR_CONFIRM=omr-local
OMR_COMMAND=/opt/audiveris/bin/Audiveris
OMR_ARGS=-batch -export -output {out} -- {image}
```

To build it outside Docker, `backend/scripts/install-audiveris.sh` does the
same thing and prints the two variables. Both remove `javax.media:jai-core`,
which is served only from a repository many networks block and whose sole trace
in the Audiveris source is a property-key *string*.

Check it on a real page before trusting it:

```
cd backend && uv run python scripts/read_page.py YOUR_PAGE.jpg --provider omr-local
```

## Known limits

- **20 megapixels.** Audiveris refuses a larger page outright. A phone shoots
  12-48 MP, so this is the first thing a real photograph hits —
  `prepare_for_engine()` caps it.
- **It exits zero on failure.** `omr_provider.py` treats "finished but wrote no
  MusicXML" as an error for this reason.
- **No OCR languages installed.** Audiveris logs `*** No installed OCR
  languages ***` and reads notes anyway; it is text (titles, directions) that
  is skipped. Adding Tesseract language data would fix it and is not needed for
  rhythm.

---

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

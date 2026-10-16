# Hero photographs

Full-bleed photographs behind screens. Product content, unlike
`../captures/` and `../fixtures/`.

| file | screen | source |
|---|---|---|
| `signin-hero.jpg` | Sign in (redesign), the turntable photo | **Kevin McCutcheon on Unsplash** (`kevin-mccutcheon-TcSckNRL9J8-unsplash.jpg`). Keep this credit. |
| `library-strings-shade.webp` | Library, the Continue band: inside a grand piano, the strings and a brace, as a shade map | **Unsplash**, chosen by the owner (2026-10-16). Photographer and link not yet recorded: add them here when known. |
| `piece-score-shade.webp` | Piece screen, the key band behind the title: an open score, close up, with pencil markings, as a shade map | **Unsplash**, chosen by the owner (2026-10-16): https://unsplash.com/photos/a-close-up-of-a-book-JRDLHxOs_DQ. Photographer not recorded: unsplash.com could not be reached from the session that added it. |

`today-hero.jpg`, the Today screen's rehearsal-room photograph, went with the
Today tab on 2026-09-30, when the Library became the first screen; it and the
piano photograph before it (`piano-keys.jpg`) are in git history.

`signin-hero.jpg` was scaled from 4000×6000 to 1290×1935 (JPEG q85): the width
of the largest iPhone screen at 3×. The original, as handed off, is in git at
`redesign/kevin-mccutcheon-TcSckNRL9J8-unsplash.jpg` before this move; decoded
at full size it is about 96 MB of memory for one background.

**The key band's two files are shade maps, not photographs** (2026-10-16).
Each is the photograph at 640 wide, turned into black with its alpha set to
the photograph's darkness (255 minus its grey value), saved as WebP with
alpha: `library-strings-shade.webp` 68 KB, `piece-score-shade.webp` 40 KB. The
band draws it over its key colour with ordinary blending, which is the
arithmetic of multiplying a grey photograph into that colour; see `KeyBand`.
The colour photographs they came from (`library-strings.jpg`, 1080×1616, and
`piece-score.jpg`, 1290×860) are in git history.

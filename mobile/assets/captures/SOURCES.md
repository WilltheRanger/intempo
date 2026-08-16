# Capture fixtures

Four page-shaped images standing in for camera output in the scanner and the
captured-pages review. Development fixtures only — nothing here ships as
product content.

## What these are

Each page is composed from the repo's own public-domain score strips in
`fixtures/scores/`, stacked as staves onto an A4-proportioned white page
(900×1273). The strips are real engravings; the page layout around them is
synthetic.

Sources used, all public domain (full provenance in
`fixtures/scores/SOURCES.md`):

- `01_simple_printed.jpg` — Wohlfahrt, *60 Studies for the Violin*, Op. 45,
  No. 1. Schirmer, 1905.
- `02_medium_printed.jpg` — Wohlfahrt, Op. 45, No. 28. Same edition.
- `03_complex_printed.jpg` — Kreutzer, *42 Études ou Caprices*, No. 2.
  Late-19th-century public-domain print.

`04_handwritten_clean.jpg` (Bach's BWV 1001 autograph) is deliberately not
used here: it carries an aged grey ground that bands visibly against the white
page when stacked with printed staves.

## Why they exist

The score strips are roughly 8:1 — single staff lines, not pages. Cropped into
a portrait viewfinder or a page thumbnail they read as an extreme macro shot of
two or three noteheads rather than a sheet of music. These composites give the
scanner and review screens something page-shaped to show, so the framing guide
and the page thumbnails can be judged honestly.

## Regenerating

Composed with Pillow: printed strips resized to the content width and centred
in evenly divided slots, 7–8 staves per page, with the strip rotation and
stave count varied per page so the four read as different pages. Margins are
10% horizontal, 9% top, 8% bottom. JPEG quality 80.

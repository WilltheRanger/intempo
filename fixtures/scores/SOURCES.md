# Fixture sources

Five public-domain sheet-music images for the OCR bake-off. Each is a single
line of music cropped from a public-domain PDF (IMSLP) or JPEG (Wikimedia
Commons), resized to 1200 px wide, JPEG quality 85, all under 100 KB.

## Per-file provenance

### 01_simple_printed.jpg
- **Work:** Franz Wohlfahrt (1833–1884) — *60 Studies for the Violin*, Op. 45,
  Book 1, Étude **No. 1** ("Allegro moderato"), continuous-eighth-note pattern,
  third musical staff line of the etude (a clean middle line with no titles or
  dynamics — just notes, the canonical beginner profile).
- **Edition:** G. Schirmer (New York), Schirmer's Library of Musical Classics
  Vol. 838, ed. Gaston Blay, 1905. Plate 17849.
- **Source URL:** https://imslp.org/wiki/60_Studies_for_the_Violin,_Op.45_(Wohlfahrt,_Franz)
- **Direct PDF:** https://vmirror.imslp.org/files/imglnks/usimg/2/24/IMSLP19882-PMLP46562-Wohlfahrt_Op_45_Bk_1.pdf
  (page index 2, rendered at 200 DPI, cropped to y=985..1140, x=110..1610)
- **License:** Public domain. Composer died 1884; the Schirmer edition is from
  1905 (pre-1929 → public domain in the US). IMSLP page tag: "Public Domain".

### 02_medium_printed.jpg
- **Work:** Franz Wohlfahrt — *60 Studies for the Violin*, Op. 45, Book 1,
  Étude **No. 28** ("Allegretto"), opening staff. Single line includes tempo
  marking, **f** dynamic, slurs, staccato dots, fingering numerals — matches
  the "mid-Wohlfahrt / mid-Suzuki" target profile.
- **Edition:** Same as above (Schirmer 1905, ed. Gaston Blay).
- **Source URL:** https://imslp.org/wiki/60_Studies_for_the_Violin,_Op.45_(Wohlfahrt,_Franz)
- **Direct PDF:** https://vmirror.imslp.org/files/imglnks/usimg/2/24/IMSLP19882-PMLP46562-Wohlfahrt_Op_45_Bk_1.pdf
  (page index 20, rendered at 200 DPI, cropped to y=1370..1580, x=90..1610)
- **License:** Public domain (same as 01).

### 03_complex_printed.jpg
- **Work:** Rodolphe Kreutzer (1766–1831) — *42 Études ou Caprices* for solo
  violin (composed 1796), Étude **No. 2**, the canonical continuous-sixteenth-
  note study. The first staff includes the original bowing instructions ("Pt.,
  firm staccato." over the first half; "Nut." at the change), accent marks (>),
  and slurred sixteenth groupings — exactly the "Kreutzer No. 2" reference the
  brief calls out.
- **Edition:** Late-19th / early-20th-century public-domain print (IMSLP file
  number `IMSLP01503` — the original public-domain scan, **not** the
  copyrighted Galamian/International edition). Plate marking "11718".
- **Source URL:** https://imslp.org/wiki/Études_ou_caprices_(Kreutzer,_Rodolphe)
- **Direct PDF:** https://vmirror.imslp.org/files/imglnks/usimg/0/0d/IMSLP01503-Kreutzer_Complete_Etudes.pdf
  (page index 3, rendered at 200 DPI, cropped to y=130..340, x=80..1580)
- **License:** Public domain. Composer died 1831; original publication 1796.
  IMSLP page tag: "Public Domain".

### 04_handwritten_clean.jpg
- **Work:** J. S. Bach (1685–1750) — Sonata No. 1 in G minor for solo violin,
  BWV 1001, **I. Adagio**, autograph manuscript fair copy (1720, Köthen).
  Single staff cropped from the middle of the first page; Bach's hand here is
  unusually clean and is widely cited as one of the most beautiful surviving
  composer manuscripts.
- **Image source:** Wikimedia Commons —
  `File:BWV1001 adagio autograph manuscript 1720.jpeg`.
- **File page:** https://commons.wikimedia.org/wiki/File:BWV1001_adagio_autograph_manuscript_1720.jpeg
- **Direct image URL:** https://upload.wikimedia.org/wikipedia/commons/c/c8/BWV1001_adagio_autograph_manuscript_1720.jpeg
  (4952×7648; cropped to y=2750..3300, x=200..4750 — the 4th of 11 staves)
- **License:** Public domain (PD-old-100; J. S. Bach died 1750). Wikimedia
  Commons license tag: "Public domain".

### 05_handwritten_messy.jpg
- **Work:** Ludwig van Beethoven (1770–1827) — sketches for the **second
  movement (Allegretto) of Symphony No. 7, Op. 92** (1812), from the **Petter
  Sketchbook**. Composer's hand at full working-sketch density: scratchy ink,
  multiple revisions, struck-out passages and overwriting on a single staff.
  This is the "messy / hard to read" reference the brief calls out as a
  fallback to a Beethoven sketchbook page when one isn't separately available.
- **Image source:** Wikimedia Commons (photographed at the Morgan Library &
  Museum, New York City) —
  `File:Sketches for the second movement of Symphony no. 7, op. 92, Beethoven, Petter Sketchbook, 1812, musical autograph - Morgan Library & Museum - New York City - DSC06691.jpg`.
- **File page:** https://commons.wikimedia.org/wiki/File:Sketches_for_the_second_movement_of_Symphony_no._7,_op._92,_Beethoven,_Petter_Sketchbook,_1812,_musical_autograph_-_Morgan_Library_%26_Museum_-_New_York_City_-_DSC06691.jpg
- **Direct image URL:** https://upload.wikimedia.org/wikipedia/commons/d/d6/Sketches_for_the_second_movement_of_Symphony_no._7%2C_op._92%2C_Beethoven%2C_Petter_Sketchbook%2C_1812%2C_musical_autograph_-_Morgan_Library_%26_Museum_-_New_York_City_-_DSC06691.jpg
  (5357×2600; cropped to y=350..650, x=200..5150 — the topmost of 8 staves on
  the page, the densest with revisions)
- **License:** Public domain (PD-old-100; Beethoven died 1827). Wikimedia
  Commons license tag: "Public domain".

## Substitutions / notes

- **Slot 5 ("messy"):** The brief specifies a Beethoven sketchbook page. The
  Petter Sketchbook page used here is exactly that — sketchbook material from
  1812 in Beethoven's hand. No substitution needed.
- **Slot 4 ("clean handwritten"):** A composer autograph (Bach's 1720 fair
  copy) was used rather than a modern hand-copy, because the brief explicitly
  prefers Wikimedia-hosted manuscript autographs and warns against generated
  handwriting.
- **Slot 1 ("simple printed"):** The crop is a clean middle line of Wohlfahrt
  Op. 45 No. 1 — pure eighth notes, no labels — to match "no advanced
  articulations" exactly. The first line of the etude (which has the title
  "Nº 1. Allegro moderato" and an `f` dynamic) was deliberately *not* used.
- **Source files are not committed.** Only the cropped JPEG fixtures and this
  SOURCES.md live in the repo. Re-run the URLs above to reproduce.

## Reproducibility (one-shot)

```python
import fitz, requests
from PIL import Image
import io

DPI = 200
TARGET_W = 1200

JOBS = [
    # (out_name, source_kind, url, page_index, crop_box)
    ("01_simple_printed.jpg", "pdf",
        "https://vmirror.imslp.org/files/imglnks/usimg/2/24/IMSLP19882-PMLP46562-Wohlfahrt_Op_45_Bk_1.pdf",
        2, (110, 985, 1610, 1140)),
    ("02_medium_printed.jpg", "pdf",
        "https://vmirror.imslp.org/files/imglnks/usimg/2/24/IMSLP19882-PMLP46562-Wohlfahrt_Op_45_Bk_1.pdf",
        20, (90, 1370, 1610, 1580)),
    ("03_complex_printed.jpg", "pdf",
        "https://vmirror.imslp.org/files/imglnks/usimg/0/0d/IMSLP01503-Kreutzer_Complete_Etudes.pdf",
        3, (80, 130, 1580, 340)),
    ("04_handwritten_clean.jpg", "jpg",
        "https://upload.wikimedia.org/wikipedia/commons/c/c8/BWV1001_adagio_autograph_manuscript_1720.jpeg",
        None, (200, 2750, 4750, 3300)),
    ("05_handwritten_messy.jpg", "jpg",
        "https://upload.wikimedia.org/wikipedia/commons/d/d6/Sketches_for_the_second_movement_of_Symphony_no._7%2C_op._92%2C_Beethoven%2C_Petter_Sketchbook%2C_1812%2C_musical_autograph_-_Morgan_Library_%26_Museum_-_New_York_City_-_DSC06691.jpg",
        None, (200, 350, 5150, 650)),
]
```

All output images are 1200 px wide, 85 % JPEG quality, downscaled with Lanczos.

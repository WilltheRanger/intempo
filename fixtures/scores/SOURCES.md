# Fixture sources

Five public-domain sheet-music images for the OCR bake-off (and later, the
Batch 2 regression suite). Each was rendered/cropped from a public-domain
PDF or JPEG to a single line of music at ~1200 px wide, 85 % JPEG quality,
under 100 KB. One-off sourcing script (`_fetch_fixtures.py`) was deleted
after generating these.

| File | Composer | Work | Source | License |
|---|---|---|---|---|
| `01_simple_printed.jpg` | Franz Wohlfahrt (1833–1884) | *60 Studies for the Violin*, Op. 45 — Étude No. 1, first line. Bilingual (German/English) instructions header included as it appears in the source. | IMSLP, page 3 of `IMSLP19882-PMLP46562-Wohlfahrt_Op_45_Bk_1.pdf` (Carl Fischer, n.d., pre-1923 reissue of the original 1880 publication). [Direct file URL](https://vmirror.imslp.org/files/imglnks/usimg/2/24/IMSLP19882-PMLP46562-Wohlfahrt_Op_45_Bk_1.pdf). [IMSLP page](https://imslp.org/wiki/60_Studies_for_the_Violin,_Op.45_(Wohlfahrt,_Franz)). | Public domain — composer died 1884 (>140 years ago); original publication 1880. |
| `02_medium_printed.jpg` | Franz Wohlfahrt | *60 Studies for the Violin*, Op. 45 — second system from page 23 of Book 1 (around Étude No. 22–24, deeper in the book where slurred sixteenth runs and chromatic fingerings appear). | Same PDF as `01`, different page. [Direct file URL](https://vmirror.imslp.org/files/imglnks/usimg/2/24/IMSLP19882-PMLP46562-Wohlfahrt_Op_45_Bk_1.pdf). | Public domain (same as above). |
| `03_complex_printed.jpg` | Rodolphe Kreutzer (1766–1831) | *42 Études ou Caprices* for solo violin (1796) — Étude No. 2 (`IIª`) opening line. Trills, slurs, and dotted rhythms visible. | IMSLP, "Kreutzer Complete Etudes" PDF — an early-20th-century PD edition (the early IMSLP file id `IMSLP01503` is a tell that this is the original public-domain scan, *not* the Galamian edition which is still in copyright). [Direct file URL](https://vmirror.imslp.org/files/imglnks/usimg/0/0d/IMSLP01503-Kreutzer_Complete_Etudes.pdf). [IMSLP page](https://imslp.org/wiki/%C3%89tudes_ou_caprices_(Kreutzer,_Rodolphe)). | Public domain — composer died 1831 (>190 years ago); original publication 1796. |
| `04_handwritten_clean.jpg` | Anna Magdalena Bach (1701–1760), copying J. S. Bach (1685–1750) | *Suites pour violoncelle* (BWV 1007–1012) — manuscript copy by Anna Magdalena Bach (no autograph survives). Single staff, bass clef, neat handwriting. | Wikimedia Commons. [File page](https://commons.wikimedia.org/wiki/File:Bach_-_Suites_pour_violoncelle_-_Manuscript_Anna_Magdalena_Bach.pdf). [Direct file URL](https://upload.wikimedia.org/wikipedia/commons/4/41/Bach_-_Suites_pour_violoncelle_-_Manuscript_Anna_Magdalena_Bach.pdf). | Public domain (PD-Old, life+70). The Commons page carries a Creative Commons Public Domain Mark 1.0. |
| `05_handwritten_messy.jpg` | Ludwig van Beethoven (1770–1827) | Sketches for the *String Quartet*, Op. 131 — composer's hand. Selected as the rough/sketchbook example because Beethoven's sketches are the canonical "barely legible" handwritten classical music. | Wikimedia Commons (sourced from the British Library, Add MS 38070, folio 51r). [File page](https://commons.wikimedia.org/wiki/File:Ludwig_van_Beethoven_-_Sketches_for_the_String_Quartet_Op._131._(BL_Add_MS_38070_f._51r).jpg). [Direct file URL](https://upload.wikimedia.org/wikipedia/commons/8/88/Ludwig_van_Beethoven_-_Sketches_for_the_String_Quartet_Op._131._%28BL_Add_MS_38070_f._51r%29.jpg). | Public domain — composer died 1827 (>195 years ago). |

## Substitutions / known imperfections

- **Slot 5** is the Beethoven Op. 131 sketch rather than something explicitly tagged "sketchbook page". The British Library catalog card describes the source as a sketch, and the visible content (sparse staves, crossings-out, fragmentary motifs) matches the "rough handwritten" intent — the title in the BL catalog uses "Sketches" rather than "sketchbook" but the asset is functionally identical for our purposes.
- **Slot 2** (Wohlfahrt mid-book) and **slot 3** (Kreutzer Étude II opening) each include a small visual bleed of the next system at the bottom edge. Tightening the crop further started cutting off slurs from the target staff. Realistic for phone-photo scenarios; the OCR prompt ("a single line of sheet music") should focus on the dominant staff.
- **Slot 4** (Anna Magdalena Bach copy) shows ink bleed-through from the previous system at the top edge — typical of period-paper manuscripts and again realistic.
- **Slot 1** (Wohlfahrt #1) keeps the bilingual German/English header text from the source ("Down-bow / Up-bow", "Hold the fingers down as long as possible"). Real-world phone photos will frequently include header instructions, so this is a feature, not a bug.

## Reproducibility

The exact crops used were:

| File | Source page | Render DPI | Fractional crop (left, top, right, bottom) |
|---|---|---|---|
| 01 | 0-indexed page 2 of Wohlfahrt Bk 1 | 220 | (0.05, 0.10, 0.97, 0.27) |
| 02 | 0-indexed page 22 of Wohlfahrt Bk 1 | 220 | (0.05, 0.20, 0.97, 0.275) |
| 03 | 0-indexed page 2 of Kreutzer Complete | 220 | (0.05, 0.34, 0.97, 0.42) |
| 04 | 0-indexed page 2 of Bach manuscript PDF | 220 | (0.05, 0.20, 0.97, 0.28) |
| 05 | the JPEG itself | n/a | (0.0, 0.05, 1.0, 0.30) |

All output images are 1200 px wide, 85 % JPEG quality, downscaled with Lanczos.

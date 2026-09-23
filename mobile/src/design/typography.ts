import type { TextStyle } from 'react-native';

// **Files in this repository, not the packages.** The packages' TTFs were
// 899 KB — 345 KB over the wire, 40% of the whole boot and second only to the
// JavaScript — and Inter ships 2,849 glyphs against the 335 the subset keeps.
// 88% of it was alphabets nothing renders.
// `tools/subset-text-fonts.py` cuts the four to 327 KB, which is 133 KB over
// the wire against 345 KB, and is how they are regenerated after a font bump.
// Measured on the whole boot set — the document, its scripts and these five
// files — that is 860 KB down to 648 KB.
//
// The packages stay in `package.json` because the script reads its input from
// them, and their OFL attribution in `data/licences.ts` stays because a subset
// is still the font. Nothing imports them at runtime any more.

/**
 * React Native resolves fonts by file, not by numeric weight — `fontWeight`
 * alone will not render Newsreader Medium. Each weight is a separately loaded
 * family, so styles name the family directly and never set `fontWeight`.
 *
 * Two weights per family, deliberately. Nothing in the design needs a third.
 */
export const fontFamily = {
  serifRegular: 'Newsreader_400Regular',
  serifMedium: 'Newsreader_500Medium',
  sansRegular: 'Inter_400Regular',
  sansMedium: 'Inter_500Medium',
  /**
   * Notation. **Not typography with an unusual alphabet** — a treble clef, a
   * quarter rest and a sharp are drawings with centuries of settled
   * proportion, and this is the reference font for them (Bravura, SIL OFL 1.1,
   * the font MuseScore ships). `engrave.ts` drew no clef at all rather than a
   * bad one; this is what lets it draw a good one.
   *
   * Subset to the forty glyphs this app uses — 22 KB rather than 889 KB. See
   * `tools/subset-bravura.py`, and `assets/fonts/Bravura-LICENSE.txt`.
   *
   * **Sized in staff spaces, never in points.** A SMuFL font puts four staff
   * spaces in one em, so a glyph drawn at `fontSize = 4 * lineGap` is exactly
   * the right size for that staff — which is the whole reason these are a font
   * rather than paths.
   */
  music: 'Bravura',
} as const;

/** One em of a SMuFL font is four staff spaces. */
export const MUSIC_EM_IN_SPACES = 4;

/**
 * Passed to `useFonts` at app start.
 *
 * All five are files in this repository and all five are subset — the text
 * faces by `tools/subset-text-fonts.py`, Bravura by `tools/subset-bravura.py`.
 *
 * **TTF rather than WOFF2, measured.** Subset WOFF2 is 30.1 KB against subset
 * TTF's 38.1 KB over the wire, because Cloudflare already brotli-compresses
 * TTF and WOFF2 is brotli internally. Eight kilobytes a file does not buy a
 * second font pipeline: WOFF2 works on neither iOS nor Android, so it would
 * mean platform-split loading for a web-only gain.
 */
export const fontsToLoad = {
  Newsreader_400Regular: require('../../assets/fonts/Newsreader_400Regular.ttf'),
  Newsreader_500Medium: require('../../assets/fonts/Newsreader_500Medium.ttf'),
  Inter_400Regular: require('../../assets/fonts/Inter_400Regular.ttf'),
  Inter_500Medium: require('../../assets/fonts/Inter_500Medium.ttf'),
  Bravura: require('../../assets/fonts/Bravura.otf'),
};

/**
 * The type scale. Serif is reserved for screen titles and composition titles;
 * everything functional — composers, metadata, labels, controls — is sans.
 *
 * `letterSpacing` is in points here, not em. Large serif sizes get a small
 * negative value so they set tightly; body sizes are left alone.
 */
export const typography = {
  /**
   * The one line on a screen that is the screen.
   *
   * **Only for type over a full-bleed image**, which today is the Today hero
   * and nothing else. It is nearly a third larger than `screenTitle`, and that
   * is deliberate: a photograph is a busy ground, and the size is what makes a
   * title read across it rather than sit on it. On the ivory page the same
   * size would simply shout.
   *
   * Serif regular at this size for the reason `screenTitle` gives — medium
   * reads heavy — and more so the larger it gets.
   *
   * Two lines of it fill a phone's width at a long classical title, which is
   * the common case rather than the edge: "Sonata No. 1 in G minor, BWV 1001"
   * wraps to two at 390pt and three at 320. The hero clamps it, because a
   * title that pushes its own button off the screen has stopped being a title.
   */
  displayTitle: {
    fontFamily: fontFamily.serifRegular,
    fontSize: 46,
    lineHeight: 50,
    letterSpacing: -1,
  },
  /** Screen titles. Serif regular — medium reads heavy at this size. */
  screenTitle: {
    fontFamily: fontFamily.serifRegular,
    fontSize: 36,
    lineHeight: 42,
    letterSpacing: -0.6,
  },
  /** The featured composition title. */
  heroTitle: {
    fontFamily: fontFamily.serifRegular,
    fontSize: 26,
    lineHeight: 31,
    letterSpacing: -0.4,
  },
  /**
   * Composition titles in lists. Medium, for presence against sans metadata.
   *
   * 19pt rather than 20: long classical titles ("60 Studies for the Violin,
   * Op. 45") dominated the row at 20. Still outranks the 16pt sans composer
   * by both size and serif weight. Leading is tight relative to the size so a
   * two-line title doesn't stretch the row.
   */
  pieceTitle: {
    fontFamily: fontFamily.serifMedium,
    fontSize: 19,
    lineHeight: 23,
    letterSpacing: -0.2,
  },
  /** Composer names. */
  composer: {
    fontFamily: fontFamily.sansRegular,
    fontSize: 16,
    lineHeight: 22,
  },
  /** Default UI copy. */
  body: {
    fontFamily: fontFamily.sansRegular,
    fontSize: 16,
    lineHeight: 24,
  },
  /** Dates, counts, supporting detail. */
  metadata: {
    fontFamily: fontFamily.sansRegular,
    fontSize: 14,
    lineHeight: 20,
  },
  /**
   * Metadata in dense contexts — list rows, counts.
   *
   * One step down from `metadata` so it sits clearly below the title and
   * composer above it, rather than competing with them.
   */
  metadataSmall: {
    fontFamily: fontFamily.sansRegular,
    fontSize: 13,
    lineHeight: 18,
  },
  /** Section labels. Sentence case — the brief rules out decorative uppercase. */
  /**
   * The label above a group of content.
   *
   * Small, uppercase and letterspaced, so it reads as a different *register*
   * from the content under it rather than as a smaller heading. That
   * separation is what lets a screen carry several groups without their labels
   * competing with the titles inside them.
   *
   * `letterSpacing` is absolute in React Native, not em: 1.1 is 0.10em at 11px.
   */
  eyebrow: {
    fontFamily: fontFamily.sansMedium,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 1.1,
  },
  sectionLabel: {
    fontFamily: fontFamily.sansMedium,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.1,
  },
  /**
   * The name on a list row — "Digital score", "Email", "Start at" — and the
   * value across from it. One size for every row in the app: they were 13
   * medium on Upload, 15 regular on Profile and Piece detail, 16 medium in the
   * Record sheet, and the same kind of line changed size from screen to screen.
   */
  rowLabel: {
    fontFamily: fontFamily.sansRegular,
    fontSize: 15,
    lineHeight: 20,
  },
  /**
   * The tab bar's labels: a small label under a larger glyph, the proportion
   * iOS draws its own bar in. They were `sectionLabel`, and 13pt medium under a
   * 24pt icon weighed as much as the icon did — four words competing with the
   * four pictures they name, on the one element that is on screen at all times.
   */
  tabLabel: {
    fontFamily: fontFamily.sansMedium,
    fontSize: 11,
    lineHeight: 13,
    letterSpacing: 0.1,
  },
  /**
   * The optional action in a section header ("See all").
   *
   * Same size as `sectionLabel` at regular weight, so it stays legible and
   * tappable without competing with the heading beside it or with the
   * featured card below.
   */
  sectionAction: {
    fontFamily: fontFamily.sansRegular,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.1,
  },
  /**
   * The smallest running text: a clock under a scrubber, the line under a
   * setting's label. From the redesign, which sets both at 11. Regular weight
   * and no tracking, which is what separates it from `eyebrow`.
   */
  caption: {
    fontFamily: fontFamily.sansRegular,
    fontSize: 11,
    lineHeight: 14,
  },
  /**
   * The title of a bottom sheet — "Start from", "Marking the beat". From the
   * redesign, one step under `heroTitle`, so a sheet over a screen never
   * out-shouts the screen's own title.
   */
  sheetTitle: {
    fontFamily: fontFamily.serifRegular,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.3,
  },
  /** Control labels. */
  button: {
    fontFamily: fontFamily.sansMedium,
    fontSize: 16,
    lineHeight: 22,
  },
} as const satisfies Record<string, TextStyle>;

export type TypographyToken = keyof typeof typography;

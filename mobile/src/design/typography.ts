import type { TextStyle } from 'react-native';

// Imported per weight, not from the package root: the root index re-exports
// every weight and italic, and Metro bundles all of them (~4 MB of unused
// TTFs). These four subpaths pull exactly the four files we load.
import { Newsreader_400Regular } from '@expo-google-fonts/newsreader/400Regular';
import { Newsreader_500Medium } from '@expo-google-fonts/newsreader/500Medium';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';

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

/** Passed to `useFonts` at app start. */
export const fontsToLoad = {
  Newsreader_400Regular,
  Newsreader_500Medium,
  Inter_400Regular,
  Inter_500Medium,
  // A file rather than a package: this one is subset in-repo.
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
  /** Control labels. */
  button: {
    fontFamily: fontFamily.sansMedium,
    fontSize: 16,
    lineHeight: 22,
  },
} as const satisfies Record<string, TextStyle>;

export type TypographyToken = keyof typeof typography;

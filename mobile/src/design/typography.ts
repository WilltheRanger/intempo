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
} as const;

/** Passed to `useFonts` at app start. */
export const fontsToLoad = {
  Newsreader_400Regular,
  Newsreader_500Medium,
  Inter_400Regular,
  Inter_500Medium,
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
   * Leading is tight relative to the size so a two-line title doesn't stretch
   * the row.
   */
  pieceTitle: {
    fontFamily: fontFamily.serifMedium,
    fontSize: 20,
    lineHeight: 24,
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
  /** Section labels. Sentence case — the brief rules out decorative uppercase. */
  sectionLabel: {
    fontFamily: fontFamily.sansMedium,
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

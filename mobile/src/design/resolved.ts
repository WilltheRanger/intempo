import { Appearance } from 'react-native';

import {
  paletteFor,
  pinnedScheme,
  type ColorScheme,
  type Palette,
} from './colors';

/**
 * The palette this launch is running, decided once, at import.
 *
 * **It has to be import-time, and that is a fact about the codebase rather
 * than a preference.** Eighty-one `StyleSheet.create` calls sit at module
 * scope and read colour tokens as they are evaluated, which happens while the
 * bundle loads and long before React renders anything. A palette resolved in
 * an effect would arrive after every one of those sheets had already baked the
 * wrong values in.
 *
 * `Appearance.getColorScheme()` is synchronous, so the system setting is
 * readable at exactly the moment it is needed. That is what makes this
 * approach possible at all.
 *
 * **There is deliberately no in-app override yet, and the reason is the same
 * fact.** A stored preference lives in `AsyncStorage`, which has no
 * synchronous read, so an override could not be consulted here — it could only
 * be applied on some *later* launch. A switch in Settings that does nothing
 * until the next cold start is worse than no switch: it reads as broken. The
 * override belongs with live theme switching, where a `useColors()` hook makes
 * both work properly, and that is a separate piece of work.
 *
 * So: this follows the device. Turn the phone dark, relaunch, the app is dark.
 */
export const scheme: ColorScheme =
  pinnedScheme ??
  (Appearance.getColorScheme() === 'dark' ? 'dark' : 'light');

/**
 * The resolved palette, exported under the name every screen already imports.
 *
 * Ninety files import `colors` from the design barrel, and none of them had to
 * change: the barrel now re-exports this instead of the light object. The two
 * palettes themselves stay in `colors.ts`, where a test can reach them without
 * dragging `react-native` in.
 */
export const colors: Palette = paletteFor(scheme);

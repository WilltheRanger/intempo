import { describe, expect, it } from 'vitest';

import appJson from '../../app.json';
import { lightColors as colors, pinnedScheme } from './colors';

/**
 * The colours in `app.json`, against the tokens they are copies of.
 *
 * `app.json` is JSON and cannot import a token, so the hexes in it are typed
 * out — which CLAUDE.md §4 forbids everywhere it can be avoided, and this is
 * the one place it cannot. **They had already drifted.** `expo.backgroundColor`
 * and the Android adaptive icon both read `#FBFAF7` against a `colors.bg` of
 * `#F7F2E9`: close enough that nobody would spot it side by side, and far
 * enough to be a visible flash of the wrong paper on launch.
 *
 * Nothing checked it. `scripts/flatten-vendor-assets.mjs` verifies the *web*
 * build's page background against `colors.bg` and prints the result — so the
 * one surface with a check was the one that is not the shipping app.
 *
 * These are the colours the operating system paints, not React: the root view
 * behind the app on launch and behind an over-scroll bounce, and the plate an
 * Android launcher draws the icon on. They are seen before any component
 * mounts, which is exactly why no screenshot of a screen would ever catch it.
 */

const config = appJson.expo as {
  backgroundColor: string;
  userInterfaceStyle: string;
  android: { adaptiveIcon: { backgroundColor: string } };
};

describe('app.json colours', () => {
  it('asks iOS for the appearance the app is pinned to, or for the device\'s', () => {
    // `"light"` makes iOS report `light` from `Appearance.getColorScheme()`
    // whatever the device is set to. That is exactly right while
    // `pinnedScheme` is `'light'` — the system chrome then agrees with the
    // palette — and exactly wrong once it is un-pinned: dark mode would never
    // appear and nothing else would look wrong. So the two are held together.
    expect(config.userInterfaceStyle).toBe(pinnedScheme ?? 'automatic');
  });

  it('paints the same paper the app does', () => {
    // `expo.backgroundColor` needs `expo-system-ui` installed to reach iOS at
    // all — without it `expo prebuild` warns and drops it, which is how a
    // wrong colour went unnoticed twice over: not applied, and not the right
    // one either.
    //
    // It is the **light** value, and that is not an oversight: this key takes
    // one colour and cannot vary by appearance. `App.tsx` corrects it at boot
    // with `SystemUI.setBackgroundColorAsync` for a dark launch, so this
    // static value is the light default and the floor under a failed call.
    expect(config.backgroundColor.toUpperCase()).toBe(colors.bg.toUpperCase());
  });

  /**
   * **The launcher plate is the icon's ground, not the app's paper.**
   *
   * This asserted `colors.bg` — right while the icon was the Expo starter's
   * and there was nothing for the plate to agree with. The drawn icon inverts
   * the app on purpose: ink ground, ivory note, because an ivory icon
   * disappears against a light wallpaper, which is the one place an icon has
   * to work (`DECISIONS.md`, 2026-09-06).
   *
   * So the rule is the same rule, pointed at the right thing. This colour is
   * the fallback Android paints when it uses `backgroundColor` instead of
   * `backgroundImage`, and the two disagreeing means a launcher somewhere
   * draws an ivory plate under an icon drawn for ink.
   */
  it('sits the launcher icon on the icon\'s own ground', () => {
    expect(config.android.adaptiveIcon.backgroundColor.toUpperCase()).toBe(
      colors.textPrimary.toUpperCase(),
    );
  });
});

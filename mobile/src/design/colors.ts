/**
 * Colour tokens. The only place a hex value may appear in this codebase.
 *
 * **Two palettes, and neither is exported as `colors`.** Which one the app is
 * running is decided in `resolved.ts`, which reads the system setting — this
 * module stays free of `react-native` so it can be imported by a test, which
 * `material.test.ts` and `contrast.test.ts` both do.
 *
 * The eight base tokens were approved as part of the design brief. The three
 * `*Pressed` / `borderStrong` entries are state variants, not new colours:
 * React Native has no `:hover`, `:focus`, or `:active`, so every interactive
 * state has to be an explicit value rather than a derived one.
 */
export const lightColors = {
  /**
   * Warm ivory page background.
   *
   * Warmed from #FBFAF7. Pure-white cards then sit slightly lighter than the
   * page, which is the intended relationship. Kept pale enough to stay ivory
   * rather than drifting to cream or parchment.
   */
  bg: '#F7F2E9',
  /** Cards and raised surfaces. */
  surface: '#FFFFFF',

  /** Warm near-black. Headings and body copy. */
  textPrimary: '#14110E',
  /**
   * Warm gray. Composer names, supporting copy.
   * 6.51:1 on `bg`, 7.26:1 on `surface` — clearly below primary, comfortably
   * readable, and clear of WCAG AA at any size.
   */
  textSecondary: '#5C564D',
  /**
   * Metadata, placeholders, disabled text.
   *
   * 4.52:1 on `bg`, 5.04:1 on `surface` — clears WCAG AA at every size it is
   * used at. Measured, not estimated: `audit-a11y.mjs`.
   *
   * Was `#7A7367`, documented as "~4.6:1 on `bg`". That figure was the ratio
   * on `surface`; on `bg`, where most of this text actually sits, it was 4.21
   * — under the floor. A 4% darkening fixes it and is all but invisible.
   */
  textTertiary: '#756E63',

  /** Default 1px border on cards, dividers, inputs. */
  border: '#E6E2DA',
  /** Focused/active border. Stands in for the `:focus` ring RN doesn't have. */
  borderStrong: '#D8D2C6',

  /**
   * Muted antique gold. The only accent. Used sparingly.
   *
   * **Not a text colour.** 3.54:1 on `bg`, which clears the 3:1 floor for
   * icons, borders and fills, and misses the 4.5:1 floor for text at every
   * size this app has — the largest variant the accent was used with is 16px,
   * and AA only relaxes to 3:1 at 18.66px bold. So the gold is kept exactly as
   * it is, on everything that is not a word: tab icons, the beat indicator,
   * focused input borders, the trend stroke, the avatar, the refresh spinner.
   *
   * Gold text became ink. Tappable labels lost the gold that marked them, and
   * that was the trade accepted when the alternative was darkening the brand
   * accent by 14%. `audit-a11y.mjs` holds the line.
   */
  accent: '#9A7B4F',

  /**
   * The accent, as **small text on a light ground**.
   *
   * `accent` measures **3.54:1** on the page and 3.95:1 on a card. That clears
   * WCAG AA for large text and for a non-text mark — a progress fill, an active
   * indicator, a favourite — which is nearly everywhere it is used. It does not
   * clear the 4.5:1 that body-sized text needs, and it was being used at
   * `metadataSmall` for the playback settings, the "fix this bar" cues and the
   * clef control: text a musician has to read, at 3.54.
   *
   * Darkened only as far as AA needed, exactly as the verdict hues below were:
   * **4.90:1** on the page and 5.47:1 on a card.
   *
   * **Two tokens rather than one darker accent**, because `accent` already
   * measures 4.52:1 against `darkBg`, the scanner's ink ground — where this
   * darker one would fall to **3.26** and fail. Neither value is right on both
   * grounds; which ground the text sits on decides.
   */
  accentText: '#7F6541',

  /** Primary action surface and its label. */
  actionBg: '#1A1714',
  actionText: '#FBFAF7',

  /**
   * A surface that is dark in **both** appearances, and what sits on it.
   *
   * The camera scanner: a live viewfinder and the photographs coming off it
   * are the content, and the chrome around them is dark so the eye stays on
   * the page being framed. That is a property of the screen, not of the
   * appearance, so it does not invert.
   *
   * **These were `actionBg`/`actionText` doing two jobs**, which cost nothing
   * while the app had one appearance and exactly matched. The moment the
   * primary action inverted — ink button on ivory becomes ivory button on ink
   * — the scanner's ground inverted with it and its ivory chrome came out
   * ivory-on-ivory. Two jobs, two names.
   */
  darkBg: '#1A1714',
  onDark: '#FBFAF7',
  /** Secondary text and inactive chrome on that surface. */
  onDarkMuted: 'rgba(251, 250, 247, 0.55)',
  /**
   * A barely-there fill on that surface — a label pill, a chip.
   *
   * **Not `glassSpecular`, which is what the first attempt reached for.** That
   * one is white at 0.46 for a *highlight* on the glass material; as a fill on
   * the Today hero it composited to about `#8A8880` and put `onDark` on it at
   * 3.4:1. This is low enough to read as a separation rather than a surface,
   * and leaves the label at about 8:1.
   */
  onDarkFill: 'rgba(251, 250, 247, 0.16)',

  /** Pressed states. */
  actionBgPressed: '#332E28',
  surfacePressed: '#F5F2EC',

  // -------------------------------------------------------------------------
  // Glass — the floating control layer, and nothing else.
  //
  // A translucent surface has no fixed ground, so these are the one group of
  // tokens `audit-a11y.mjs` cannot check: what sits behind them is whatever
  // happens to be scrolling past. `glassTint` is therefore deliberately far
  // more opaque than "barely tinted" — over the black of engraved notation a
  // lighter value blurs to grey and takes the label with it, and the label
  // staying readable is the whole constraint. Apple's own light-mode regular
  // material sits in this range for the same reason.
  //
  // Derived from `bg`, not from white: over ivory a neutral-white glass reads
  // cold, and this layer sits on ivory nearly everywhere.
  // -------------------------------------------------------------------------
  /**
   * The ground a glass surface adds on top of the blur behind it.
   *
   * **0.80, not 0.62.** At 0.62 the material read as "too clear" — a tinted
   * pane you could still make out words and staff lines through, which is
   * clutter behind a label rather than depth beneath one. Apple's light-mode
   * regular material is far closer to this end; the underlying content should
   * survive as shape and colour, not as text.
   *
   * Composited worst case is over black: rgb(201, 199, 195), where
   * `textPrimary` measures **11.3:1** — so the extra opacity costs nothing in
   * contrast and `audit-a11y.mjs` checks it on every build.
   */
  glassTint: 'rgba(251, 249, 244, 0.80)',
  /**
   * `glassTint` already composited over `bg`, fully opaque.
   *
   * What a glass surface becomes when the person has Reduce Transparency on —
   * and, incidentally, what it has always looked like on Android and in any
   * browser that declines the blur. Derived rather than picked so the fallback
   * is the *same colour* the material settles to over the page: a bar that
   * stops being translucent should stop moving, not change hue.
   *
   * rgb(251, 249, 244) at 0.80 over rgb(247, 242, 233).
   */
  glassOpaque: '#FAF8F2',
  /**
   * The specular catch, brightest at the top-left and gone by a third of the
   * way down. Paired with `glassEdge` — the gradient reads as light falling
   * across a curved surface, the hairline as its lit rim.
   */
  glassSpecular: 'rgba(255, 255, 255, 0.46)',
  /** The bright catch along a glass edge. Half a pixel, never a stroke. */
  glassEdge: 'rgba(255, 255, 255, 0.72)',
  /**
   * The darker separation around a glass surface.
   *
   * Paired with `glassEdge` always: a bright edge alone disappears over pale
   * content, and this is what keeps the shape readable over anything.
   */
  glassSeparator: 'rgba(20, 17, 14, 0.14)',
  /**
   * The tint for glass floating over **content**, rather than over the page.
   *
   * Identical in both palettes, and that is the point — the same argument
   * `darkBg` is named for. A screen whose ground is a photograph is dark
   * because of what it shows, not because of the appearance, so the chrome
   * over it does not invert either.
   *
   * **0.50, against `glassTint`'s 0.80 — lighter than the default, not
   * heavier.** Over the app's own page the missing 20% is a flat ivory or a
   * flat ink, so the ground is one known value and every label on it was
   * measured against that. Over a screen's own content it is a photograph, and
   * the honest question is how much of that photograph the type can survive.
   *
   * **Measured on the rendered page, which is the correction.** The first
   * version of this token read `#CCB198` — a bright block of the manuscript
   * *fixture* — as the worst case, concluded that a fifth of it lifted the
   * capsule to where the gold fell to 2.49:1, and went to 0.86 to hold the
   * floors. That measured the input to the screen instead of the screen: the
   * hero composites the manuscript under a 0.45 wash and a bottom gradient
   * before anything floats over it. Photographing the backdrop with the
   * capsule hidden gives the real range:
   *
   *     darkest #1E1814   brightest #3F372F   mean #332B24
   *
   * Against the *brightest* of those, pre-blur, 0.50 leaves the active label
   * at 14.16:1, the inactive one at 4.58 with the tab's own 0.78 dim on it,
   * and the gold at 3.75 — every floor clear with room, and half the
   * manuscript coming through instead of a seventh. The 0.86 was a solid slab
   * bought with arithmetic about a file nobody was looking at.
   *
   * It cannot simply be `glassTint`: 0.80 clears the floors here too, but a
   * tint chosen for an unknown ground is the wrong instrument for a known one,
   * and the whole reason this surface floats over a photograph is to show it.
   */
  glassTintOverContent: 'rgba(26, 23, 20, 0.50)',

  /**
   * Dimming behind a sheet or modal. Derived from `textPrimary` rather than
   * neutral black so it stays in the warm family. Not a new accent — a sheet
   * needs something behind it, and pure black reads cold against ivory.
   */
  scrim: 'rgba(20, 17, 14, 0.32)',

  /**
   * The wash under a glass panel whose ground is the app's own content.
   *
   * **Not `scrim`, and the difference is what each one is for.** A scrim dims
   * to say *the thing behind is inactive* — it darkens, and darkening leaves
   * contrast where it found it. This has to do the opposite: take the detail
   * out of engraved notation, which is the highest-contrast thing this app
   * draws, so that a glass sheet over a page of music reads as a surface
   * rather than as a number printed on a stave. Darkening black noteheads on
   * ivory achieves nothing; fading them toward the paper they are printed on
   * is the whole job, which is why this is `surface` and not ink.
   *
   * 0.94 rather than opaque, because the panel is still glass and some sense
   * of what is beneath it is the point of the material. What is left at 6% is
   * a texture, not a stave you can read a pitch off. 0.88 was tried first and
   * left a legible smear of staff lines across the record button.
   *
   * **The blur cannot be relied on for this and that is the finding behind the
   * token.** It was reported from an iPhone where the engraving came through
   * the raised sheet perfectly sharp — several browsers decline
   * `backdrop-filter` and every one of them falls back to the tint alone, and
   * 20% of an engraving is still a legible grid.
   */
  contentWash: 'rgba(255, 255, 255, 0.94)',

  // -------------------------------------------------------------------------
  // Verdict colours — the verdict screen and nothing else.
  //
  // Quarantined by the spec, and the restriction is the point: they never
  // appear in chrome, navigation, buttons, tabs, or any surface that isn't
  // reporting how a take went. Reach for `accent` everywhere else.
  //
  // They are also never load-bearing. Every verdict carries its word — "On
  // tempo", "Slight rush", "Rushing" — and the colour only reinforces it,
  // because red-green deficiency maps almost exactly onto this trio.
  //
  // Hues are the spec's, darkened only as far as WCAG AA needed on the ivory
  // ground: the spec's own amber measured 2.14:1 there, which its accessibility
  // section forbids. On and mid now sit at 4.50:1, bad at 4.64:1, and all three
  // stay separable under simulated deuteranopia and protanopia.
  // -------------------------------------------------------------------------
  verdictOn: '#1D7F46',
  verdictMid: '#8F681C',
  verdictBad: '#C53B3B',
} as const;

export type ColorToken = keyof typeof lightColors;

/**
 * A complete palette.
 *
 * `Record<ColorToken, string>` rather than `typeof colors`: the literal types
 * `as const` produces would demand the dark palette use the light palette's
 * exact hexes, which is the opposite of the point. What this does keep is the
 * **key set** — a token added to one palette and forgotten in the other is a
 * type error, which is the drift worth catching.
 */
export type Palette = Record<ColorToken, string>;

/**
 * The same tokens, on a warm dark ground.
 *
 * **Warm, not neutral.** The app already contained a dark pair — `darkBg`
 * `#1A1714` and `onDark` `#FBFAF7`, which the camera scanner has used as its
 * ground since it was built — so this is that pair grown into a palette rather
 * than a grey theme bolted beside an ivory one. A neutral dark would have made
 * the gold read green.
 *
 * **Every ratio below is measured, not estimated**, the same way the light
 * palette's are, and `contrast.test.ts` holds all of them.
 *
 * Three things had to move in the opposite direction from the light palette,
 * and each of them is a place where "invert the colours" would have been
 * wrong:
 *
 *  - **The verdict hues are lighter here, not darker.** They were darkened to
 *    clear AA on ivory; on ink the same values fall through the floor.
 *  - **`accent` and `accentText` swap jobs.** In light mode `accentText` is the
 *    *darker* gold, because the brand gold misses 4.5:1 on ivory. Here the
 *    brand gold clears AA-for-marks on the page (4.77) and misses text on a
 *    card (4.20), so the text-safe gold is the *lighter* one. The light
 *    palette's own comment predicted this: it records `accent` measuring
 *    4.52:1 on `darkBg`, the scanner's ink ground, where `accentText` falls
 *    to 3.26.
 *  - **The primary action inverts.** An ink button on ivory becomes an ivory
 *    button on ink; `actionBg` and `actionText` trade values.
 *
 * `surface` sits **1.14:1** above `bg`. That is deliberately close, and it is
 * the light palette's relationship carried over rather than a new one — white
 * cards sit 1.12:1 above the ivory page there. A card is meant to be a slight
 * lift, not a box.
 */
export const darkColors: Palette = {
  /** Warm near-black page. The light palette's `textPrimary`, used as ground. */
  bg: '#14110E',
  /** Cards and raised surfaces. 1.14:1 above the page — a lift, not a box. */
  surface: '#221E19',

  /** Warm ivory. 18.02:1 on the page, 15.87:1 on a card. */
  textPrimary: '#FBFAF7',
  /** Composer names, supporting copy. 8.30:1 / 7.31:1. */
  textSecondary: '#B5AB9C',
  /** Metadata, placeholders, disabled text. 5.55:1 / 4.88:1 — clears AA on both. */
  textTertiary: '#948A7D',

  border: '#332C25',
  borderStrong: '#3D362E',

  /**
   * The brand gold, unchanged. **4.77:1** on the page and 4.20:1 on a card:
   * clears the 3:1 floor for icons, borders and fills everywhere, and misses
   * text on a card — exactly the role it plays in light mode, for the opposite
   * arithmetic reason.
   */
  accent: '#9A7B4F',
  /**
   * The gold as text. **Lighter** here where the light palette goes darker.
   * 7.34:1 on the page, 6.46:1 on a card.
   */
  accentText: '#C09C66',

  /** Inverted: ivory button, ink label. 18.02:1. */
  actionBg: '#FBFAF7',
  actionText: '#14110E',

  /**
   * Identical to the light palette's, and that is the whole point of the pair
   * existing: the scanner is dark in both appearances because a viewfinder is.
   */
  darkBg: '#1A1714',
  onDark: '#FBFAF7',
  onDarkMuted: 'rgba(251, 250, 247, 0.55)',
  onDarkFill: 'rgba(251, 250, 247, 0.16)',

  actionBgPressed: '#E8E3D9',
  surfacePressed: '#2A241E',

  /**
   * Dark glass. Same 0.80 opacity as the light material and for the same
   * reason — the content behind should survive as shape and colour, not as
   * text. Composited worst case is over white: rgb(72, 69, 67), where
   * `textPrimary` measures **9.11:1**; over black it is 17.87:1.
   */
  glassTint: 'rgba(26, 23, 20, 0.80)',
  /** `glassTint` over `bg`, opaque. What Reduce Transparency settles to. */
  glassOpaque: '#191613',
  /**
   * Far weaker than the light material's catch. A bright specular on a dark
   * pane reads as a smear rather than as light falling across glass.
   */
  glassSpecular: 'rgba(255, 255, 255, 0.10)',
  /** The lit rim. Half a pixel, never a stroke. */
  glassEdge: 'rgba(255, 255, 255, 0.18)',
  /**
   * Kept dark, and paired with `glassEdge` exactly as in light mode: the rim
   * carries the shape over dark content, and this carries it over light content
   * — a page of notation scrolling underneath.
   */
  glassSeparator: 'rgba(0, 0, 0, 0.36)',
  /** Identical to the light palette's — see the note there. */
  glassTintOverContent: 'rgba(26, 23, 20, 0.50)',

  /** Stronger than the light scrim: a sheet here is lighter than its ground. */
  scrim: 'rgba(8, 6, 5, 0.58)',

  /**
   * This palette's `surface` at the same 0.94 — see the light one for what the
   * token is for. The alpha is shared deliberately: it is chosen against the
   * engraving's contrast, which is the same ratio in both appearances because
   * the notation is drawn in each palette's own ink.
   */
  contentWash: 'rgba(34, 30, 25, 0.94)',

  /**
   * Lightened, not darkened. The light values were pushed *down* to clear AA on
   * ivory; on ink they fail. Hues held so a verdict reads the same in either
   * mode, and they remain separable under deuteranopia and protanopia.
   */
  verdictOn: '#4FBF7F',
  verdictMid: '#D6A93F',
  verdictBad: '#F0736F',
} as const;

export type ColorScheme = 'light' | 'dark';

/**
 * The appearance every build runs in, whatever the device is set to — or
 * `null` to follow the device.
 *
 * **Pinned to light by the owner on 2026-09-23**, for the redesign: "ignore
 * dark mode for now … make sure all versions are light mode". The dark palette
 * below is kept, not deleted, so un-pinning is this one line.
 *
 * One switch, read by everything that has an appearance: `resolved.ts` (the
 * palette), `app.json`'s `userInterfaceStyle` (iOS system chrome, held by
 * `appConfig.test.ts`), and `public/index.html` (the web page's own ground and
 * `theme-color`, held by `scripts/flatten-vendor-assets.mjs`).
 */
export const pinnedScheme: ColorScheme | null = 'light';

/** The palette for a scheme. The only place either object is chosen. */
export function paletteFor(scheme: ColorScheme): Palette {
  return scheme === 'dark' ? darkColors : lightColors;
}


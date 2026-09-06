/**
 * Colour tokens. The only place a hex value may appear in this codebase.
 *
 * The eight base tokens were approved as part of the design brief. The three
 * `*Pressed` / `borderStrong` entries are state variants, not new colours:
 * React Native has no `:hover`, `:focus`, or `:active`, so every interactive
 * state has to be an explicit value rather than a derived one.
 */
export const colors = {
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
   * **Two tokens rather than one darker accent**, because the scanner is the
   * app's one dark screen and `accent` already measures 4.52:1 against its ink
   * ground — where this darker one would fall to **3.26** and fail. Neither
   * value is right on both grounds; which ground the text sits on decides.
   */
  accentText: '#7F6541',

  /**
   * Primary action surface and its label.
   *
   * These two double as the palette for full-bleed dark surfaces — the camera
   * scanner uses `actionBg` as its ground and `actionText` for chrome, rather
   * than introducing a parallel set of near-blacks.
   */
  actionBg: '#1A1714',
  actionText: '#FBFAF7',
  /** Secondary text and inactive chrome on a dark surface. */
  onDarkMuted: 'rgba(251, 250, 247, 0.55)',

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
   * The tint for a **prominent** glass control — a primary action.
   *
   * Ink rather than paper, and the one place glass carries colour: tinted
   * glass is reserved for primary actions and selected states, so that when it
   * appears it means something. Held at 0.88 because the label on it is
   * `actionText`, and translucency is not allowed to cost a control its
   * contrast.
   */
  glassTintProminent: 'rgba(26, 23, 20, 0.92)',
  /**
   * The specular catch, brightest at the top-left corner and gone by a third
   * of the way down. Paired with `glassEdge` — the gradient reads as light
   * falling across a curved surface, the hairline reads as its lit rim.
   */
  glassSpecular: 'rgba(255, 255, 255, 0.46)',
  /** The same catch on a prominent surface, where the ground is ink. */
  glassSpecularProminent: 'rgba(255, 255, 255, 0.20)',
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
   * Dimming behind a sheet or modal. Derived from `textPrimary` rather than
   * neutral black so it stays in the warm family. Not a new accent — a sheet
   * needs something behind it, and pure black reads cold against ivory.
   */
  scrim: 'rgba(20, 17, 14, 0.32)',

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

export type ColorToken = keyof typeof colors;

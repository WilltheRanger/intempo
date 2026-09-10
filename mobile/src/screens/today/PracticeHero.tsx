import { Image } from 'expo-image';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { Plus } from '../../components/icons';
import { IconButton } from '../../components/primitives/IconButton';
import { PrimaryButton } from '../../components/primitives/PrimaryButton';
import { Text } from '../../components/primitives/Text';
import { SCREEN_GUTTER } from '../../components/primitives/ScreenContainer';
import { useTabBarHeight } from '../../navigation/tabBarMetrics';
import { colors, radii, spacing } from '../../design';
import type { HeroContent } from './heroContent';

/**
 * Today, as one photograph with the next thing to practise written on it.
 *
 * **A prototype, and named as one here so nobody has to guess.** The layout
 * comes from a reference the owner supplied — a meditation app whose home
 * screen is a full-bleed image, a greeting, one large title and one pill
 * button. What was taken is the *composition*; what was not is the colour, the
 * photography and the filter chips. It replaces the carded Today; `git revert`
 * on the commit that introduced it brings the old one back whole.
 *
 * ## Why it does not break the design laws it looks like it breaks
 *
 * §3 law 6 says gradients and floating rounded things are exceptions rather
 * than the default styling language. Everything here is one of the named
 * exceptions or is load-bearing:
 *
 *  - The **wash and the gradient are legibility, not decoration.** Ivory type
 *    on a photograph of white paper is unreadable, and the arithmetic below is
 *    what makes it readable. Remove them and the screen fails; remove an
 *    ornament and nothing happens. That is the test.
 *  - The **add button is chrome** — the control layer, which law 6 exempts by
 *    name and which is the same glass capsule the rest of the app floats.
 *  - The **label pill** is the one thing here that is decoration, and it earns
 *    its place by separating "Continue practicing" from the title: without it
 *    the section name reads as part of the piece.
 *
 * Law 4 wanted one dominant focal point, and the three-foot test on this is
 * the title, then the button, then the greeting — which is the order a
 * musician needs them in.
 *
 * ## The type is legible because of arithmetic, not because it looked fine
 *
 * A photograph is a ground the accessibility sweep cannot measure: it walks
 * `backgroundColor`, and an `<Image>` has none. So the ground is *made*
 * measurable — an opaque `darkBg` beneath everything and a flat wash above the
 * photograph, both of which the sweep does see — and the worst case is
 * computed rather than eyeballed.
 *
 * Worst case is the lightest a scanned manuscript gets, about `#F0E8D8`:
 *
 * Worst case is the manuscript's **measured** brightest region, `#CCB198` —
 * measured rather than assumed, after an assumed value turned out to be two
 * shades off the fixture that is actually on screen:
 *
 *     top     #CCB198 at IMAGE_OPACITY over darkBg, then WASH over that
 *             → #685B4E.  onDark 6.31:1.  onDarkMuted 3.15:1.
 *     bottom  the same, then GRADIENT ink over it
 *             → #3D352E.  onDark 11.45:1.  onDarkMuted 4.68:1.
 *
 * **`onDarkMuted` does not clear AA in the top band, at any brightness the
 * manuscript is worth showing at.** So the top band carries `onDark` only —
 * the greeting and the name — and every muted line lives below 72%, where the
 * gradient has settled. That is a rule about where type may go, which is why
 * it is written here rather than discovered later.
 *
 * The sweep measures the wash over `darkBg` and reports about 17:1, which is
 * *more* generous than reality — so these numbers are the real bound and the
 * sweep is only the backstop.
 */

/**
 * How much of the manuscript comes through.
 *
 * **Measured against the type, not chosen by eye.** The first attempt was 0.45
 * behind a 0.68 wash, which cleared every threshold comfortably and rendered
 * the page as a brown smudge — legible type on a photograph nobody could see
 * was a photograph. This is the brightest the manuscript can be while the
 * greeting at the top, which the bottom gradient does not reach, still clears
 * AA at 16pt: `#726D65` at the worst case, `onDark` at **4.90:1**.
 */
const IMAGE_OPACITY = 0.8;

/** Flat ink over the whole field. See the arithmetic above. */
const WASH = 'rgba(20, 17, 14, 0.45)';

/**
 * How dark the bottom of the hero settles to, under the flat wash.
 *
 * Sized by `onDarkMuted`, which is the constraint: at the top band it is about
 * 3.2:1 against the manuscript and cannot be used there at all. This is what
 * brings it to **4.68:1**, and the metadata and the verdict sentence are the
 * two things that need it.
 */
const GRADIENT = 0.55;

/**
 * How much taller than the screen the hero is *not*.
 *
 * The hero stops short of the fold so the section under it peeks. A screen
 * that fills exactly to the edge says it is the whole screen, and this one is
 * not — everything the old Today had is still below it. A peek is the cheapest
 * honest way to say so, and it is a real affordance: what it suggests is
 * scrolling, and scrolling is what it does.
 */
const PEEK = 72;

export interface PracticeHeroProps {
  /**
   * What to write on the photograph, or null while the piece is still coming.
   *
   * Null draws the ground and nothing else — the same photograph, the same
   * wash, the same height — so the screen does not jump when the answer
   * arrives. It replaces a card-shaped skeleton that stood in for a card this
   * screen no longer has: a shimmer in the shape of the wrong thing is worse
   * than the shape of the right thing with nothing in it yet.
   */
  content: HeroContent | null;
  /** The greeting line. "Good morning", from `getGreeting`. */
  greeting: string;
  /** Whose morning it is, when the account has said. */
  name: string | null;
  onAction: () => void;
  onAdd: () => void;
}

/**
 * The one page the hero is ever built from.
 *
 * **Not the piece's own photograph, and not a mix of pages — and that is the
 * correction this screen cost most to learn.** The first version tiled four
 * fixtures and fell back to the musician's own scan. Two of those fixtures are
 * *white* printed pages, so the screen came out in bands of sepia and white,
 * and the title crossed a white band where ivory type on it measured about
 * 2:1. A musician's own photograph is worse: it is a phone picture of a page
 * under whatever lamp they own, and there is no wash that is right for all of
 * them.
 *
 * A ground that varies cannot be reasoned about, and this ground carries the
 * one line the screen exists for. So it is fixed, it is the warm handwritten
 * manuscript, and the arithmetic below is computed from its **measured**
 * brightest region — `#CCB198` — rather than from a guess about paper.
 */
const MANUSCRIPT = require('../../../assets/fixtures/04_handwritten_clean.jpg');

/**
 * The shape of a page image: about 1200x150, a single system wide.
 *
 * **This is why the ground is tiled rather than one big `cover`.** A strip that
 * wide in a portrait box has to be magnified about five times to fill it, which
 * is well past what 1200px holds — the first attempt rendered two enormous
 * blurred noteheads and nothing that read as music. Stacked at their own aspect
 * they are drawn at roughly 1:1 on a 2x screen, they are sharp, and a column of
 * systems is what a page of music actually looks like.
 */
const SYSTEM_ASPECT = 1200 / 150;

/** A little over a system's height, so the stack is legible rather than dense. */
const SYSTEM_SCALE = 1.35;

/** The manuscript, repeated down the hero until it is full. */
function ManuscriptField({ height, width }: { height: number; width: number }) {
  const rowHeight = (width / SYSTEM_ASPECT) * SYSTEM_SCALE;
  const rows = Math.max(1, Math.ceil(height / rowHeight));

  return (
    <View style={[StyleSheet.absoluteFill, styles.field]} pointerEvents="none">
      {Array.from({ length: rows }, (_, index) => (
        <Image
          key={index}
          source={MANUSCRIPT}
          style={{ width: '100%', height: rowHeight }}
          contentFit="cover"
          accessibilityIgnoresInvertColors
        />
      ))}
    </View>
  );
}

export function PracticeHero({
  content,
  greeting,
  name,
  onAction,
  onAdd,
}: PracticeHeroProps) {
  const { height, width } = useWindowDimensions();
  // **The tab bar floats over this, so the hero has to end above it.** Without
  // this the "Continue practice" button sat under the capsule: still tappable
  // where it stuck out, and half-covered — a primary action partly behind
  // furniture, which is the thumb zone (§3 law 7) being taken away by the
  // thing that is supposed to be out of the way.
  const tabBar = useTabBarHeight();

  const heroHeight = Math.max(520, height - PEEK);

  return (
    <View style={[styles.hero, { height: heroHeight }]}>
      <ManuscriptField height={heroHeight} width={width} />
      <View style={[StyleSheet.absoluteFill, styles.wash]} />
      {/*
        Deepens the bottom third, where every line of type is. Not a
        `backgroundColor`, so the sweep cannot see it — which is the right way
        round: it only ever makes the real contrast better than the measured
        one. The flat wash above is what the numbers are computed from.
      */}
      <Svg
        style={StyleSheet.absoluteFill}
        width="100%"
        height="100%"
        pointerEvents="none"
      >
        <Defs>
          {/*
            Four stops, not two, because the copy has to sit on a *settled*
            ground rather than on whatever the ramp happens to be at that
            height. Nothing until 45% down, full by 72%, and held from there —
            so every line of muted type is on `GRADIENT` and the arithmetic in
            the file docstring is one number rather than a function of y.
          */}
          <LinearGradient id="hero-fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.darkBg} stopOpacity="0" />
            <Stop offset="0.45" stopColor={colors.darkBg} stopOpacity="0" />
            <Stop offset="0.72" stopColor={colors.darkBg} stopOpacity={GRADIENT} />
            <Stop offset="1" stopColor={colors.darkBg} stopOpacity={GRADIENT} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#hero-fade)" />
      </Svg>

      <View style={[styles.content, { paddingBottom: tabBar + spacing.lg }]}>
        <View style={styles.topRow}>
          <View style={styles.greeting}>
            <Text variant="screenTitle" color="onDark">
              {greeting}
            </Text>
            {name ? (
              // **`onDark`, not `onDarkMuted`.** This line sits at the top of
              // the hero where only the flat wash darkens the page — the
              // gradient starts below it — so the muted token would be about
              // 2.4:1 there. Emphasis comes from the size instead.
              <Text variant="metadataSmall" color="onDark">
                {name}
              </Text>
            ) : null}
          </View>
          {/*
            **The "+" is back in the header, and the objection to it is gone.**
            `TodayScreen` recorded one being tried and rejected: "two unrelated
            circles crowding the trailing corner, the smaller of which gave no
            clue what it added". The pairing was the problem — it sat beside
            the avatar. The avatar has moved to the Profile tab, where it is a
            destination rather than an ornament, so this is the only control in
            the corner and it is the one the reference puts there.
          */}
          <IconButton icon={Plus} label="Add a piece" tone="onDark" onPress={onAdd} />
        </View>

        {content === null ? null : (
        <View style={styles.copy}>
          <View style={styles.pill}>
            <Text variant="sectionLabel" color="onDark">
              {content.label}
            </Text>
          </View>
          {/*
            Three lines and then an ellipsis. A long classical title wraps to
            two at 390pt and three at 320, and a fourth would start pushing the
            button it belongs to off the bottom of the screen.
          */}
          <Text variant="displayTitle" color="onDark" numberOfLines={3} style={styles.title}>
            {content.title}
          </Text>
          {content.meta ? (
            <Text variant="metadataSmall" color="onDarkMuted" style={styles.meta}>
              {content.meta}
            </Text>
          ) : null}
          {content.detail ? (
            <Text variant="body" color="onDarkMuted" style={styles.detail}>
              {content.detail}
            </Text>
          ) : null}
          {/*
            `tone="light"` is the ivory-on-ink button, which is what a pill on
            a dark ground has to be — and it is the same primary action the
            rest of the app uses rather than a shape invented for this screen.

            It was the first caller of that tone, and it found it broken: the
            tone was built out of `actionBg`/`actionText`, which invert with
            the appearance, so in dark mode this drew an ink button on an ink
            hero. It comes from `onDark`/`darkBg` now.
          */}
          <PrimaryButton
            label={content.actionLabel}
            tone="light"
            onPress={onAction}
            style={styles.action}
          />
        </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    // Opaque, and underneath everything: it is what makes the ground
    // measurable when the photograph above it is not.
    backgroundColor: colors.darkBg,
    overflow: 'hidden',
  },
  // Dimmed on the field rather than by a heavier wash, so the wash can stay a
  // flat colour the accessibility sweep is able to read.
  field: { opacity: IMAGE_OPACITY, overflow: 'hidden' },
  wash: { backgroundColor: WASH },
  content: {
    flex: 1,
    paddingHorizontal: SCREEN_GUTTER,
    paddingTop: spacing['4xl'],
    // The greeting at the top, the copy at the bottom, the photograph in the
    // space between them. `space-between` rather than a spacer, so the middle
    // is genuinely empty and grows with the screen.
    justifyContent: 'space-between',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  greeting: { flex: 1, minWidth: 0 },
  copy: { alignItems: 'flex-start' },
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.onDarkFill,
    marginBottom: spacing.md,
  },
  title: { marginBottom: spacing.sm },
  meta: { marginBottom: spacing.sm },
  detail: { marginBottom: spacing.xl },
  // Full width, so the thumb has the whole bottom of the screen to land on
  // (§3 law 7) rather than a pill it has to aim at.
  action: { alignSelf: 'stretch' },
});

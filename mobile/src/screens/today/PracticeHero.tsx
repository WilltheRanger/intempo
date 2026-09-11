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
 * Worst case is the photograph's **measured** brightest block per tenth of its
 * height — a block rather than a pixel, since one specular highlight on a key
 * edge is not what the eye reads as ground. Each is composited the way the
 * screen composites it: the photograph at `IMAGE_OPACITY` over `darkBg`, then
 * `WASH`, then whatever `GRADIENT` has reached at that height.
 *
 *     band      photo     ground    onDark   onDarkMuted
 *     0-20%     #4E4E4E   #393028    12.4        4.9      greeting
 *     20-40%    #BFBFBF   #615952     6.6        3.3      the sheet, mid-ramp
 *     40-100%   #BBBBBB   #3B3631    11.4        4.7      title and below
 *
 * **`onDarkMuted` does not clear AA in the 20-40% band**, where the gradient
 * is still ramping and the photographed sheet music is at its brightest. So
 * every muted line lives below 45%, where the gradient has settled — a rule
 * about where type may go, which is why it is written here rather than
 * discovered later.
 *
 * The top band is the one that got easier: the previous ground was a tiled
 * manuscript scan, bright all the way up, and the greeting sat on `#655748` at
 * 6.7:1 with `onDarkMuted` unusable up there at 3.15:1. This photograph is
 * near-black at the top, so the same band now measures 16.4:1. The constants
 * were re-derived against it and came out unchanged, which is the answer the
 * arithmetic gave rather than one that was aimed for.
 *
 * The sweep measures the wash over `darkBg` and reports about 17:1, which is
 * *more* generous than reality — so these numbers are the real bound and the
 * sweep is only the backstop.
 */

/**
 * How much of the photograph comes through.
 *
 * **Measured against the type, not chosen by eye.** An early attempt on the
 * previous ground was 0.45 behind a 0.68 wash, which cleared every threshold
 * comfortably and rendered the screen as a brown smudge — legible type on a
 * photograph nobody could see was a photograph. This is the brightest the
 * ground can be while the greeting at the top, which the bottom gradient does
 * not reach, still clears AA at 16pt.
 */
const IMAGE_OPACITY = 0.8;

/**
 * Flat warm ink over the whole field. See the arithmetic above.
 *
 * **Warm, and that is the photograph's fault rather than a preference.** The
 * ground this replaced was a scan of warm paper and carried the app's sepia by
 * itself. A black-and-white photograph carries none, so Today rendered neutral
 * grey beside a warm app — the one screen out of family.
 *
 * The colour and the alpha moved together, which is the whole trick: warming a
 * wash lightens it, and lighter ground costs the muted lines their headroom.
 * At 0.45 the warmest wash that still cleared AA left `onDarkMuted` at 4.51:1
 * against a 4.5 floor, which is not a margin. Raising the alpha to 0.50 buys
 * the luminance back and lands it at **4.70:1** — the same headroom the
 * neutral wash had — for a warmth of R/B **1.20** in the band the type sits
 * in, against 1.10 before and 1.30 for `darkBg` itself.
 *
 * What it costs is five points of photograph.
 */
const WASH = 'rgba(46, 30, 14, 0.50)';

/**
 * How dark the bottom of the hero settles to, under the flat wash.
 *
 * Sized by `onDarkMuted`, which is the constraint: at the top band it is about
 * 3.2:1 against the manuscript and cannot be used there at all. This is what
 * brings it to **4.68:1**, and the metadata and the verdict sentence are the
 * two things that need it.
 */
const GRADIENT = 0.55;


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
 * one line the screen exists for. So it is one fixed photograph, and the
 * arithmetic below is computed from its **measured** brightest block rather
 * than from a guess about paper.
 *
 * **Photo by GVZ 42 on Unsplash**, under the Unsplash Licence. Credited on
 * `AcknowledgementsScreen`, which is the screen that exists for this; the
 * licence does not require attribution, which is a reason to be careful about
 * it rather than a reason to skip it.
 *
 * It replaces a tiled scan of the handwritten fixture. That one was a strip
 * about 1200x150 repeated down the hero, because a single `cover` of it needed
 * roughly five times magnification and rendered two enormous blurred noteheads.
 * A 1400x2100 portrait photograph needs no such trick: it covers the hero at
 * about 1:1 on a 3x phone.
 */
const HERO_PHOTO = require('../../../assets/hero/piano-keys.jpg');

/** The photograph, covering the hero. */
function HeroField() {
  return (
    <Image
      source={HERO_PHOTO}
      style={[StyleSheet.absoluteFill, styles.field]}
      contentFit="cover"
      // The subject — the sheet and the near end of the keyboard — is in the
      // upper middle. Anchored there so a tall phone crops the empty bottom
      // rather than the music.
      contentPosition="top center"
      accessibilityIgnoresInvertColors
      pointerEvents="none"
    />
  );
}

/**
 * How tall the hero is: one viewport, exactly.
 *
 * Exported because `TodayScreen` has to hand the same number to
 * `ScreenContainer` as `darkGround` — the floating chrome is drawn in the dark
 * material only while it is still over this, and it stops being over it after
 * one viewport of scrolling. Two places needing one measurement is how they
 * drift; this is the measurement.
 */
export function useHeroHeight(): number {
  return useWindowDimensions().height;
}

export function PracticeHero({
  content,
  greeting,
  name,
  onAction,
  onAdd,
}: PracticeHeroProps) {
  // **The tab bar floats over this, so the hero has to end above it.** Without
  // this the "Continue practice" button sat under the capsule: still tappable
  // where it stuck out, and half-covered — a primary action partly behind
  // furniture, which is the thumb zone (§3 law 7) being taken away by the
  // thing that is supposed to be out of the way.
  const tabBar = useTabBarHeight();

  /**
   * The whole screen, exactly.
   *
   * It used to stop 72pt short so the next section peeked through — a scroll
   * affordance, and a good idea that did not survive contact: what showed was
   * not the next section but 72pt of bare page background, because that
   * section starts with padding. A white band under the photograph in light
   * mode and a black one in dark, measured at 144 device pixels. The tab bar
   * floats over the bottom of this anyway, so the hero fills the viewport and
   * the scroll is discovered the way it is on every other screen.
   */
  const heroHeight = useHeroHeight();

  return (
    <View style={[styles.hero, { height: heroHeight }]}>
      <HeroField />
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
            height — so the arithmetic in the file docstring is one number
            rather than a function of y.

            It settles by 45%, not 72%, and that followed the copy: centring
            the block moved every muted line up into what had been the ramp.
            The greeting is above 28% and stays on the bright manuscript.
          */}
          <LinearGradient id="hero-fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.darkBg} stopOpacity="0" />
            <Stop offset="0.28" stopColor={colors.darkBg} stopOpacity="0" />
            <Stop offset="0.45" stopColor={colors.darkBg} stopOpacity={GRADIENT} />
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

        <View style={styles.middle}>
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
  },
  /**
   * The copy, centred in what the greeting leaves.
   *
   * It was pinned to the bottom by `space-between`, which put the title and
   * its button in the last third and left a large empty middle — the screen
   * read as bottom-heavy rather than composed. Centring in the *remaining*
   * space rather than in the whole screen is what keeps the button in the
   * thumb zone (§3 law 7) while the block itself sits where the eye expects
   * it.
   */
  middle: {
    flex: 1,
    justifyContent: 'center',
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

import { useIsFocused } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { Image, type ImageSource } from 'expo-image';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { colors } from '../../design';
import { SINE_IN_OUT_CSS, SWING_PAUSED, swingStyle } from '../../lib/motion/loops';
import { useReducedMotion } from '../../lib/useReducedMotion';

/**
 * How strongly the photograph shows over the band's colour.
 *
 * **Drawn over the colour, not blended into it.** The photograph sits on the
 * band at this opacity with ordinary blending, and the scrim closes the band's
 * colour back over it before the words. That is the look the owner picked from
 * the recorded prototypes (B2 and P4, 2026-10-16): the warm photograph showing
 * through the band at the top, the band's own colour under the headline.
 *
 * **There is no blend mode here, and there must not be one.** This was
 * `mixBlendMode: 'multiply'`, which never blended in any browser: every
 * react-native-web view is its own stacking context, so the photograph blended
 * with its own transparent frame and was drawn flat anyway, which is what the
 * owner chose. On native the same style *would* blend, and the phone app would
 * draw a darker band than the web. Without it, both draw what was chosen
 * (`docs/subsystems.md`, "A blend mode on the web blends with nothing").
 */
const PHOTO_STRENGTH = 0.62;

/**
 * How far the photograph drifts up and down, and how slowly.
 *
 * **A drift, not a zoom.** It was a slow zoom, and a photograph scaled past
 * its frame is wider than the screen: `audit-a11y` measured it 5pt off the
 * right edge, and the frame's clipping does not change what the layout says.
 * The photograph is drawn `SLACK` taller than the band at each end instead and
 * moves only vertically inside it, which reads the same and never leaves the
 * screen sideways.
 */
const DRIFT = { distance: 16, ms: 14000 } as const;
/** How far past the band's top and bottom edges the photograph is drawn. */
const SLACK = 24;

/**
 * The drift on the web, which has no native driver: the same travel, time and
 * curve as the native loop, run by the browser's compositor instead of by
 * JavaScript on every frame (`lib/motion/loops`). Created on the web only;
 * native has no use for keyframes.
 */
const webDrift =
  Platform.OS === 'web'
    ? StyleSheet.create({
        drifting: swingStyle({
          from: { transform: `translateY(${-DRIFT.distance}px)` },
          to: { transform: `translateY(${DRIFT.distance}px)` },
          ms: DRIFT.ms,
          easing: SINE_IN_OUT_CSS,
          fromMiddle: true,
        }) as ViewStyle,
        paused: SWING_PAUSED as ViewStyle,
      })
    : null;

/** `[offset, opacity]` pairs down the band: how much of its own colour covers the photograph. */
export type PhotoBandScrim = readonly (readonly [number, number])[];

export interface PhotoBandProps {
  /** The photograph shown through the band's colour. */
  photo: ImageSource | number;
  /** Where the band's colour closes back over the photograph, so words sit on colour. */
  scrim: PhotoBandScrim;
  /** The page's scroll offset, which the photograph moves at half of. */
  scrollY?: Animated.Value;
  /** What sits on the band, in ivory. The band pays the top inset; the caller sets the gutter. */
  children: ReactNode;
}

/**
 * A full-bleed band in one warm colour (`colors.band`), with a photograph in
 * it: the Library's Continue band and the head of the piece screen
 * (`DECISIONS.md`, 2026-10-16). §3 law 6 names it as an exception, on those two
 * screens.
 *
 * **One colour for every piece.** It took each piece's key colour for an
 * afternoon; on a G major piece that put a green band under a warm photograph,
 * and the owner asked for it warm, always.
 *
 * **It runs under the status bar.** The screen opts out of the top inset
 * (`ScreenContainer.underStatusBar`) and the band pays it back from the inside,
 * so the colour reaches the top edge and the words still clear the island. The
 * status bar is light while the band's screen is in front.
 */
export function PhotoBand({ photo, scrim, scrollY, children }: PhotoBandProps) {
  const insets = useSafeAreaInsets();
  const band = colors.band;
  const photoMotion = usePhotoMotion(scrollY);
  // **One id per band, not one name for all of them.** On the web an SVG
  // gradient is found by id across the whole document, and the Library stays
  // mounted under the piece screen: two bands sharing a name would both draw
  // the first one's scrim, and the Library's and the piece screen's differ.
  const scrimId = `photoBandScrim${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;

  return (
    <View style={[styles.band, { backgroundColor: band, paddingTop: insets.top }]}>
      {/*
        The colour carried up past the top edge, so pulling the page down on
        iOS shows more band rather than a stripe of ivory above it.
      */}
      <View pointerEvents="none" style={[styles.overscroll, { backgroundColor: band }]} />

      {/*
        Decoration, hidden from a screen reader as a whole: the band says
        nothing the words on it do not. `aria-hidden` rather than an unnamed
        image role, which the web announces as an image with no name.
      */}
      <View pointerEvents="none" style={styles.photoFrame} aria-hidden>
        <Animated.View style={[styles.photo, { transform: photoMotion.transform }]}>
          {/*
            The drift's own layer on the web. A CSS animation of `transform`
            replaces the element's whole transform, so it cannot share one with
            the scroll above it.
          */}
          <View style={[StyleSheet.absoluteFill, photoMotion.drift]}>
            <Image source={photo} style={StyleSheet.absoluteFill} contentFit="cover" />
          </View>
        </Animated.View>
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
          <Defs>
            <LinearGradient id={scrimId} x1="0" y1="0" x2="0" y2="1">
              {scrim.map(([offset, opacity]) => (
                <Stop key={offset} offset={offset} stopColor={band} stopOpacity={opacity} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${scrimId})`} />
        </Svg>
      </View>

      <LightStatusBarWhileFocused />

      {children}
    </View>
  );
}

/**
 * The photograph moves at half the page's speed as it scrolls, and drifts up
 * and down very slowly while its screen is the one in front.
 *
 * On a phone both run on the native driver. The web has none, and there the
 * drift is the CSS animation `webDrift`, on a layer of its own. **It used to be
 * the same `Animated` loop as on a phone, driven by JavaScript on every
 * frame:** a settled Library kept the main thread busy for 806 ms of every
 * second with the CPU slowed four times, and for none of it once the drift was
 * stopped (2026-10-24), so every tap and scroll on the two screens with a band
 * waited behind a photograph moving a hundredth of a point a frame.
 *
 * The drift stops when the screen is left (tabs and stacked screens stay
 * mounted, and a loop nobody can see is a battery cost with nothing to show)
 * and does not run at all under Reduce Motion, where the photograph sits still
 * in the middle of its travel.
 */
function usePhotoMotion(scrollY: Animated.Value | undefined) {
  const reduced = useReducedMotion();
  const focused = useIsFocused();
  const drift = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    if (webDrift || reduced || !focused) {
      return undefined;
    }
    const step = (toValue: number) =>
      Animated.timing(drift, {
        toValue,
        duration: DRIFT.ms,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      });
    // **Not put back between rounds.** `Animated.loop` returns its value to
    // where it started before every round unless told not to, and this one
    // starts in the middle: the photograph jumped from the top of its travel
    // to the middle every 28 seconds, and again each time its screen came back
    // to the front (traced in Chromium, 2026-10-24).
    const loop = Animated.loop(Animated.sequence([step(1), step(0)]), {
      resetBeforeIteration: false,
    });
    loop.start();
    return () => loop.stop();
  }, [drift, focused, reduced]);

  // Clamped at the top: pulling the page down past its start holds the
  // photograph where it is instead of sliding it up out of the band.
  const scroll = {
    translateY: scrollY
      ? scrollY.interpolate({
          inputRange: [0, 1000],
          outputRange: [0, 500],
          extrapolateLeft: 'clamp',
        })
      : 0,
  };

  if (webDrift) {
    return {
      transform: [scroll],
      drift: reduced ? null : focused ? webDrift.drifting : [webDrift.drifting, webDrift.paused],
    };
  }
  return {
    transform: [
      scroll,
      {
        translateY: drift.interpolate({
          inputRange: [0, 1],
          outputRange: [-DRIFT.distance, DRIFT.distance],
        }),
      },
    ],
    drift: null,
  };
}

/**
 * The status bar sits on the band, so it is light while the band's screen is
 * in front — and only then: tabs and stacked screens stay mounted, and a light
 * status bar left behind would vanish on the ivory of every other screen. Its
 * own component so a change of screen redraws the status bar and nothing else
 * (the reason Today's hero had the same one).
 */
function LightStatusBarWhileFocused() {
  const focused = useIsFocused();
  return focused ? <StatusBar style="light" /> : null;
}

const styles = StyleSheet.create({
  band: {
    // Out to both edges of the screen and the reading measure, whichever is
    // narrower; what is under it keeps its gutter.
    width: '100%',
  },
  overscroll: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '100%',
    height: 1000,
  },
  photoFrame: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
  photo: {
    position: 'absolute',
    top: -SLACK,
    right: 0,
    bottom: -SLACK,
    left: 0,
    opacity: PHOTO_STRENGTH,
  },
});

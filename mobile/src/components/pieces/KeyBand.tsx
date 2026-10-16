import { useIsFocused } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { Image, type ImageSource } from 'expo-image';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { keyBandFor } from '../../lib/library/keyBand';
import { useReducedMotion } from '../../lib/useReducedMotion';

/**
 * How strongly the photograph prints into the key's colour.
 *
 * **The photograph is a shade map, not a picture.** Each one is shipped as
 * black with its alpha set to the photograph's darkness (`assets/hero/
 * SOURCES.md`), and drawn over the band with ordinary blending. That is the
 * arithmetic of multiplying a grey photograph into the colour: highlights leave
 * the band's own colour, shadows deepen it, and nothing is ever lighter than the
 * band, which is what keeps ivory type legible over every part of it.
 *
 * **It used to be a CSS blend mode** (`mixBlendMode: 'multiply'`) over the
 * colour photograph, **and it never blended, in any browser.** The computed
 * style said `multiply`, which is what was checked; but the photograph's own
 * frame was the backdrop it blended with, and that frame is transparent, so the
 * photograph was simply drawn at 62% on top. It showed on the owner's G major
 * piece (2026-10-16): an orange piano over a green band, the green only where
 * the scrim covered it. With G minor's oxblood the warm photograph had passed
 * for printed-in. A shade map needs no blending support anywhere, on the web
 * or native, and is smaller than the photograph it replaces.
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

/** The web has no native driver, and asking for one there only warns. */
const NATIVE_DRIVER = Platform.OS !== 'web';

/** `[offset, opacity]` pairs down the band: how much of its own colour covers the photograph. */
export type KeyBandScrim = readonly (readonly [number, number])[];

export interface KeyBandProps {
  /** The key the band takes its colour from (`keyBandFor`). */
  keySignature: string | null | undefined;
  /** The photograph's shade map: black, as opaque as the photograph is dark (see `PHOTO_STRENGTH`). */
  shade: ImageSource | number;
  /** Where the band's colour closes back over the photograph, so words sit on colour. */
  scrim: KeyBandScrim;
  /** The page's scroll offset, which the photograph moves at half of. */
  scrollY?: Animated.Value;
  /** What sits on the band, in ivory. The band pays the top inset; the caller sets the gutter. */
  children: ReactNode;
}

/**
 * A full-bleed band in a piece's key colour, with a photograph printed into
 * it: the Library's Continue band and the head of the piece screen
 * (`DECISIONS.md`, 2026-10-16). §3 law 6 names it as an exception, on those two
 * screens.
 *
 * **It runs under the status bar.** The screen opts out of the top inset
 * (`ScreenContainer.underStatusBar`) and the band pays it back from the inside,
 * so the colour reaches the top edge and the words still clear the island. The
 * status bar is light while the band's screen is in front.
 */
export function KeyBand({ keySignature, shade, scrim, scrollY, children }: KeyBandProps) {
  const insets = useSafeAreaInsets();
  const band = keyBandFor(keySignature);
  const photoMotion = usePhotoMotion(scrollY);
  // **One id per band, not one name for all of them.** On the web an SVG
  // gradient is found by id across the whole document, and the Library stays
  // mounted under the piece screen: two bands sharing a name drew the first
  // one's colour on both, which is one piece's key on another piece's band.
  const scrimId = `keyBandScrim${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;

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
        <Animated.View style={[styles.photo, { transform: photoMotion }]}>
          <Image source={shade} style={StyleSheet.absoluteFill} contentFit="cover" />
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
 * Both run on the native driver. The drift stops when the screen is left —
 * tabs and stacked screens stay mounted, and a loop nobody can see is a battery
 * cost with nothing to show — and does not run at all under Reduce Motion,
 * where the photograph sits still in the middle of its travel.
 */
function usePhotoMotion(scrollY: Animated.Value | undefined) {
  const reduced = useReducedMotion();
  const focused = useIsFocused();
  const drift = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    if (reduced || !focused) {
      return undefined;
    }
    const step = (toValue: number) =>
      Animated.timing(drift, {
        toValue,
        duration: DRIFT.ms,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: NATIVE_DRIVER,
      });
    const loop = Animated.loop(Animated.sequence([step(1), step(0)]));
    loop.start();
    return () => loop.stop();
  }, [drift, focused, reduced]);

  return [
    {
      // Clamped at the top: pulling the page down past its start holds the
      // photograph where it is instead of sliding it up out of the band.
      translateY: scrollY
        ? scrollY.interpolate({
            inputRange: [0, 1000],
            outputRange: [0, 500],
            extrapolateLeft: 'clamp',
          })
        : 0,
    },
    {
      translateY: drift.interpolate({
        inputRange: [0, 1],
        outputRange: [-DRIFT.distance, DRIFT.distance],
      }),
    },
  ];
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

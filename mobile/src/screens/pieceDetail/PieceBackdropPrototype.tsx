/* PROTOTYPE — for choosing, not the design. Depth behind the piece screen, in the piece's key colour. */
import { Image } from 'expo-image';
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

import { keyBandFor } from '../../lib/library/keyBand';
import { useReducedMotion } from '../../lib/useReducedMotion';

type Variant = 'clouds' | 'rings' | 'lights' | 'band';

function readVariant(): Variant | null {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const name = new URLSearchParams(window.location.search).get('bg');
    if (name === 'clouds' || name === 'rings' || name === 'lights' || name === 'band') return name;
  }
  return null;
}

export const PIECE_BACKDROP = readVariant();

/** The brass the Library's palette settled on, for warmth beside the key colour. */
const BRASS = '#DCC6A0';
const NATIVE_DRIVER = Platform.OS !== 'web';
const MULTIPLY = { mixBlendMode: 'multiply' } as ViewStyle;
const ISOLATE = { isolation: 'isolate' } as ViewStyle;
const PHOTO = require('../../../assets/hero/library-strings.jpg');

function useLoop(duration: number, { pingPong = true, delay = 0 } = {}) {
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    if (reduced) return undefined;
    value.setValue(0);
    const step = (to: number, ms: number, easing: (t: number) => number) =>
      Animated.timing(value, { toValue: to, duration: ms, easing, useNativeDriver: NATIVE_DRIVER });
    const loop = pingPong
      ? Animated.loop(
          Animated.sequence([
            step(1, duration, Easing.inOut(Easing.sin)),
            step(0, duration, Easing.inOut(Easing.sin)),
          ]),
        )
      : Animated.loop(step(1, duration, Easing.linear), { resetBeforeIteration: true });
    const timer = setTimeout(() => loop.start(), delay);
    return () => {
      clearTimeout(timer);
      loop.stop();
    };
  }, [duration, pingPong, delay, reduced, value]);
  return value;
}

function Glow({ id, size, color, opacity, hold = 0 }: { id: string; size: number; color: string; opacity: number; hold?: number }) {
  return (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={opacity} />
          <Stop offset={hold} stopColor={color} stopOpacity={hold > 0 ? opacity * 0.9 : opacity} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
    </Svg>
  );
}

/** The layer behind the whole screen, for the three patterns. */
export function PieceBackdrop({ keySignature }: { keySignature: string | null | undefined }) {
  const band = keyBandFor(keySignature);
  if (PIECE_BACKDROP === 'clouds') return <Clouds band={band} />;
  if (PIECE_BACKDROP === 'rings') return <Rings band={band} />;
  if (PIECE_BACKDROP === 'lights') return <Lights band={band} />;
  return null;
}

/** 1. Soft clouds in tints of the key colour and brass, drifting past one another. */
function Clouds({ band }: { band: string }) {
  const { width, height } = useWindowDimensions();
  const a = useLoop(14000);
  const b = useLoop(18000, { delay: 1200 });
  const c = useLoop(22000, { delay: 2500 });
  const size = width * 1.5;
  const blobs = [
    { v: a, color: band, left: width * 0.1, top: -size * 0.5, dx: 50, dy: 30, o: 0.3 },
    { v: b, color: BRASS, left: -size * 0.55, top: height * 0.25, dx: 60, dy: -40, o: 0.7 },
    { v: c, color: band, left: width * 0.25, top: height * 0.55, dx: -50, dy: -30, o: 0.22 },
  ];
  return (
    <View style={StyleSheet.absoluteFill}>
      {blobs.map((blob, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            left: blob.left,
            top: blob.top,
            transform: [
              { translateX: blob.v.interpolate({ inputRange: [0, 1], outputRange: [-blob.dx, blob.dx] }) },
              { translateY: blob.v.interpolate({ inputRange: [0, 1], outputRange: [-blob.dy, blob.dy] }) },
            ],
          }}
        >
          <Glow id={`pieceCloud${i}`} size={size} color={blob.color} opacity={blob.o} />
        </Animated.View>
      ))}
    </View>
  );
}

/** 2. Rings opening out from the Practice button, in the key colour, like a struck note. */
function Rings({ band }: { band: string }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // The Practice button's centre: the footer's action, just above the bottom inset.
  const cx = width / 2;
  const cy = height - insets.bottom - 46;
  const R = width * 1.05;
  const waves = [
    useLoop(7000, { pingPong: false }),
    useLoop(7000, { pingPong: false, delay: 1750 }),
    useLoop(7000, { pingPong: false, delay: 3500 }),
    useLoop(7000, { pingPong: false, delay: 5250 }),
  ];
  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={{ position: 'absolute', left: cx - R, top: cy - R }}>
        <Glow id="pieceRingGlow" size={R * 2} color={band} opacity={0.14} />
      </View>
      <Svg style={{ position: 'absolute', left: cx - R, top: cy - R }} width={R * 2} height={R * 2}>
        {Array.from({ length: 8 }, (_, i) => (
          <Circle key={i} cx={R} cy={R} r={(R * (i + 1)) / 8} stroke={band} strokeOpacity={0.08} strokeWidth={1} fill="none" />
        ))}
      </Svg>
      {waves.map((wave, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            left: cx - R,
            top: cy - R,
            opacity: wave.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.45, 0] }),
            transform: [{ scale: wave.interpolate({ inputRange: [0, 1], outputRange: [0.08, 1] }) }],
          }}
        >
          <Svg width={R * 2} height={R * 2}>
            <Circle cx={R} cy={R} r={R - 2} stroke={band} strokeWidth={2} fill="none" />
          </Svg>
        </Animated.View>
      ))}
    </View>
  );
}

const LIGHTS = [
  { x: 0.82, y: 0.05, r: 90, key: true, o: 0.22 },
  { x: 0.12, y: 0.1, r: 44, key: false, o: 0.6 },
  { x: 0.92, y: 0.32, r: 26, key: false, o: 0.7 },
  { x: 0.3, y: 0.62, r: 120, key: true, o: 0.12 },
  { x: 0.75, y: 0.55, r: 60, key: false, o: 0.5 },
  { x: 0.06, y: 0.78, r: 40, key: true, o: 0.2 },
  { x: 0.5, y: 0.82, r: 150, key: false, o: 0.35 },
  { x: 0.9, y: 0.92, r: 44, key: true, o: 0.2 },
];

/** 3. Out-of-focus lights drifting, some in the key colour and some in brass. */
function Lights({ band }: { band: string }) {
  const { width, height } = useWindowDimensions();
  const drift = [useLoop(8000), useLoop(10500, { delay: 700 }), useLoop(13000, { delay: 1500 })];
  return (
    <View style={StyleSheet.absoluteFill}>
      {LIGHTS.map((light, i) => {
        const v = drift[i % 3];
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: light.x * width - light.r,
              top: light.y * height - light.r,
              transform: [
                { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-14, 14] }) },
                { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [8, -8] }) },
              ],
            }}
          >
            <Glow id={`pieceLight${i}`} size={light.r * 2} color={light.key ? band : BRASS} opacity={light.o} hold={0.55} />
          </Animated.View>
        );
      })}
    </View>
  );
}

/**
 * 4. The Library's band carried onto the piece: the head of the screen on the
 * key colour with the strings printed into it, running under the status bar.
 */
export function PieceBandHead({ keySignature, children }: { keySignature: string | null | undefined; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const band = keyBandFor(keySignature);
  const drift = useLoop(14000);
  return (
    <View style={[styles.band, ISOLATE, { backgroundColor: band, paddingTop: insets.top }]}>
      <View pointerEvents="none" style={styles.photoFrame} aria-hidden>
        <Animated.View
          style={[
            styles.photo,
            MULTIPLY,
            { transform: [{ translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [-16, 16] }) }] },
          ]}
        >
          <Image source={PHOTO} style={StyleSheet.absoluteFill} contentFit="cover" />
        </Animated.View>
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
          <Defs>
            <LinearGradient id="pieceBandScrim" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={band} stopOpacity={0.3} />
              <Stop offset="0.45" stopColor={band} stopOpacity={0.45} />
              <Stop offset="1" stopColor={band} stopOpacity={0.85} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#pieceBandScrim)" />
        </Svg>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    paddingBottom: 18,
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
    top: -24,
    right: 0,
    bottom: -24,
    left: 0,
    opacity: 0.62,
  },
});

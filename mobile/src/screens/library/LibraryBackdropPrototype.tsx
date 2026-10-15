/* PROTOTYPE — not for commit. Ten layers to sit behind the Library. */
import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  Line,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import { fontFamily } from '../../design';
import { useReducedMotion } from '../../lib/useReducedMotion';

type BackdropVariant =
  | 'aurora'
  | 'sunbeams'
  | 'rings'
  | 'tempo'
  | 'glyphs'
  | 'staff'
  | 'bokeh'
  | 'waves'
  | 'grain'
  | 'lifted';

function readVariant(): BackdropVariant | null {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const bg = new URLSearchParams(window.location.search).get('bg');
    if (bg) return bg as BackdropVariant;
  }
  return (process.env.EXPO_PUBLIC_LIBRARY_BG as BackdropVariant | undefined) ?? null;
}

export const BACKDROP_VARIANT = readVariant();

// Prototype colours. A real version would put these in `design/colors.ts`.
//
// Three palettes, chosen with `?palette=`. `vivid` was the first pass: its
// glows ran at nearly twice the chroma of the app's own gold, so the ivory
// went peach and the white pages sat on a tint they do not belong to.
// `brass` keeps every hue within reach of `accent` and parchment; `slate`
// sets cool tones behind the warm pages instead.
const PALETTES = {
  vivid: {
    GOLD: '#9A7B4F', HONEY: '#E3B877', AMBER: '#D99A4E', ROSE: '#D9A48A', SAGE: '#B7BC98',
    DUSK: '#9FB2CC', CREAM: '#FFF9EE', SAND: '#EADCC4', WAVE2: '#E7CDA5', WAVE3: '#E0BC8C',
    LIFT_TOP: '#E6D6BA', LIFT_MID: '#EFE5D4',
  },
  brass: {
    GOLD: '#9A7B4F', HONEY: '#DCC6A0', AMBER: '#CDB087', ROSE: '#D9C2B4', SAGE: '#CBC9B4',
    DUSK: '#C9C6BC', CREAM: '#FFFCF6', SAND: '#ECE3D3', WAVE2: '#E5D8C1', WAVE3: '#DBCBAF',
    LIFT_TOP: '#E8DECC', LIFT_MID: '#F0E9DD',
  },
  slate: {
    GOLD: '#6E7C8A', HONEY: '#C3CFDA', AMBER: '#AFC0CE', ROSE: '#CCD6C8', SAGE: '#D5D9CB',
    DUSK: '#B2C1D2', CREAM: '#FBFCFC', SAND: '#E2E6E4', WAVE2: '#D3DCE2', WAVE3: '#C5D1DA',
    LIFT_TOP: '#DDE2E3', LIFT_MID: '#EBECE8',
  },
} as const;

function readPalette(): keyof typeof PALETTES {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const name = new URLSearchParams(window.location.search).get('palette');
    if (name && name in PALETTES) return name as keyof typeof PALETTES;
  }
  return 'brass';
}

const P = PALETTES[readPalette()];
const { GOLD, HONEY, AMBER, ROSE, SAGE, DUSK, CREAM, SAND } = P;
const PAGE = '#F7F2E9';

/** 0 → 1 → 0 forever (or 0 → 1 and restart), standing still under reduced motion. */
function useLoop(duration: number, { pingPong = true, delay = 0 } = {}) {
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) {
      value.setValue(0.5);
      return undefined;
    }
    const step = (to: number, ms: number, easing: (t: number) => number) =>
      Animated.timing(value, { toValue: to, duration: ms, easing, useNativeDriver: Platform.OS !== 'web' });
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

/** Moves a layer at `factor` of the scroll: 0 is fixed to the glass, 1 is stuck to the content. */
function parallax(scrollY: Animated.Value, factor: number) {
  return scrollY.interpolate({
    inputRange: [0, 1000],
    outputRange: [0, -1000 * factor],
    extrapolate: 'extend',
  });
}

/** A soft round glow: a colour at the centre fading to nothing. */
function Glow({
  id,
  size,
  color,
  opacity = 1,
  hold = 0,
}: {
  id: string;
  size: number;
  color: string;
  opacity?: number;
  /** How far out the colour holds before it fades — a bokeh disc rather than a haze. */
  hold?: number;
}) {
  return (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={opacity} />
          <Stop offset={hold > 0 ? hold : 0} stopColor={color} stopOpacity={hold > 0 ? opacity * 0.9 : opacity} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
    </Svg>
  );
}

export function LibraryBackdrop({
  variant,
  scrollY,
  bpm,
}: {
  variant: BackdropVariant;
  scrollY: Animated.Value;
  /** The Continue piece's marked tempo, for the one layer that keeps time. */
  bpm: number | null;
}) {
  switch (variant) {
    case 'aurora':
      return <Aurora scrollY={scrollY} />;
    case 'sunbeams':
      return <Sunbeams scrollY={scrollY} />;
    case 'rings':
      return <Rings scrollY={scrollY} />;
    case 'tempo':
      return <TempoBreath scrollY={scrollY} bpm={bpm} />;
    case 'glyphs':
      return <FloatingGlyphs scrollY={scrollY} />;
    case 'staff':
      return <FlowingStaff scrollY={scrollY} />;
    case 'bokeh':
      return <Bokeh scrollY={scrollY} />;
    case 'waves':
      return <WaveLayers scrollY={scrollY} />;
    case 'grain':
      return <MapleGrain scrollY={scrollY} />;
    case 'lifted':
      return <LiftedGround />;
    default:
      return null;
  }
}

// 1 ─────────────────────────────────────────────────────────────────────────
/** Three slow clouds of warm colour drifting past one another. */
function Aurora({ scrollY }: { scrollY: Animated.Value }) {
  const { width, height } = useWindowDimensions();
  const a = useLoop(14000);
  const b = useLoop(18000, { delay: 1200 });
  const c = useLoop(22000, { delay: 2500 });
  const size = width * 1.5;
  const blobs = [
    { v: a, color: HONEY, left: width * 0.05, top: -size * 0.45, dx: 60, dy: 40, o: 0.85 },
    { v: b, color: ROSE, left: -size * 0.55, top: height * 0.22, dx: 70, dy: -50, o: 0.75 },
    { v: c, color: DUSK, left: width * 0.2, top: height * 0.55, dx: -60, dy: -40, o: 0.6 },
    { v: a, color: SAGE, left: -size * 0.3, top: -size * 0.6, dx: 40, dy: 30, o: 0.45 },
  ];
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: parallax(scrollY, 0.15) }] }]}>
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
              { scale: blob.v.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.08] }) },
            ],
          }}
        >
          <Glow id={`aurora${i}`} size={size} color={blob.color} opacity={blob.o} />
        </Animated.View>
      ))}
    </Animated.View>
  );
}

// 2 ─────────────────────────────────────────────────────────────────────────
/** Late-afternoon light through a tall window, falling across the page and swaying. */
function Sunbeams({ scrollY }: { scrollY: Animated.Value }) {
  const { width, height } = useWindowDimensions();
  const sway = useLoop(9000);
  const beams = [
    { x: 0.1, w: 0.12 },
    { x: 0.28, w: 0.06 },
    { x: 0.4, w: 0.16 },
    { x: 0.62, w: 0.05 },
    { x: 0.72, w: 0.11 },
  ];
  const W = width * 1.8;
  const H = height * 1.6;
  return (
    <View style={StyleSheet.absoluteFill}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id="sunWash" x1="1" y1="0" x2="0.2" y2="0.75">
            <Stop offset="0" stopColor={AMBER} stopOpacity={0.55} />
            <Stop offset="0.5" stopColor={HONEY} stopOpacity={0.25} />
            <Stop offset="1" stopColor={PAGE} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#sunWash)" />
      </Svg>
      <Animated.View
        style={{
          position: 'absolute',
          left: -width * 0.25,
          top: -height * 0.55,
          width: W,
          height: H,
          opacity: sway.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] }),
          transform: [
            { translateY: parallax(scrollY, 0.1) },
            { rotate: sway.interpolate({ inputRange: [0, 1], outputRange: ['31deg', '35deg'] }) },
          ],
        }}
      >
        <Svg width={W} height={H}>
          <Defs>
            <LinearGradient id="beam" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={CREAM} stopOpacity={0} />
              <Stop offset="0.35" stopColor={CREAM} stopOpacity={0.95} />
              <Stop offset="1" stopColor={CREAM} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {beams.map((beam, i) => (
            <Rect key={i} x={beam.x * W} y={0} width={beam.w * W} height={H} fill="url(#beam)" />
          ))}
        </Svg>
      </Animated.View>
    </View>
  );
}

// 3 ─────────────────────────────────────────────────────────────────────────
/** Sound leaving the Practice button: rings that open out and fade, like a struck note. */
function Rings({ scrollY }: { scrollY: Animated.Value }) {
  const { width } = useWindowDimensions();
  const cx = width * 0.83;
  const cy = 165;
  const R = width * 1.1;
  const waves = [useLoop(7000, { pingPong: false }), useLoop(7000, { pingPong: false, delay: 1750 }), useLoop(7000, { pingPong: false, delay: 3500 }), useLoop(7000, { pingPong: false, delay: 5250 })];
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: parallax(scrollY, 0.9) }] }]}>
      <View style={{ position: 'absolute', left: cx - R, top: cy - R }}>
        <Glow id="ringGlow" size={R * 2} color={HONEY} opacity={0.4} />
      </View>
      <Svg style={{ position: 'absolute', left: cx - R, top: cy - R }} width={R * 2} height={R * 2}>
        {Array.from({ length: 9 }, (_, i) => (
          <Circle key={i} cx={R} cy={R} r={(R * (i + 1)) / 9} stroke={GOLD} strokeOpacity={0.09} strokeWidth={1} fill="none" />
        ))}
      </Svg>
      {waves.map((wave, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            left: cx - R,
            top: cy - R,
            opacity: wave.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.6, 0] }),
            transform: [{ scale: wave.interpolate({ inputRange: [0, 1], outputRange: [0.05, 1] }) }],
          }}
        >
          <Svg width={R * 2} height={R * 2}>
            <Circle cx={R} cy={R} r={R - 2} stroke={GOLD} strokeWidth={2} fill="none" />
          </Svg>
        </Animated.View>
      ))}
    </Animated.View>
  );
}

// 4 ─────────────────────────────────────────────────────────────────────────
/** A glow behind the Continue row that swells once a bar, at the piece's own tempo. */
function TempoBreath({ scrollY, bpm }: { scrollY: Animated.Value; bpm: number | null }) {
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const beat = useRef(new Animated.Value(0)).current;
  const bar = (4 * 60000) / (bpm && bpm > 20 ? bpm : 72);
  useEffect(() => {
    if (reduced) {
      beat.setValue(0.4);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(beat, { toValue: 1, duration: bar * 0.18, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(beat, { toValue: 0, duration: bar * 0.82, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bar, beat, reduced]);
  const size = width * 1.6;
  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={{ position: 'absolute', left: -width * 0.7, top: height * 0.55 }}>
        <Glow id="tempoLow" size={size} color={ROSE} opacity={0.35} />
      </View>
      <Animated.View
        style={{
          position: 'absolute',
          left: width / 2 - size / 2 + width * 0.2,
          top: 160 - size / 2,
          opacity: beat.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
          transform: [
            { translateY: parallax(scrollY, 1) },
            { scale: beat.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.06] }) },
          ],
        }}
      >
        <Glow id="tempoGlow" size={size} color={AMBER} opacity={0.6} />
      </Animated.View>
    </View>
  );
}

// 5 ─────────────────────────────────────────────────────────────────────────
type Mark =
  | { kind: 'glyph'; char: string }
  | { kind: 'note' }
  | { kind: 'pair' };

const MARKS: { mark: Mark; x: number; y: number; size: number; depth: 0 | 1 | 2; rotate: number }[] = [
  { mark: { kind: 'glyph', char: '' }, x: 0.66, y: -0.04, size: 230, depth: 2, rotate: 12 },
  { mark: { kind: 'note' }, x: 0.38, y: 0.0, size: 70, depth: 0, rotate: -10 },
  { mark: { kind: 'glyph', char: '' }, x: 0.5, y: 0.17, size: 90, depth: 1, rotate: 8 },
  { mark: { kind: 'pair' }, x: 0.4, y: 0.62, size: 80, depth: 0, rotate: -6 },
  { mark: { kind: 'pair' }, x: 0.12, y: 0.52, size: 130, depth: 2, rotate: -8 },
  { mark: { kind: 'glyph', char: '' }, x: 0.8, y: 0.62, size: 70, depth: 0, rotate: -6 },
  { mark: { kind: 'glyph', char: '' }, x: 0.58, y: 0.86, size: 150, depth: 1, rotate: -14 },
  { mark: { kind: 'note' }, x: 0.2, y: 1.05, size: 110, depth: 1, rotate: 14 },
  { mark: { kind: 'glyph', char: '' }, x: 0.04, y: 0.8, size: 60, depth: 0, rotate: 0 },
  { mark: { kind: 'pair' }, x: 0.62, y: 1.2, size: 90, depth: 0, rotate: 10 },
  { mark: { kind: 'glyph', char: '' }, x: 0.15, y: 1.45, size: 170, depth: 2, rotate: 6 },
  { mark: { kind: 'note' }, x: 0.75, y: 1.6, size: 80, depth: 1, rotate: -12 },
  { mark: { kind: 'glyph', char: '' }, x: 0.35, y: 1.85, size: 70, depth: 0, rotate: 4 },
];
const DEPTH = [
  { opacity: 0.12, parallax: 0.25 },
  { opacity: 0.17, parallax: 0.5 },
  { opacity: 0.22, parallax: 0.85 },
];

function MarkDrawing({ mark, size }: { mark: Mark; size: number }) {
  if (mark.kind === 'glyph') {
    return (
      <Svg width={size} height={size * 1.6}>
        <SvgText x={size * 0.15} y={size * 1.05} fontFamily={fontFamily.music} fontSize={size * 0.9} fill={GOLD}>
          {mark.char}
        </SvgText>
      </Svg>
    );
  }
  if (mark.kind === 'note') {
    const r = size * 0.16;
    return (
      <Svg width={size} height={size * 1.4}>
        <Ellipse cx={size * 0.4} cy={size * 1.2} rx={r * 1.25} ry={r * 0.85} fill={GOLD} transform={`rotate(-20 ${size * 0.4} ${size * 1.2})`} />
        <Line x1={size * 0.4 + r * 1.15} y1={size * 1.15} x2={size * 0.4 + r * 1.15} y2={size * 0.1} stroke={GOLD} strokeWidth={size * 0.035} />
      </Svg>
    );
  }
  const r = size * 0.11;
  return (
    <Svg width={size} height={size * 1.1}>
      <Ellipse cx={size * 0.2} cy={size * 0.95} rx={r * 1.25} ry={r * 0.85} fill={GOLD} transform={`rotate(-20 ${size * 0.2} ${size * 0.95})`} />
      <Ellipse cx={size * 0.75} cy={size * 0.8} rx={r * 1.25} ry={r * 0.85} fill={GOLD} transform={`rotate(-20 ${size * 0.75} ${size * 0.8})`} />
      <Line x1={size * 0.2 + r * 1.15} y1={size * 0.92} x2={size * 0.2 + r * 1.15} y2={size * 0.18} stroke={GOLD} strokeWidth={size * 0.03} />
      <Line x1={size * 0.75 + r * 1.15} y1={size * 0.77} x2={size * 0.75 + r * 1.15} y2={size * 0.03} stroke={GOLD} strokeWidth={size * 0.03} />
      <Path d={`M${size * 0.2 + r * 1.1} ${size * 0.18} L${size * 0.75 + r * 1.2} ${size * 0.03} L${size * 0.75 + r * 1.2} ${size * 0.12} L${size * 0.2 + r * 1.1} ${size * 0.27} Z`} fill={GOLD} />
    </Svg>
  );
}

/** Notation at three depths: near marks are larger and darker and pass faster as you scroll. */
function FloatingGlyphs({ scrollY }: { scrollY: Animated.Value }) {
  const { width, height } = useWindowDimensions();
  const drift = [useLoop(7000), useLoop(9000, { delay: 800 }), useLoop(11000, { delay: 1600 })];
  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={{ position: 'absolute', right: -width * 0.6, top: -width * 0.7 }}>
        <Glow id="glyphGlow" size={width * 1.6} color={HONEY} opacity={0.4} />
      </View>
      {MARKS.map((item, i) => {
        const depth = DEPTH[item.depth];
        const v = drift[i % 3];
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: item.x * width,
              top: item.y * height,
              opacity: depth.opacity,
              transform: [
                { translateY: parallax(scrollY, depth.parallax) },
                { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-8 - item.depth * 4, 8 + item.depth * 4] }) },
                { rotate: `${item.rotate}deg` },
              ],
            }}
          >
            <MarkDrawing mark={item.mark} size={item.size} />
          </Animated.View>
        );
      })}
    </View>
  );
}

// 6 ─────────────────────────────────────────────────────────────────────────
function sinePath(length: number, amplitude: number, wavelength: number, y: number) {
  let d = `M0 ${y}`;
  for (let x = 0; x <= length; x += 6) {
    d += ` L${x} ${(y + amplitude * Math.sin((x / wavelength) * Math.PI * 2)).toFixed(2)}`;
  }
  return d;
}

/** Staves that move like plucked strings: a slow wave travelling along five lines. */
function FlowingStaff({ scrollY }: { scrollY: Animated.Value }) {
  const { width, height } = useWindowDimensions();
  const staves = [
    { top: height * 0.06, gap: 12, amp: 9, wave: width * 0.95, speed: 9000, opacity: 0.22, depth: 0.25, rotate: -7 },
    { top: height * 0.5, gap: 20, amp: 16, wave: width * 1.25, speed: 13000, opacity: 0.16, depth: 0.55, rotate: 5 },
    { top: height * 1.05, gap: 28, amp: 22, wave: width * 1.5, speed: 16000, opacity: 0.12, depth: 0.9, rotate: -4 },
  ];
  const runs = [useLoop(9000, { pingPong: false }), useLoop(13000, { pingPong: false }), useLoop(16000, { pingPong: false })];
  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={{ position: 'absolute', left: -width * 0.5, top: -width * 0.6 }}>
        <Glow id="staffGlow" size={width * 1.8} color={HONEY} opacity={0.35} />
      </View>
      {staves.map((staff, i) => {
        const length = width * 2 + staff.wave * 2;
        const h = staff.gap * 4 + staff.amp * 2 + 4;
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: -width * 0.4,
              top: staff.top,
              width: width * 1.8,
              height: h,
              overflow: 'hidden',
              opacity: staff.opacity,
              transform: [{ translateY: parallax(scrollY, staff.depth) }, { rotate: `${staff.rotate}deg` }],
            }}
          >
            <Animated.View
              style={{
                transform: [{ translateX: runs[i].interpolate({ inputRange: [0, 1], outputRange: [0, -staff.wave] }) }],
              }}
            >
              <Svg width={length} height={h}>
                {[0, 1, 2, 3, 4].map((line) => (
                  <Path
                    key={line}
                    d={sinePath(length, staff.amp * (1 - Math.abs(line - 2) * 0.08), staff.wave, staff.amp + 2 + line * staff.gap)}
                    stroke={GOLD}
                    strokeWidth={1.4}
                    fill="none"
                  />
                ))}
              </Svg>
            </Animated.View>
          </Animated.View>
        );
      })}
    </View>
  );
}

// 7 ─────────────────────────────────────────────────────────────────────────
const LIGHTS = [
  { x: 0.78, y: 0.04, r: 90, c: HONEY, o: 0.55 },
  { x: 0.55, y: 0.14, r: 34, c: AMBER, o: 0.35 },
  { x: 0.1, y: 0.1, r: 50, c: ROSE, o: 0.35 },
  { x: 0.92, y: 0.3, r: 26, c: HONEY, o: 0.5 },
  { x: 0.3, y: 0.36, r: 120, c: ROSE, o: 0.22 },
  { x: 0.7, y: 0.5, r: 60, c: HONEY, o: 0.35 },
  { x: 0.05, y: 0.62, r: 40, c: AMBER, o: 0.3 },
  { x: 0.45, y: 0.72, r: 150, c: HONEY, o: 0.2 },
  { x: 0.88, y: 0.85, r: 44, c: ROSE, o: 0.35 },
  { x: 0.2, y: 0.95, r: 70, c: HONEY, o: 0.3 },
  { x: 0.62, y: 1.1, r: 36, c: AMBER, o: 0.35 },
  { x: 0.08, y: 1.3, r: 100, c: ROSE, o: 0.22 },
  { x: 0.8, y: 1.4, r: 80, c: HONEY, o: 0.3 },
];

/** Stage lights out of focus: soft discs at different distances, drifting. */
function Bokeh({ scrollY }: { scrollY: Animated.Value }) {
  const { width, height } = useWindowDimensions();
  const drift = [useLoop(8000), useLoop(10500, { delay: 700 }), useLoop(13000, { delay: 1500 })];
  return (
    <View style={StyleSheet.absoluteFill}>
      {LIGHTS.map((light, i) => {
        const v = drift[i % 3];
        const depth = Math.min(1, light.r / 150);
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: light.x * width - light.r,
              top: light.y * height - light.r,
              transform: [
                { translateY: parallax(scrollY, 0.2 + depth * 0.7) },
                { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-14, 14] }) },
                { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [8, -8] }) },
              ],
            }}
          >
            <Glow id={`bokeh${i}`} size={light.r * 2} color={light.c} opacity={light.o} hold={0.55} />
          </Animated.View>
        );
      })}
    </View>
  );
}

// 8 ─────────────────────────────────────────────────────────────────────────
/** A curtain whose lower edge is a waveform: amplitude rising and falling like a phrase. */
function wavePath(width: number, depth: number, seed: number) {
  let d = `M0 0 L0 ${depth}`;
  for (let x = 0; x <= width; x += 4) {
    const t = x / width;
    const envelope = Math.sin(t * Math.PI * (1.3 + seed * 0.4) + seed) * 0.5 + 0.5;
    const swell = Math.sin(t * Math.PI * 2 * (0.8 + seed * 0.3) + seed * 2) * 26;
    const detail = Math.sin(t * Math.PI * 2 * (9 + seed * 3)) * 6 * envelope;
    d += ` L${x} ${(depth + swell + detail + envelope * 30).toFixed(1)}`;
  }
  return `${d} L${width} 0 Z`;
}

/** Three planes of waveform behind the top of the page, each further away than the last. */
function WaveLayers({ scrollY }: { scrollY: Animated.Value }) {
  const { width } = useWindowDimensions();
  const W = width * 1.4;
  const layers = [
    { depth: 400, color: SAND, opacity: 0.85, factor: 0.15, drift: useLoop(16000) },
    { depth: 300, color: P.WAVE2, opacity: 0.6, factor: 0.35, drift: useLoop(12000, { delay: 900 }) },
    { depth: 200, color: P.WAVE3, opacity: 0.45, factor: 0.6, drift: useLoop(9000, { delay: 1800 }) },
  ];
  const paths = useMemo(() => layers.map((layer, i) => wavePath(W, layer.depth, i + 1)), [W]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={StyleSheet.absoluteFill}>
      {layers.map((layer, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            left: -width * 0.2,
            top: 0,
            transform: [
              { translateY: parallax(scrollY, layer.factor) },
              { translateX: layer.drift.interpolate({ inputRange: [0, 1], outputRange: [-24, 24] }) },
            ],
          }}
        >
          <Svg width={W} height={layer.depth + 120}>
            <Path d={paths[i]} fill={layer.color} fillOpacity={layer.opacity} />
          </Svg>
        </Animated.View>
      ))}
    </View>
  );
}

// 9 ─────────────────────────────────────────────────────────────────────────
/** The figure in a violin's maple back: flowing grain, and a sheen that moves as you scroll. */
function MapleGrain({ scrollY }: { scrollY: Animated.Value }) {
  const { width, height } = useWindowDimensions();
  const H = height * 2.2;
  const lines = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < 46; i += 1) {
      const base = i * (H / 46);
      let d = '';
      for (let x = -10; x <= width + 10; x += 8) {
        const t = x / width;
        const y =
          base +
          Math.sin(t * 3.1 + i * 0.22) * 18 +
          Math.sin(t * 7.3 + i * 0.5) * 5 +
          Math.sin(i * 0.37) * 12;
        d += `${d ? ' L' : 'M'}${x} ${y.toFixed(1)}`;
      }
      out.push(d);
    }
    return out;
  }, [width, H]);
  return (
    <View style={StyleSheet.absoluteFill}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id="mapleWash" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={HONEY} stopOpacity={0.45} />
            <Stop offset="0.6" stopColor={SAND} stopOpacity={0.25} />
            <Stop offset="1" stopColor={PAGE} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#mapleWash)" />
      </Svg>
      <Animated.View style={{ position: 'absolute', left: 0, top: 0, transform: [{ translateY: parallax(scrollY, 0.35) }] }}>
        <Svg width={width} height={H}>
          {lines.map((d, i) => (
            <Path key={i} d={d} stroke={GOLD} strokeOpacity={i % 3 === 0 ? 0.16 : 0.09} strokeWidth={i % 3 === 0 ? 1.2 : 0.8} fill="none" />
          ))}
        </Svg>
      </Animated.View>
      <Animated.View
        style={{
          position: 'absolute',
          left: -width * 0.5,
          top: height * 0.1,
          width: width * 2,
          height: 260,
          transform: [
            { translateY: scrollY.interpolate({ inputRange: [0, 1000], outputRange: [0, 600], extrapolate: 'extend' }) },
            { rotate: '-18deg' },
          ],
        }}
      >
        <Svg width={width * 2} height={260}>
          <Defs>
            <LinearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={CREAM} stopOpacity={0} />
              <Stop offset="0.5" stopColor={CREAM} stopOpacity={0.75} />
              <Stop offset="1" stopColor={CREAM} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={width * 2} height={260} fill="url(#sheen)" />
        </Svg>
      </Animated.View>
    </View>
  );
}

// 10 ────────────────────────────────────────────────────────────────────────
/** A deeper ground at the top, so the pages can sit above it with a shadow of their own. */
function LiftedGround() {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        <LinearGradient id="liftWash" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={P.LIFT_TOP} stopOpacity={1} />
          <Stop offset="0.55" stopColor={P.LIFT_MID} stopOpacity={1} />
          <Stop offset="1" stopColor={PAGE} stopOpacity={1} />
        </LinearGradient>
        <RadialGradient id="liftLight" cx="30%" cy="0%" r="80%">
          <Stop offset="0" stopColor={CREAM} stopOpacity={0.9} />
          <Stop offset="1" stopColor={CREAM} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width="100%" height="100%" fill="url(#liftWash)" />
      <Rect x={0} y={0} width="100%" height="100%" fill="url(#liftLight)" />
    </Svg>
  );
}

/** The shadow a page casts on the lifted ground — two of them, a contact shadow and a soft one. */
export const LIFTED_PAGE_SHADOW =
  BACKDROP_VARIANT === 'lifted'
    ? ({
        boxShadow: '0 1px 2px rgba(74, 54, 24, 0.10), 0 14px 30px -6px rgba(74, 54, 24, 0.22)',
        borderColor: 'transparent',
      } as const)
    : null;

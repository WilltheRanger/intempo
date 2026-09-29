import { StyleSheet, View } from 'react-native';
import Svg, { Ellipse, G, Line, Rect } from 'react-native-svg';

import { FadeIn } from '../../components/motion';
import { PrimaryButton, Text } from '../../components/primitives';
import { colors, spacing } from '../../design';
import { CentredScreen } from './CentredScreen';

const ART = 64;

export interface OnboardingHowItWorksProps {
  onNext: () => void;
}

/**
 * What InTempo does, as three pictures and three short lines: the first
 * screen of onboarding, before "Let's get you set up".
 *
 * **A screen of its own, not a sentence** (the owner, 2026-09-29: "make a
 * seperate screen on what intempo does instead of writing that no one will
 * read"). A first-time walk found nothing said what the app was for until the
 * fourth question; the fix was a sentence under the Welcome's title, and a
 * sentence under a title is the thing nobody reads. Each line here is four or
 * five words, and the picture beside it carries the rest.
 *
 * The third picture is the result screen's own bar chart in miniature, in its
 * own three colours, so the first result a musician sees is one they have
 * already been shown.
 *
 * The three-foot test: the three pictures down the middle first, the title
 * second, Next third. No card round the rows (§3 law 3): the column and the
 * spacing group them.
 */
export function OnboardingHowItWorks({ onNext }: OnboardingHowItWorksProps) {
  return (
    <CentredScreen footer={<PrimaryButton label="Next" onPress={onNext} />}>
      <Text variant="screenTitle" accessibilityRole="header" style={styles.title}>
        How InTempo works
      </Text>
      <View style={styles.rows}>
        <FadeIn index={0} style={styles.row}>
          <PageArt />
          <Text variant="pieceTitle" style={styles.line}>
            Photograph your music
          </Text>
        </FadeIn>
        <FadeIn index={1} style={styles.row}>
          <PlayingArt />
          <Text variant="pieceTitle" style={styles.line}>
            Play it through
          </Text>
        </FadeIn>
        <FadeIn index={2} style={styles.row}>
          <BarsArt />
          <Text variant="pieceTitle" style={styles.line}>
            See where you rushed or dragged
          </Text>
        </FadeIn>
      </View>
    </CentredScreen>
  );
}

/** A page of music inside the camera's corner marks. */
function PageArt() {
  const staves = [18, 32, 46];
  const heads: ReadonlyArray<readonly [number, number]> = [
    [24, 21],
    [30, 18],
    [37, 22.5],
    [26, 33.5],
    [33, 36.5],
    [40, 32],
    [25, 49],
    [35, 46],
  ];
  const corner = 7;
  return (
    <Svg width={ART} height={ART} viewBox="0 0 64 64" accessible={false}>
      <Rect x={15} y={8} width={34} height={48} rx={2} fill={colors.surface} stroke={colors.textTertiary} strokeWidth={1} />
      {staves.flatMap((top) =>
        [0, 3, 6].map((offset) => (
          <Line
            key={`${top}-${offset}`}
            x1={19}
            x2={45}
            y1={top + offset}
            y2={top + offset}
            stroke={colors.textTertiary}
            strokeWidth={0.6}
          />
        )),
      )}
      {heads.map(([x, y]) => (
        <Ellipse key={`${x}-${y}`} cx={x} cy={y} rx={1.8} ry={1.4} fill={colors.textPrimary} />
      ))}
      {[
        [6, 4, 1, 1],
        [58, 4, -1, 1],
        [6, 60, 1, -1],
        [58, 60, -1, -1],
      ].map(([x, y, dx, dy]) => (
        <G key={`${x}-${y}`}>
          <Line x1={x} y1={y} x2={x + dx * corner} y2={y} stroke={colors.accent} strokeWidth={2} strokeLinecap="round" />
          <Line x1={x} y1={y} x2={x} y2={y + dy * corner} stroke={colors.accent} strokeWidth={2} strokeLinecap="round" />
        </G>
      ))}
    </Svg>
  );
}

/** A sound, drawn the way the microphone step draws one. */
function PlayingArt() {
  const heights = [8, 18, 30, 16, 40, 26, 36, 14, 22, 10];
  return (
    <Svg width={ART} height={ART} viewBox="0 0 64 64" accessible={false}>
      {heights.map((height, index) => {
        const x = 9.5 + index * 5;
        return (
          <Line
            key={x}
            x1={x}
            x2={x}
            y1={32 - height / 2}
            y2={32 + height / 2}
            stroke={colors.accent}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        );
      })}
    </Svg>
  );
}

/** The result screen's bar-by-bar chart, five bars of it. */
function BarsArt() {
  const bars: ReadonlyArray<readonly [number, string]> = [
    [4, colors.verdictOn],
    [7, colors.verdictOn],
    [16, colors.verdictMid],
    [26, colors.verdictBad],
    [6, colors.verdictOn],
  ];
  const base = 44;
  return (
    <Svg width={ART} height={ART} viewBox="0 0 64 64" accessible={false}>
      {bars.map(([height, fill], index) => (
        <Rect key={index} x={9 + index * 10} y={base - height} width={7} height={height} rx={1.5} fill={fill} />
      ))}
      <Line x1={6} x2={58} y1={base} y2={base} stroke={colors.textTertiary} strokeWidth={1} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  title: {
    textAlign: 'center',
  },
  rows: {
    marginTop: spacing['4xl'],
    gap: spacing['2xl'],
    width: '100%',
    maxWidth: 320,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
  },
  line: {
    flex: 1,
  },
});

import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { MARK, RESTING, markLength, markPath, type MarkFrame } from '../../lib/brand/mark';

const PATH = markPath();
const LENGTH = markLength();

export interface BrandMarkProps {
  size: number;
  /** The line, the band behind it and its centre line. */
  lineColor: string;
  dotColor: string;
  /** A moment of the opening animation (`markFrame`); at rest when omitted. */
  frame?: MarkFrame;
}

/**
 * InTempo's mark, "Settle", drawn from `design/brandMark.json` — the same
 * geometry `tools/draw-brand-assets.py` draws the app icon from, so the mark
 * on screen is the icon the musician just tapped.
 *
 * Decorative: whatever shows it says what it is for.
 */
export function BrandMark({ size, lineColor, dotColor, frame = RESTING }: BrandMarkProps) {
  const { band, centre, curve, dot, viewBox } = MARK;
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${viewBox} ${viewBox}`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Rect
        x={band.x}
        y={band.y}
        width={band.width}
        height={band.height}
        fill={lineColor}
        opacity={band.opacity * frame.band}
      />
      <Rect
        x={band.x}
        y={centre.y - centre.width / 2}
        width={band.width}
        height={centre.width}
        fill={lineColor}
        opacity={centre.opacity * frame.band}
      />
      <Path
        d={PATH}
        stroke={lineColor}
        strokeWidth={curve.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        strokeDasharray={`${LENGTH} ${LENGTH}`}
        strokeDashoffset={LENGTH * (1 - frame.drawn)}
      />
      {frame.dotScale > 0 ? (
        <Circle
          cx={dot.x}
          cy={dot.y}
          r={dot.r * frame.dotScale}
          fill={dotColor}
          opacity={frame.dotOpacity}
        />
      ) : null}
    </Svg>
  );
}

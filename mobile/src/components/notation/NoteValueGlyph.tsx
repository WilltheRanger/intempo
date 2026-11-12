import Svg, { Line, Text as SvgText } from 'react-native-svg';

import { fontFamily } from '../../design';
import type { NoteValue } from '../../lib/notation/durationPicker';
import { drawNoteValue } from '../../lib/notation/noteValueGlyph';

/**
 * One note value as a symbol, for a control that chooses a duration. The
 * layout is `lib/notation/noteValueGlyph.ts`; this only draws it.
 *
 * Decoration to assistive tech: the control around it carries the name.
 */
export function NoteValueGlyph({
  value,
  dotted = false,
  color,
  lineGap = 5,
}: {
  value: NoteValue;
  dotted?: boolean;
  color: string;
  /** One staff space, in points. */
  lineGap?: number;
}) {
  const d = drawNoteValue(value, dotted, lineGap);
  return (
    <Svg width={d.width} height={d.height} aria-hidden>
      {d.stem ? (
        <Line
          x1={d.stem.x}
          y1={d.stem.from}
          x2={d.stem.x}
          y2={d.stem.to}
          stroke={color}
          strokeWidth={d.stem.width}
        />
      ) : null}
      <SvgText x={d.head.x} y={d.head.y} fill={color} fontSize={d.fontSize} fontFamily={fontFamily.music}>
        {d.head.glyph}
      </SvgText>
      {d.flag ? (
        <SvgText x={d.flag.x} y={d.flag.y} fill={color} fontSize={d.fontSize} fontFamily={fontFamily.music}>
          {d.flag.glyph}
        </SvgText>
      ) : null}
      {d.dot ? (
        <SvgText x={d.dot.x} y={d.dot.y} fill={color} fontSize={d.fontSize} fontFamily={fontFamily.music}>
          {d.dot.glyph}
        </SvgText>
      ) : null}
    </Svg>
  );
}

import { useId, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Rect } from 'react-native-svg';

import { BORDER_WIDTH, colors } from '../../design';
import {
  bandEdgesAt,
  centreLabelTop,
  curveSpan,
  smoothPath,
  toneStretches,
  trendY,
  type Tone,
  type ToneStretch,
  type TrendData,
  type TrendPoint,
} from '../../lib/verdict/trend';
import { Text } from '../primitives/Text';

/** The line: heavy enough to be the subject, not a grid line. */
const STROKE = 3;
/** The rail under the graph, and the dots under the rail. */
const RAIL_HEIGHT = 22;
const RAIL_Y = 5;
const MARK_Y = 16;
const MARK = 2.5;
/** The words' line height (`caption`), and the gap they keep from any line. */
const LABEL_HEIGHT = 16;
const LABEL_CLEARANCE = 5;

export interface TrendPlotProps {
  data: TrendData;
  height: number;
  /** What up and down mean — "faster" and "slower", "further off". */
  ends?: { up?: string; down?: string };
  /** Said once on the target line: "96", "on tempo", "in tune". */
  centreLabel?: string | null;
  /** A point to mark with a cursor and a larger dot. */
  selected?: TrendPoint | null;
  /**
   * A rail under the graph: the stretches the line covers, a passage in the
   * accent, and a dot under each mark — all as `at`, 0 to 1 along the line.
   */
  rail?: {
    span?: { from: number; to: number } | null;
    marks?: readonly number[];
  } | null;
}

/**
 * A trend as the result screen draws it (the owner's "A · Refined line",
 * 2026-09-29), for every graph that shows one: a take bar by bar on the
 * result, takes one after another on Insights and on a piece's takes.
 *
 * **One curve, coloured by where it is** (the owner's "C · Green when on
 * tempo", 2026-09-29): green inside the band; amber from exactly where it
 * crosses the band's edge and deep red past the far edge — cut along the line
 * where its centre crosses (`toneStretches`), so each stretch is one colour
 * across its whole width. The curve is monotone (`smoothPath`), so it never
 * peaks above the value that made it.
 *
 * **No fill between the line and the band** (the owner, 2026-10-01: "its the
 * colored fill in between"). It was a tint the colour of the line above it,
 * clipped to outside the band; on a phone, over five takes, it read as loose
 * tan blocks standing beside the line rather than as a shadow of it, and the
 * line already says everything the tint did.
 *
 * **No boxes and no axis column.** The band is the only filled shape and runs
 * the full width; the words sit inside the graph at its right edge. It draws
 * and measures itself and nothing else: whether it answers a finger is the
 * caller's (`TrendChart`).
 */
export function TrendPlot({ data, height, ends, centreLabel, selected, rail }: TrendPlotProps) {
  const [width, setWidth] = useState(0);
  // The centre word's width, measured once it has drawn; a guess until then.
  const [labelWidth, setLabelWidth] = useState(60);
  // Inset by the end dot, so a line that ends at the edge ends on a whole dot.
  const inset = STROKE + 1;
  const x = (along: number) => inset + along * Math.max(0, width - inset * 2);
  const y = (value: number) => trendY(value, data, height);
  // SVG ids are document-wide on the web, and several of these can be mounted.
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');

  function handleLayout(event: LayoutChangeEvent) {
    const next = event.nativeEvent.layout.width;
    setWidth((current) => (current === next ? current : next));
  }

  // The band as one shape: along its top edge, then back along its bottom.
  const bandPath = data.band.length
    ? `M ${data.band.map((b) => `${x(b.at)},${y(b.high)}`).join(' L ')} L ${[...data.band]
        .reverse()
        .map((b) => `${x(b.at)},${y(b.low)}`)
        .join(' L ')} Z`
    : '';
  const centrePath = data.band.length
    ? `M ${data.band.map((b) => `${x(b.at)},${y(b.centre)}`).join(' L ')}`
    : '';
  const curves = data.runs.map((run) => ({
    run,
    line: smoothPath(run.map((p) => ({ x: x(p.at), y: y(p.value) }))),
  }));
  // Each run cut into stretches of one colour along its length; the first and
  // last reach past the run's ends so the round caps are the run's own colour.
  const edgesAt = bandEdgesAt(data.band, x, y);
  const lineStretches = curves.flatMap(({ run }) => {
    const stretches = toneStretches(
      run.map((p) => ({ x: x(p.at), y: y(p.value) })),
      edgesAt,
    );
    if (stretches.length) {
      stretches[0] = { ...stretches[0], from: stretches[0].from - STROKE * 2 };
      const lastIndex = stretches.length - 1;
      stretches[lastIndex] = { ...stretches[lastIndex], to: stretches[lastIndex].to + STROKE * 2 };
    }
    return stretches;
  });

  const centreY = data.band.length ? y(data.band[data.band.length - 1].centre) : height / 2;
  // The label sits at the right edge, where the line ends, beside the target
  // and clear of wherever the line runs beneath it (`centreLabelTop`).
  const lastRun = data.runs[data.runs.length - 1];
  const endY = lastRun ? y(lastRun[lastRun.length - 1].value) : centreY;
  const under = curves
    .map(({ run }) =>
      curveSpan(
        run.map((p) => ({ x: x(p.at), y: y(p.value) })),
        width - labelWidth,
        width,
      ),
    )
    .filter((span): span is { top: number; bottom: number } => span !== null);
  const labelTop = centreLabelTop({
    centreY,
    endY,
    line: under.length
      ? {
          top: Math.min(...under.map((span) => span.top)) - (STROKE + 0.5),
          bottom: Math.max(...under.map((span) => span.bottom)) + (STROKE + 0.5),
        }
      : null,
    // Clear of the words at the top and bottom, where there are any.
    minTop: ends?.up ? 18 : 0,
    maxTop: height - (ends?.down ? 20 : LABEL_HEIGHT),
    textHeight: LABEL_HEIGHT,
    clearance: LABEL_CLEARANCE,
  });

  return (
    <View onLayout={handleLayout}>
      <View style={{ height }}>
        {width > 0 ? (
          <Svg width={width} height={height} pointerEvents="none">
            <Defs>
              {TONES.map((tone) => (
                <ClipPath key={tone} id={`${tone}${id}`}>
                  {rectsFor(lineStretches, tone).map((r) => (
                    <Rect key={r.from} x={r.from} y={-height} width={r.to - r.from} height={height * 3} />
                  ))}
                </ClipPath>
              ))}
            </Defs>
            <Path d={bandPath} fill={colors.border} opacity={0.55} />
            <Path
              d={centrePath}
              stroke={colors.chartRule}
              strokeWidth={BORDER_WIDTH}
              opacity={0.7}
              fill="none"
            />

            {/* The line, one colour across its width wherever it is (`toneStretches`). */}
            {TONES.map((tone) => (
              <G key={tone} clipPath={`url(#${tone}${id})`}>
                {curves.map(({ run, line }) => (
                  <Path
                    key={run[0].measure}
                    d={line}
                    stroke={toneColour(tone)}
                    strokeWidth={STROKE}
                    strokeLinecap="round"
                    fill="none"
                  />
                ))}
              </G>
            ))}
            {/* Where a run ends, a dot — so a line that stops reads as ending. */}
            {data.runs.map((run) => {
              const end = run[run.length - 1];
              return (
                <Circle
                  key={end.measure}
                  cx={x(end.at)}
                  cy={y(end.value)}
                  r={STROKE + 0.5}
                  fill={lineColour(end.tone)}
                />
              );
            })}

            {selected ? (
              <>
                <Line
                  x1={x(selected.at)}
                  x2={x(selected.at)}
                  y1={0}
                  y2={height}
                  stroke={colors.chartRule}
                  strokeWidth={BORDER_WIDTH}
                />
                <Circle
                  cx={x(selected.at)}
                  cy={y(selected.value)}
                  r={6}
                  fill={lineColour(selected.tone)}
                  stroke={colors.bg}
                  strokeWidth={2}
                />
              </>
            ) : null}
          </Svg>
        ) : null}
        {ends?.up ? (
          <Text variant="caption" color="textTertiary" style={[styles.end, styles.endUp]} pointerEvents="none">
            {ends.up}
          </Text>
        ) : null}
        {centreLabel ? (
          <Text
            variant="caption"
            color="textSecondary"
            style={[styles.end, { top: labelTop }]}
            pointerEvents="none"
            onLayout={(event) => {
              const next = Math.ceil(event.nativeEvent.layout.width);
              setLabelWidth((current) => (current === next ? current : next));
            }}
          >
            {centreLabel}
          </Text>
        ) : null}
        {ends?.down ? (
          <Text variant="caption" color="textTertiary" style={[styles.end, styles.endDown]} pointerEvents="none">
            {ends.down}
          </Text>
        ) : null}
      </View>

      {/*
        The rail: the stretches the line covers in a solid hairline, the rest
        dotted, the passage in the accent, and a dot under each mark.
      */}
      {rail && width > 0 ? (
        <Svg width={width} height={RAIL_HEIGHT} style={styles.rail} pointerEvents="none">
          <Line
            x1={MARK}
            x2={width - MARK}
            y1={RAIL_Y}
            y2={RAIL_Y}
            stroke={colors.chartRule}
            strokeWidth={2}
            strokeDasharray="1 5"
            strokeLinecap="round"
            opacity={0.6}
          />
          {data.runs.map((run) => (
            <Line
              key={run[0].measure}
              x1={x(run[0].at)}
              x2={x(run[run.length - 1].at)}
              y1={RAIL_Y}
              y2={RAIL_Y}
              stroke={colors.border}
              strokeWidth={4}
              strokeLinecap="round"
            />
          ))}
          {rail.span ? (
            <Line
              x1={x(rail.span.from)}
              x2={x(rail.span.to)}
              y1={RAIL_Y}
              y2={RAIL_Y}
              stroke={colors.accent}
              strokeWidth={4}
              strokeLinecap="round"
            />
          ) : null}
          {(rail.marks ?? []).map((at) => (
            <Circle key={at} cx={x(at)} cy={MARK_Y} r={MARK} fill={colors.textSecondary} />
          ))}
        </Svg>
      ) : null}
    </View>
  );
}

const TONES: readonly Tone[] = ['on', 'near', 'far'];

function toneColour(tone: Tone): string {
  if (tone === 'far') return colors.trendBad;
  if (tone === 'near') return colors.trendMid;
  return colors.trendOn;
}

function rectsFor(stretches: readonly ToneStretch[], tone: Tone): ToneStretch[] {
  return stretches.filter((s) => s.tone === tone && s.to > s.from);
}

/**
 * The line's colour at a point, from the verdict tone the data carries: the
 * trend trio (`colors.trendOn/Mid/Bad`), not the verdict one, which is set for
 * text and runs its amber and red together for a colour-blind eye.
 */
function lineColour(tone: TrendPoint['tone']): string {
  if (tone === 'verdictBad') return colors.trendBad;
  if (tone === 'verdictMid') return colors.trendMid;
  return colors.trendOn;
}

const styles = StyleSheet.create({
  end: {
    position: 'absolute',
    right: 0,
    textAlign: 'right',
  },
  endUp: {
    top: -2,
  },
  endDown: {
    bottom: -2,
  },
  rail: {
    marginTop: 10,
  },
});

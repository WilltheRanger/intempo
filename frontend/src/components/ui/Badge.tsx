import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import { colors } from "../../styles/tokens";

/**
 * Badge — variant × appearance × shape.
 *
 * The palette is resolved to the locked manuscript tokens rather than a
 * generic status ramp, and the defaults are deliberately the ones that don't
 * read as a stock UI kit: `outline` + `square` (an engraved chip on paper),
 * never a pastel pill with a decorative status dot.
 *
 * Two token rules this respects:
 *  - `amber` is the ONE brand accent → `primary`.
 *  - `spruce` is the recording *environment* surface only, never a status, so
 *    `info` resolves to neutral graphite ink instead.
 */

export type BadgeVariant =
  | "primary"
  | "success"
  | "warning"
  | "info"
  | "destructive";
export type BadgeAppearance = "solid" | "light" | "outline";
export type BadgeShape = "square" | "circle";

/** Verdict tones, so verdict UI can stay in domain language. */
export type VerdictTone = "on" | "mid" | "bad";

const TONE_VARIANT: Record<VerdictTone, BadgeVariant> = {
  on: "success",
  mid: "warning",
  bad: "destructive",
};

type Ink = { hue: string; deep: string; tint: string; edge: string };

const PALETTE: Record<BadgeVariant, Ink> = {
  primary: {
    hue: colors.amber,
    deep: colors.amberDeep,
    tint: "rgba(199,138,58,0.12)",
    edge: "rgba(199,138,58,0.38)",
  },
  success: {
    hue: colors.verdictOn,
    deep: "#245840",
    tint: "rgba(47,110,78,0.10)",
    edge: "rgba(47,110,78,0.35)",
  },
  warning: {
    hue: colors.verdictMid,
    deep: "#8A5C1C",
    tint: "rgba(180,122,44,0.14)",
    edge: "rgba(180,122,44,0.40)",
  },
  info: {
    hue: colors.ink,
    deep: colors.ink,
    tint: "rgba(35,32,26,0.07)",
    edge: "rgba(35,32,26,0.20)",
  },
  destructive: {
    hue: colors.verdictBad,
    deep: "#6A2526",
    tint: "rgba(123,46,47,0.10)",
    edge: "rgba(123,46,47,0.35)",
  },
};

function paint(ink: Ink, appearance: BadgeAppearance) {
  if (appearance === "solid") {
    return { background: ink.hue, color: colors.paper, borderColor: "transparent" };
  }
  if (appearance === "light") {
    return { background: ink.tint, color: ink.deep, borderColor: "transparent" };
  }
  // outline — the manuscript-native default: paper ground, hairline edge,
  // the hue carried by the text and the rule rather than a colour fill.
  return { background: colors.paperWarm, color: ink.deep, borderColor: ink.edge };
}

export function Badge({
  variant,
  tone,
  appearance = "outline",
  shape = "square",
  className,
  children,
}: {
  /** Semantic colour. Omit when passing `tone`. */
  variant?: BadgeVariant;
  /** Verdict-UI shorthand: on → success, mid → warning, bad → destructive. */
  tone?: VerdictTone;
  appearance?: BadgeAppearance;
  shape?: BadgeShape;
  className?: string;
  children: ReactNode;
}) {
  const resolved: BadgeVariant = variant ?? (tone ? TONE_VARIANT[tone] : "info");
  const ink = PALETTE[resolved];

  return (
    <span
      className={cn(
        "inline-flex h-[26px] items-center border text-[12px] font-medium leading-none",
        shape === "circle" ? "rounded-full px-3" : "rounded-sm px-2.5",
        className,
      )}
      style={paint(ink, appearance)}
    >
      {children}
    </span>
  );
}

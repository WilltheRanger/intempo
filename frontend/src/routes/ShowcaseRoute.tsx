import { Plus } from "@phosphor-icons/react";

import { colors } from "../styles/tokens";

import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Eyebrow } from "../components/ui/Eyebrow";
import { Badge } from "../components/ui/Badge";
import type { BadgeVariant } from "../components/ui/Badge";

const BADGE_VARIANTS: BadgeVariant[] = [
  "primary",
  "success",
  "warning",
  "info",
  "destructive",
];

// Sourced from the locked tokens rather than re-typed, so this reference
// page can never drift out of sync with the palette it documents.
const SWATCHES: Array<[string, string]> = [
  ["paper", colors.paper],
  ["paper-raised", colors.paperRaised],
  ["ink", colors.ink],
  ["amber", colors.amber],
  ["spruce", colors.spruce],
  ["verdict-on", colors.verdictOn],
  ["verdict-mid", colors.verdictMid],
  ["verdict-bad", colors.verdictBad],
];

export function ShowcaseRoute() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Eyebrow>Design system</Eyebrow>
        <h1 className="font-serif text-2xl text-ink">Components</h1>
        <p className="text-sm text-ink-soft">
          The locked tokens and primitives every screen is built from.
        </p>
      </div>

      <Card className="flex flex-col gap-3">
        <Eyebrow>Palette</Eyebrow>
        <div className="grid grid-cols-4 gap-2">
          {SWATCHES.map(([name, hex]) => (
            <div key={name} className="overflow-hidden rounded-md border border-line">
              <div className="h-10" style={{ background: hex }} />
              <div className="px-2 py-1.5">
                <div className="text-[11px] font-medium">{name}</div>
                <div className="text-[10px] text-ink-faint">{hex}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <Eyebrow>Type</Eyebrow>
        <div className="font-serif text-3xl text-ink">Slight rush,</div>
        <div className="font-serif text-xl text-ink">measures 8 through 12.</div>
        <p className="text-[15px] text-ink-soft">
          Body copy in the sans face, tabular numerals for data: 72 BPM · 4/4.
        </p>
      </Card>

      <Card className="flex flex-col gap-3">
        <Eyebrow>Buttons</Eyebrow>
        <div className="flex flex-wrap items-center gap-3">
          <Button trailingIcon={<Plus size={15} weight="bold" />}>
            Primary
          </Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="stop">Stop</Button>
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <Eyebrow>Badges</Eyebrow>
        <div className="flex flex-col gap-3">
          {(["outline", "light", "solid"] as const).map((appearance) => (
            <div key={appearance} className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
                {appearance}
                {appearance === "outline" && " · default"}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {BADGE_VARIANTS.map((variant) => (
                  <Badge key={variant} variant={variant} appearance={appearance}>
                    {variant}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
              shape=&ldquo;circle&rdquo;
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {BADGE_VARIANTS.map((variant) => (
                <Badge key={variant} variant={variant} shape="circle">
                  {variant}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <Eyebrow>Verdict tones</Eyebrow>
        <p className="text-[13px] text-ink-soft">
          Verdict UI passes <code className="text-ink">tone</code> so it stays in
          domain language. These colours appear only here.
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge tone="on">On tempo</Badge>
          <Badge tone="mid">Slight rush</Badge>
          <Badge tone="bad">Rushing</Badge>
        </div>
      </Card>
    </div>
  );
}

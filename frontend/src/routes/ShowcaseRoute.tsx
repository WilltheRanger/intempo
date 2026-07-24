import { Plus } from "lucide-react";

import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Eyebrow } from "../components/ui/Eyebrow";
import { Badge } from "../components/ui/Badge";

const SWATCHES: Array<[string, string]> = [
  ["paper", "#EDE8DA"],
  ["paper-raised", "#FBF9F2"],
  ["ink", "#211F1B"],
  ["amber", "#C78A3A"],
  ["spruce", "#1E3D34"],
  ["verdict-on", "#2F6E4E"],
  ["verdict-mid", "#B47A2C"],
  ["verdict-bad", "#7B2E2F"],
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
          <Button trailingIcon={<Plus size={15} strokeWidth={1.5} />}>
            Primary
          </Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="stop">Stop</Button>
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <Eyebrow>Verdict badges</Eyebrow>
        <div className="flex flex-wrap gap-2">
          <Badge tone="on">On tempo</Badge>
          <Badge tone="mid">Slight rush</Badge>
          <Badge tone="bad">Rushing</Badge>
        </div>
      </Card>
    </div>
  );
}

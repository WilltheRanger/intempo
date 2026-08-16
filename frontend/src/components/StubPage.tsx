import type { ReactNode } from "react";

import { Card } from "./ui/Card";
import { Eyebrow } from "./ui/Eyebrow";

/** Placeholder page for routes whose real UI lands in a later batch. */
export function StubPage({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="font-serif text-2xl text-ink">{title}</h1>
      </div>
      <Card className="text-[15px] text-ink-soft">
        {children ?? "Coming in a later batch."}
      </Card>
    </div>
  );
}

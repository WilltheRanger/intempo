import { Link } from "react-router-dom";

import { continuePiece } from "../../lib/demo";

/**
 * The primary action on Today, anchored in the thumb zone.
 *
 * Law 7: "Practice" is what the user came to do, so it must be reachable
 * one-handed. It used to sit in the upper third of the phone, furthest from
 * the thumb, while the reachable area held only navigation.
 *
 * Law 9: this is persistent app furniture, so it lives in `AppShell` flush
 * above the tab bar and shares its surface and hairline — not a floating card
 * over the content. It is also mobile-only: a pointer reaches anywhere, so
 * desktop keeps the action inline in the Continue row where its context is.
 *
 * No piece metadata here on purpose (law 10): the screen above already says
 * what you are practising, and repeating it would be decoration.
 */
export function PracticeBar() {
  const current = continuePiece();

  return (
    <div className="border-t border-line bg-paper px-5 pb-2.5 pt-2.5 lg:hidden">
      <Link
        to={`/scores/${current.id}/record`}
        className="press flex w-full items-center justify-center rounded-sm bg-ink py-3 text-[14.5px] font-medium text-paper transition-colors duration-150 hover:bg-black"
      >
        Practice
      </Link>
    </div>
  );
}

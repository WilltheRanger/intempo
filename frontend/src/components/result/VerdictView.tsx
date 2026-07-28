import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import type { Variants } from "motion/react";
import { X, ShareNetwork } from "@phosphor-icons/react";

import type { AnalysisResult } from "../../lib/analysis";
import { verdictHeadline, deriveStats } from "../../lib/analysis";
import { AnnotatedScorePanel } from "./AnnotatedScorePanel";
import { StatChips } from "./StatChips";
import { TipBox } from "./TipBox";
import { TrendChart } from "./TrendChart";
import { PerNoteDetail } from "./PerNoteDetail";
import { ResultTabs } from "./ResultTabs";
import type { ResultTab } from "./ResultTabs";

const container: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.06 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.42, ease: [0.23, 1, 0.32, 1] } },
};
const heroItem: Variants = {
  hidden: { opacity: 0, y: 10, scale: 0.92 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 220, damping: 24 } },
};

export function VerdictView({
  result,
  scoreId,
}: {
  result: AnalysisResult;
  scoreId: string;
}) {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [tab, setTab] = useState<ResultTab>("score");

  const { phrase, location } = verdictHeadline(result);
  const stats = deriveStats(result);
  const onTempo = result.verdict_direction === "on";

  return (
    <div className="flex min-h-[100dvh] flex-col bg-paper">
      <div className="mx-auto w-full max-w-[440px] flex-1 px-5 pb-8 pt-4">
        {/* top bar */}
        <div className="mb-5 flex items-center justify-between">
          <button
            onClick={() => navigate("/")}
            aria-label="Close"
            className="grid size-9 place-items-center rounded-full text-ink transition-colors duration-200 hover:bg-paper-warm active:scale-90"
          >
            <X size={20} />
          </button>
          <button
            aria-label="Share"
            className="grid size-9 place-items-center rounded-full text-ink transition-colors duration-200 hover:bg-paper-warm active:scale-90"
          >
            <ShareNetwork size={19} />
          </button>
        </div>

        <motion.div
          variants={container}
          initial={reduce ? false : "hidden"}
          animate="visible"
          className="flex flex-col gap-5"
        >
          <motion.div variants={heroItem}>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-amber-deep">
              Tempo verdict
            </p>
            <h1 className="font-serif text-[30px] leading-[1.12] tracking-[-0.01em]">
              <span className="italic" style={{ color: onTempo ? "var(--verdict-on)" : "var(--amber)" }}>
                {phrase}
              </span>{" "}
              <span className="text-ink">{location}</span>
            </h1>
          </motion.div>

          <motion.p variants={item} className="-mt-2 text-[14px] text-ink-soft">
            You&rsquo;re musical. Let&rsquo;s refine the flow.
          </motion.p>

          {/* tab-switched content */}
          <motion.div
            key={tab}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.26, ease: [0.23, 1, 0.32, 1] }}
            className="flex flex-col gap-4"
          >
            {tab === "score" && (
              <>
                <AnnotatedScorePanel />
                <StatChips range={stats.range} steadiest={stats.steadiest} longest={stats.longest} />
              </>
            )}
            {tab === "details" && (
              <>
                {result.trend.length >= 2 && (
                  <div className="rounded-lg border border-line bg-paper-raised p-4 shadow-hair">
                    <TrendChart trend={result.trend} />
                  </div>
                )}
                <PerNoteDetail notes={result.per_note} />
              </>
            )}
            {tab === "next" && (
              <>
                <TipBox>
                  Try feeling the downbeat a fraction earlier in measure 8. You&rsquo;re
                  close, trust the pulse.
                </TipBox>
                <Link to={`/scores/${scoreId}/record`}>
                  <button className="w-full rounded-xl bg-amber py-3.5 text-[15px] font-medium text-white shadow-[0_8px_18px_-8px_rgba(199,138,58,0.8)] transition-transform duration-200 active:scale-[0.98]">
                    Practice again
                  </button>
                </Link>
              </>
            )}
            {tab === "listen" && (
              <div className="rounded-lg border border-line bg-paper-warm p-6 text-center text-[14px] text-ink-soft shadow-hair">
                Playback for saved takes is coming soon.
              </div>
            )}
          </motion.div>
        </motion.div>
      </div>

      <ResultTabs active={tab} onChange={setTab} />
    </div>
  );
}

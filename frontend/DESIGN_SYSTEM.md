# InTempo — Locked Design System & Build Prompts

This is the **locked** visual system for InTempo's UI. It exists so a build
session executes a decided design and **invents nothing** — the slop comes from
the model filling gaps with its defaults, so this file pre-fills the gaps.

**How to use:** paste the SYSTEM BLOCK at the top of every screen build, then
the thin per-screen prompt under it, then run the critique loop. Build **one
screen at a time** (build Home, loop it, then move on) — you learn your own
system instead of generating three half-baked screens at once.

Source of truth for the *look*: the approved "engraver's manuscript" moodboard
(the 3-phone reference: Home / Recording / Verdict).

---

## SYSTEM BLOCK (paste at the top of every screen build)

```
You are building screens for InTempo, an iOS practice companion for string
musicians. The design system is already decided — execute it exactly, never
invent. Do not add colors, fonts, gradients, shadows, or layout patterns not
specified here. When unsure, do less.

CONCEPT: A warm practice companion that listens while you play and tells you
where you rushed or dragged, framed as a teacher's margin note, never a
judgment. Feedback voice is encouraging and specific — "Slight rush, measures
8–12. You're musical, let's refine the flow." Never "you played it wrong."

PALETTE (only these — no pure white, no pure black anywhere):
  Paper Ivory   #F6F4EC   backgrounds
  Graphite Ink  #1C1C1A   primary text
  Rosined Amber #C78A3A   the ONE accent — feedback, active states
  Deep Spruce   #1E3D34   the recording/listening surface only
  Cupro Oxblood #7B2E2F   sparingly, for emphasis

TYPE:
  Playfair Display (serif) — headings, greetings, the verdict. Use italic for warmth.
  Suisse Int'l (grotesque) — all UI text, labels, numeric data.
    (Suisse is a paid font; until licensed, stand in with system-ui / SF, or a
     free grotesque like Söhne-alt / Hanken Grotesk. Never one font for everything.)

ICONS: Phosphor only, one family, 1.5px stroke. Never Lucide, never emoji as UI icons.

MOTION: warm and slow, never bouncy or glowing. Animate only transform and
opacity. Honor prefers-reduced-motion (collapse to instant fades).

FEEL: warm paper, ink, daylight. Subtle grain on backgrounds, hand-annotation
touches in margins. Front-lit and textured — never dark, never glowing.
```

The last two lines (MOTION / FEEL) explicitly wall off the dark-glow world so
the model can't drift there.

---

## PER-SCREEN PROMPTS (paste one, under the system block)

### Home / Library
```
Build the Home / Library screen using the InTempo system above.
- Serif greeting "Good evening, Maia" with a small round avatar.
- RECENT SESSIONS: each row is a piece title (serif), timestamp, and a one-line
  verdict in amber ("Slight rush, m. 8–12"), chevron to open.
- YOUR LIBRARY: rows with a small sheet-music thumbnail, title, movement,
  "Last practiced [date]", a star to favorite.
- Bottom tabs: Library, Record, Insights, Profile.
Use real repertoire — Dvořák Cello Concerto, Bach Cello Suite No. 1, Bruch
Violin Concerto. No placeholder or lorem text.
```

### Recording
```
Build the Recording screen using the InTempo system above.
- Top ~half: the scanned score on paper, current system highlighted.
- Bottom half: Deep Spruce surface. A soft arc/curve implying the tempo line,
  "Listening…" in serif, "Keep playing" beneath.
- Two big readouts: tempo (72) and meter (4/4), grotesque, labeled.
- A round red record button center, Pause beside it, bookmark to the left.
- Footer line: "We'll let you know when you're done."
```

### Verdict
```
Build the Verdict screen using the InTempo system above.
- Serif headline, amber: "Slight rush," then Graphite "measures 8 through 12."
- Subhead, encouraging: "You're musical—let's refine the flow."
- Annotated score: the rushed measures highlighted in amber, hand-drawn
  margin notes ("a touch ahead", "breathe here") slightly off-grid.
- Three stat chips: Tempo Range (-6% to +3%), Steadiest (m. 1–7, 13–21),
  Longest Rush (4 beats).
- A pencil-icon tip box with one concrete, kind suggestion.
- Bottom tabs: Listen, Score, Details, Next Steps.
```

---

## CRITIQUE LOOP (run after each screen builds; fights the model's flattery instinct)

```
Screenshot the running [screen] and compare it against the InTempo reference
image. List every way it diverges — spacing, color use, type weight, hierarchy,
rhythm, texture. Be specific and critical. Then fix the top three. Do not tell
me it looks good; tell me what's off.
```

Tooling in this repo: `vite preview` + Playwright (global install at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`) can screenshot routes for
the loop. A public `/showcase` route pattern was used before for auth-free review.

---

## IMPORTANT: what is ALREADY built (don't re-solve the hard layers)

InTempo is three stacked layers. Prompts only build the UI layer. The other two
— the genuinely hard ones — are **already built and tested** in this repo:

- **OCR / "read the music" (Batch 2)** — Claude + Gemini vision → structured
  score JSON. `backend/app/services/ocr/`. Done.
- **Rushing/dragging engine (Batch 3)** — librosa onset detection, DTW
  alignment against the score, tolerance bands, verdict generator.
  `backend/app/services/{audio,alignment,classification,analysis}.py`.
  **163 passing tests.** Done. (Threshold tuning vs real recordings still
  pending — see `TUNING_LOG.md`.)
- **Async analysis API + calibration (Batch 4)** — `POST /v1/analyses`
  (202 + poll), `POST /v1/calibration`. Done.

So this is **not** a day-0 prototype. Do not dodge OMR or sketch a tempo
engine — they exist. The remaining work is the **UI, wired to this backend**.

**Demo-mode idea (still worth it):** for reliable demos, ship a small built-in
library of pieces with known reference tempo + beat map, so you're not depending
on a live photo scan or perfect OCR to show the app working.

---

## Palette note (why it's justified, not slop)

The anti-slop `design-taste-frontend` skill flags warm-cream + amber + oxblood +
espresso as the #1 AI-default palette for craft/premium briefs. Its own escape
clause: acceptable **"when the brand brief explicitly names those colors."** The
moodboard names them with hexes, and locking them as a system (this file) means
the model isn't *reaching for a default* — it's *executing a chosen brand*. That
flip is the whole anti-slop mechanism. Keep the palette; lock it hard.

---

## Skills available for the rebuild
- `design-taste-frontend` — anti-slop discipline (scoped for landing pages; use
  its universal parts: icon/type discipline, AI-tells, a11y, motion).
- `animate` — Emil Kowalski web-animation patterns; the motion layer.

## Status
UI is being **rebuilt fresh** from this locked system. Backend (Batches 0–4)
is untouched and solid. Previous UI (Batches 5–7) is preserved in git history /
PR #1 if any component is worth referencing.

/**
 * InTempo design tokens — the "manuscript" direction, locked from the
 * approved prototype (supersedes the placeholder cream/gold palette in
 * spec §5). Single source of truth for TS-side usage; the same values
 * are mirrored as CSS variables in `index.css` and mapped into Tailwind
 * in `tailwind.config.js`.
 *
 * Colour rules that keep this from drifting back into "AI slop":
 *  - `amber` is the ONE interactive/brand accent.
 *  - `spruce` is the recording *environment* surface only — never a status.
 *  - `verdict*` colours appear only inside verdict UI, always with a label.
 */

export const colors = {
  paper: "#EDE8DA", // page ground
  paperRaised: "#FBF9F2", // cards / screen surfaces
  paperWarm: "#F2ECDD", // insets, manuscript panels
  paperDeep: "#E6DFCD", // machined "tray" behind bezelled surfaces
  ink: "#211F1B", // primary text
  inkSoft: "#5F5C53", // secondary text
  inkMute: "#948F82", // metadata
  inkFaint: "#989387", // hints / disabled
  amber: "#C78A3A", // brand accent
  amberDeep: "#A06E22", // accent text / pressed
  amberSoft: "#F0E4CD", // tinted accent background
  spruce: "#1E3D34", // recording environment surface
  spruceLo: "#173029",
  verdictOn: "#2F6E4E", // on tempo (verdict UI only)
  verdictMid: "#B47A2C", // slight rush/drag (verdict UI only)
  verdictBad: "#7B2E2F", // rushing/dragging (verdict UI only)
  line: "rgba(33,31,27,0.10)",
  line2: "rgba(33,31,27,0.18)",
} as const;

export const radii = { sm: "10px", md: "14px", lg: "20px", xl: "26px" } as const;

export const shadow = {
  hair: "inset 0 1px 0 rgba(255,255,255,0.55)", // lit top edge
  card: "0 1px 2px rgba(74,45,12,0.05), 0 10px 24px -16px rgba(74,45,12,0.34)",
} as const;

export const motion = {
  ios: "cubic-bezier(0.32,0.72,0,1)", // the app's default easing
  fast: "160ms",
  base: "220ms",
  page: "280ms",
  reveal: "460ms", // the verdict-reveal spring window
} as const;

export const type = {
  serif: '"Playfair Display", Georgia, serif',
  // Suisse Int'l in production; SF via system-ui as the licensed stand-in.
  sans: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
} as const;

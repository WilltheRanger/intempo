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
  paper: "#FAF8F3", // Paper Ivory — page ground (locked)
  paperRaised: "#FFFFFF", // cards / screen surfaces
  paperWarm: "#F3F0E8", // insets, manuscript panels
  paperDeep: "#EAE5DA", // machined "tray" behind bezelled surfaces
  ink: "#171614", // Graphite Ink — primary text (locked)
  inkSoft: "#55514A", // secondary text
  inkMute: "#88837A", // metadata
  inkFaint: "#A9A49A", // hints / disabled
  amber: "#9C7A3C", // Rosined Amber — the one accent
  amberDeep: "#7D6130", // accent text / pressed
  amberSoft: "#EFE8D8", // tinted accent background
  spruce: "#1E3D34", // recording environment surface
  spruceLo: "#173029",
  verdictOn: "#2F6E4E", // on tempo (verdict UI only)
  verdictMid: "#A8762E", // slight rush/drag (verdict UI only)
  verdictBad: "#7B2E2F", // rushing/dragging (verdict UI only)
  line: "rgba(23,22,20,0.09)",
  line2: "rgba(23,22,20,0.16)",
} as const;

export const radii = { sm: "8px", md: "10px", lg: "12px", xl: "14px" } as const;

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
  // Suisse Int'l when licensed; Inter ships as the free stand-in.
  sans: 'SuisseIntl, "Inter Variable", Inter, system-ui, sans-serif',
} as const;

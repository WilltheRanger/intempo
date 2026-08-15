/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        "paper-raised": "var(--paper-raised)",
        "paper-warm": "var(--paper-warm)",
        "paper-deep": "var(--paper-deep)",
        ink: "var(--ink)",
        "ink-soft": "var(--ink-soft)",
        "ink-mute": "var(--ink-mute)",
        "ink-faint": "var(--ink-faint)",
        amber: "var(--amber)",
        "amber-deep": "var(--amber-deep)",
        "amber-soft": "var(--amber-soft)",
        spruce: "var(--spruce)",
        "spruce-lo": "var(--spruce-lo)",
        "verdict-on": "var(--verdict-on)",
        "verdict-mid": "var(--verdict-mid)",
        "verdict-bad": "var(--verdict-bad)",
        line: "var(--line)",
        "line-2": "var(--line-2)",
      },
      borderColor: { DEFAULT: "var(--line)" },
      // Softened one step across the scale — the manuscript surfaces read
      // gentler at these radii without tipping into "bubbly".
      borderRadius: { sm: "12px", md: "18px", lg: "24px", xl: "30px" },
      fontFamily: {
        serif: ['"Playfair Display"', "Georgia", "serif"],
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"SF Pro Text"',
          "system-ui",
          "sans-serif",
        ],
      },
      boxShadow: {
        hair: "inset 0 1px 0 rgba(255,255,255,0.55)",
        // Wider, lower-contrast falloff — light through paper rather than a
        // hard drop. Three stops so the gradient reads soft instead of banded.
        card: "0 1px 2px rgba(74,45,12,0.035), 0 6px 16px -10px rgba(74,45,12,0.16), 0 18px 40px -24px rgba(74,45,12,0.22)",
        lift: "0 2px 6px rgba(74,45,12,0.05), 0 12px 28px -14px rgba(74,45,12,0.2), 0 28px 60px -32px rgba(74,45,12,0.26)",
        ring: "0 0 0 2px var(--paper-raised), 0 0 0 4px var(--amber)",
      },
      transitionTimingFunction: { ios: "cubic-bezier(0.32,0.72,0,1)" },
    },
  },
  plugins: [],
};

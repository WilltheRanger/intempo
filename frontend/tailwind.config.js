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
      // Restrained. Nothing in the UI should read as a pill except genuinely
      // pill-shaped controls, which opt in with `rounded-full` explicitly.
      borderRadius: { sm: "8px", md: "10px", lg: "12px", xl: "14px" },
      fontFamily: {
        serif: ['"Playfair Display"', "Georgia", "serif"],
        // Suisse Int'l is commercial. Self-host a licensed copy declaring
        // `font-family: SuisseIntl` in its @font-face and it wins automatically.
        // Inter ships as the free neo-grotesque stand-in.
        sans: [
          "SuisseIntl",
          '"Inter Variable"',
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "system-ui",
          "sans-serif",
        ],
      },
      boxShadow: {
        hair: "inset 0 1px 0 rgba(255,255,255,0.55)",
        // Structure comes from hairline borders, not elevation. `card` is
        // barely-there; `lift` exists only for things that genuinely float
        // above the page (menus, sheets).
        card: "0 1px 1px rgba(23,22,20,0.03)",
        lift: "0 8px 24px -12px rgba(23,22,20,0.18), 0 2px 6px rgba(23,22,20,0.04)",
        ring: "0 0 0 2px var(--paper-raised), 0 0 0 4px var(--amber)",
      },
      transitionTimingFunction: { ios: "cubic-bezier(0.32,0.72,0,1)" },
    },
  },
  plugins: [],
};

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
      borderRadius: { sm: "10px", md: "14px", lg: "20px", xl: "26px" },
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
        card: "0 1px 2px rgba(74,45,12,0.05), 0 10px 24px -16px rgba(74,45,12,0.34)",
        ring: "0 0 0 2px var(--paper-raised), 0 0 0 4px var(--amber)",
      },
      transitionTimingFunction: { ios: "cubic-bezier(0.32,0.72,0,1)" },
    },
  },
  plugins: [],
};

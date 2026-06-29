import type { Config } from "tailwindcss";

// Mega Pools design tokens (from the design handoff). Warm near-black surfaces, lime accent,
// Space Grotesk (UI) + JetBrains Mono (numbers/labels). These are final/high-fidelity.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0908", // page background
        surface: "#161412", // cards
        inset: "#0e0d0c", // inputs, bars, chips
        raised: "#2a2622", // active tab / raised
        txt: {
          DEFAULT: "#f4f1ea", // primary
          muted: "#9b958a", // secondary
          faint: "#645e54", // captions / muted
        },
        accent: {
          DEFAULT: "#c6ff3a", // brand / "Live"
          soft: "rgba(198,255,58,0.55)", // locked bar fill
          tint: "rgba(198,255,58,0.14)",
        },
        info: "#5ad1ff", // "Building"
        warn: "#ff7a3c", // "Locked" / almost-gone
        settled: "#ffd23f",
        danger: "#ff5247",
      },
      fontFamily: {
        sans: ["var(--font-space-grotesk)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        chip: "9px",
        box: "13px",
        btn: "15px",
        card: "18px",
        pill: "20px",
      },
      boxShadow: {
        ball: "0 0 14px rgba(198,255,58,0.4)",
      },
      keyframes: {
        pop: {
          "0%": { transform: "scale(0.6)", opacity: "0" },
          "60%": { transform: "scale(1.1)", opacity: "1" },
          "100%": { transform: "scale(1)" },
        },
        pulseGlow: {
          "0%,100%": { boxShadow: "0 0 0 rgba(198,255,58,0)" },
          "50%": { boxShadow: "0 0 18px rgba(198,255,58,0.5)" },
        },
      },
      animation: {
        pop: "pop 360ms cubic-bezier(.2,.8,.2,1)",
        pulseGlow: "pulseGlow 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;

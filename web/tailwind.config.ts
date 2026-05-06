import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#080810",
        surface: "#0f0f1a",
        border: "#1e1e32",
        cyan: { DEFAULT: "#00d4ff", dim: "#00d4ff33" },
        green: { DEFAULT: "#00ff88", dim: "#00ff8822" },
        red: { DEFAULT: "#ff3b5c", dim: "#ff3b5c22" },
        muted: "#4a4a6a",
        text: "#e0e0f0",
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "'Fira Code'", "monospace"],
        sans: ["'Inter'", "system-ui", "sans-serif"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4,0,0.6,1) infinite",
        "slide-up": "slideUp 0.4s ease-out",
        "count-up": "countUp 0.6s ease-out",
        flicker: "flicker 0.15s ease-in-out",
      },
      keyframes: {
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        flicker: {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
      },
      boxShadow: {
        cyan: "0 0 24px #00d4ff33",
        green: "0 0 24px #00ff8833",
        red: "0 0 24px #ff3b5c33",
      },
    },
  },
  plugins: [],
};
export default config;

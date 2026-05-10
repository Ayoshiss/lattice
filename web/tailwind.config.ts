import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg:      "#05050f",
        surface: "#0c0c1a",
        raised:  "#111124",
        border:  "#1a1a2e",
        "border-bright": "#a5a5a5",
        gold:    { DEFAULT: "#f0b429", dim: "rgba(240,180,41,0.12)", glow: "rgba(240,180,41,0.35)" },
        violet:  { DEFAULT: "#a78bfa", dim: "rgba(167,139,250,0.12)" },
        cyan:    { DEFAULT: "#00d4ff", dim: "#00d4ff20" },
        green:   { DEFAULT: "#00ff88", dim: "#00ff8820" },
        red:     { DEFAULT: "#ff3b5c", dim: "#ff3b5c20" },
        muted:   "#6b6b8a",
        text:    "#f1f0f7",
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "'Fira Code'", "monospace"],
        sans: ["'Inter'", "system-ui", "sans-serif"],
      },
      animation: {
        "pulse-slow":    "pulse 3.5s cubic-bezier(0.4,0,0.6,1) infinite",
        "drift":         "drift 18s ease-in-out infinite",
        "drift-slow":    "drift 28s ease-in-out infinite",
        "shimmer":       "shimmer 2.4s linear infinite",
        "breathe-green": "breatheGreen 2.8s ease-in-out infinite",
        "breathe-gold":  "breatheGold 2.8s ease-in-out infinite",
        "slide-up":      "slideUp 0.45s cubic-bezier(0.22,1,0.36,1) both",
        "reveal-bar":    "revealBar 0.5s cubic-bezier(0.22,1,0.36,1) both",
        "float":         "float 4s ease-in-out infinite",
        "pulse-ring":    "pulseRing 1.4s ease-out infinite",
        "count-up":      "countUp 0.5s cubic-bezier(0.22,1,0.36,1) both",
        "glitch":        "glitch 5s infinite",
        "fill-bar":      "fillBar 1.2s cubic-bezier(0.22,1,0.36,1) both",
        "blink":         "blink 1s step-end infinite",
        "slide-up-2":    "slideUp 0.45s cubic-bezier(0.22,1,0.36,1) 0.1s both",
        "slide-up-3":    "slideUp 0.45s cubic-bezier(0.22,1,0.36,1) 0.2s both",
      },
      keyframes: {
        drift: {
          "0%,100%": { transform: "translate(0,0) scale(1)" },
          "33%":     { transform: "translate(30px,-40px) scale(1.06)" },
          "66%":     { transform: "translate(-20px,25px) scale(0.96)" },
        },
        shimmer: {
          from: { backgroundPosition: "-200% center" },
          to:   { backgroundPosition: "200% center" },
        },
        breatheGreen: {
          "0%,100%": { boxShadow: "0 0 6px #00ff88, 0 0 12px #00ff8844" },
          "50%":     { boxShadow: "0 0 14px #00ff88, 0 0 36px #00ff8866, 0 0 52px #00ff8822" },
        },
        breatheGold: {
          "0%,100%": { boxShadow: "0 0 6px #f0b429, 0 0 12px #f0b42944" },
          "50%":     { boxShadow: "0 0 14px #f0b429, 0 0 32px #f0b42966, 0 0 48px #f0b42922" },
        },
        slideUp: {
          "0%":   { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        revealBar: {
          "0%":   { transform: "scaleX(0.88)", opacity: "0.2", filter: "blur(4px)" },
          "60%":  { transform: "scaleX(1.015)" },
          "100%": { transform: "scaleX(1)",    opacity: "1",   filter: "blur(0)" },
        },
        float: {
          "0%,100%": { transform: "translateY(0)" },
          "50%":     { transform: "translateY(-8px)" },
        },
        pulseRing: {
          "0%":   { transform: "scale(1)",   opacity: "0.8" },
          "100%": { transform: "scale(1.8)", opacity: "0" },
        },
        countUp: {
          from: { transform: "translateY(8px)", opacity: "0" },
          to:   { transform: "translateY(0)",   opacity: "1" },
        },
        glitch: {
          "0%,90%,100%": { clipPath: "none", transform: "none" },
          "91%":         { clipPath: "inset(20% 0 55% 0)", transform: "translate(-3px,0)" },
          "93%":         { clipPath: "inset(60% 0 10% 0)", transform: "translate(3px,0)" },
          "95%":         { clipPath: "inset(35% 0 40% 0)", transform: "translate(-2px,0)" },
          "97%":         { clipPath: "inset(70% 0 5% 0)",  transform: "translate(2px,0)" },
        },
        fillBar: {
          from: { width: "0%" },
        },
        blink: {
          "0%,100%": { opacity: "1" },
          "50%":     { opacity: "0" },
        },
      },
      boxShadow: {
        gold:   "0 0 0 1px #f0b42966, 0 0 24px #f0b42933, 0 0 48px #f0b42911",
        violet: "0 0 0 1px #a78bfa44, 0 0 24px #a78bfa22",
        green:  "0 0 0 1px #00ff8844, 0 0 24px #00ff8822",
        cyan:   "0 0 0 1px #00d4ff44, 0 0 24px #00d4ff22",
        red:    "0 0 0 1px #ff3b5c44, 0 0 24px #ff3b5c22",
      },
    },
  },
  plugins: [],
};
export default config;

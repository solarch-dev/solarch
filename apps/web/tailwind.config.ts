import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx,html}",
  ],
  theme: {
    extend: {
      colors: {
        /* shadcn HSL tokens — defined in index.css */
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent-h))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        /* Solarch brand (orange) — web_old design_systems.md */
        brand: {
          100: "#FFE7D6",
          300: "#FFB37E",
          400: "#FFA76A",
          500: "#FF8A3D",
          // 600: hover-darken of 500 — `hover:bg-brand-600` / `text-brand-600` references
          // previously undefined (empty CSS) → hover on 7 primary CTAs was dead. One token fixes it.
          600: "#E5681F",
        },

        /* Family color scale — synced with canvas/families.ts */
        family: {
          data: "#3B82F6",
          business: "#10B981",
          access: "#F97316",
          infrastructure: "#0891B2",
          client: "#C026D3",
          security: "#8B5CF6",
          configuration: "#D97706",
          structure: "#6B7280",
        },

        /* Solarch ink (semi-independent — neutral + warmth) */
        ink: {
          DEFAULT: "#1b1b1a",
          soft: "#64748b",
          faint: "#94a3b8",
        },

        /* Surfaces */
        paper: {
          DEFAULT: "#fafaf7",
          raised: "#ffffff",
          sunken: "#f0ede9",
        },

        /* Status */
        ok: "#1f8a55",
        danger: "#c2371f",
        warn: "#a06b1a",
      },
      fontFamily: {
        sans: ["Satoshi", "Inter", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        eyebrow: ["10px", { letterSpacing: "0.08em", lineHeight: "1.2" }],
      },
      boxShadow: {
        card: "0 1px 2px rgba(11,16,32,0.04), 0 6px 16px -8px rgba(11,16,32,0.14)",
        float: "0 12px 32px -10px rgba(11,16,32,0.20)",
        focusBrand: "0 0 0 2px rgba(255, 138, 61, 0.18)",
      },
      borderRadius: {
        sm: "4px",
        md: "var(--radius)",          /* 7px */
        lg: "var(--radius-lg)",       /* 12px */
        pill: "999px",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to:   { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to:   { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.18s ease-out",
        "accordion-up":   "accordion-up 0.18s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;

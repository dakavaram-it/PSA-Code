/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        head: ["'Space Grotesk'", "'Segoe UI'", "system-ui", "sans-serif"],
        sans: ["Inter", "'Segoe UI'", "system-ui", "sans-serif"],
      },
      keyframes: {
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(1rem)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "gradient-fade": {
          "0%, 100%": { opacity: "0.85" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 0.5s cubic-bezier(.4,0,.2,1) both",
        "fade-in": "fade-in 0.3s ease-out both",
        "gradient-fade": "gradient-fade 6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

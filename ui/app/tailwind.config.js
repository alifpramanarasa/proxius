/** @type {import('tailwindcss').Config} */
const n = (v) => `rgb(var(--n-${v}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Palet Proxius — navy
        brand: {
          DEFAULT: "#0000A8",
          fg: "#8fa2ff",
        },
        // Skala neutral dipetakan ke CSS variable agar tema (dark/light) bisa
        // di-swap tanpa mengubah ratusan className. Lihat src/styles.css.
        neutral: {
          50: n(50),
          100: n(100),
          200: n(200),
          300: n(300),
          400: n(400),
          500: n(500),
          600: n(600),
          700: n(700),
          800: n(800),
          900: n(900),
          950: n(950),
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};

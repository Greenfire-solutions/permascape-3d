// The whole app is themed here. `zinc` is remapped to green-tinted "forest night" neutrals and
// `emerald` to a living leaf green, so every existing class picks up the look without edits.
const forest = {
  50: '#f4f7f4', 100: '#e9efe9', 200: '#d6dfd7', 300: '#b4c2b7', 400: '#8c9c90', 500: '#647568',
  600: '#465449', 700: '#2e3a31', 800: '#1d2620', 900: '#131a15', 950: '#0b100c',
};
const leaf = {
  50: '#f2fbe9', 100: '#e2f6cf', 200: '#c7eca3', 300: '#a7de75', 400: '#8acf52', 500: '#6db636',
  600: '#549127', 700: '#416f21', 800: '#36581f', 900: '#2e4a1d', 950: '#16280b',
};
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { zinc: forest, emerald: leaf, forest, leaf, sand: { 300: '#ecd9b0', 400: '#e2c48a', 500: '#d4a95c' } },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"Fraunces Variable"', 'Fraunces', 'Georgia', 'serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        glass: '0 1px 0 rgba(255,255,255,0.04) inset, 0 12px 40px -12px rgba(0,0,0,0.65)',
        glow: '0 0 0 1px rgba(167,222,117,0.35), 0 8px 30px -8px rgba(138,207,82,0.45)',
      },
      keyframes: {
        rise: { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } },
        sheet: { from: { opacity: 0, transform: 'translateY(14px) scale(0.99)' }, to: { opacity: 1, transform: 'none' } },
        breathe: { '0%,100%': { opacity: 0.55 }, '50%': { opacity: 1 } },
      },
      animation: { rise: 'rise .18s ease-out', sheet: 'sheet .24s cubic-bezier(.2,.8,.2,1)', breathe: 'breathe 1.6s ease-in-out infinite' },
    },
  },
  plugins: [],
};

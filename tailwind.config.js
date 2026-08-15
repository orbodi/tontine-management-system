/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Bleu institutionnel du logo DON DE DIEU
        brand: {
          50: '#eef2ff',
          100: '#dce4ff',
          200: '#c0ccff',
          300: '#99a9ff',
          400: '#7080ff',
          500: '#4a54f7',
          600: '#0033a0',
          700: '#002b87',
          800: '#00246e',
          900: '#001d59',
          950: '#00113a',
        },
        // Rouge du logo (accents)
        accent: {
          50: '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#f87171',
          500: '#e32219',
          600: '#c81e16',
          700: '#a51812',
          800: '#881411',
          900: '#711412',
        },
      },
    },
  },
  plugins: [],
}

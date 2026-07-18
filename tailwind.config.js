/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#eefdf5',
          100: '#d7f9e6',
          200: '#b2f1d1',
          300: '#7ee4b6',
          400: '#48cf96',
          500: '#21b57c',
          600: '#149264',
          700: '#117553',
          800: '#115d44',
          900: '#0f4c39',
          950: '#072b20',
        },
      },
    },
  },
  plugins: [],
}

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'bevvi': {
          50: '#fdf2f3',
          100: '#fce7e9',
          200: '#f9d0d5',
          300: '#f4a8b2',
          400: '#ec7589',
          500: '#df4a65',
          600: '#c42d4a',
          700: '#a5213d',
          800: '#8a1e36',
          900: '#761c32',
          950: '#420a18',
        },
        'bevvi-primary': {
          50: '#fdf2f3',
          100: '#fce7e9',
          200: '#f9d0d5',
          300: '#f4a8b2',
          400: '#ec7589',
          500: '#df4a65',
          600: '#c42d4a',
          700: '#a5213d',
          800: '#8a1e36',
          900: '#761c32',
          950: '#420a18',
        },
        'bevvi-accent': {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
        },
        'bevvi-dark': {
          50: '#fafafa',
          100: '#f5f5f5',
          200: '#e5e5e5',
          300: '#d4d4d4',
          400: '#a3a3a3',
          500: '#737373',
          600: '#525252',
          700: '#404040',
          800: '#262626',
          900: '#171717',
        },
        'bevvi-cream': '#faf8f6',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"DM Sans"', 'Inter', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'alert-flash': {
          '0%, 100%': {
            boxShadow: '0 0 0 0 rgba(196, 45, 74, 0.25)',
            backgroundColor: 'rgb(253 242 243)',
          },
          '50%': {
            boxShadow: '0 0 0 8px rgba(196, 45, 74, 0.1)',
            backgroundColor: 'rgb(252 231 233)',
          },
        },
        'drawer-slide-in-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
      },
      animation: {
        'alert-flash': 'alert-flash 2s ease-in-out infinite',
        'drawer-slide-in-right': 'drawer-slide-in-right 0.2s ease-out forwards',
      },
      boxShadow: {
        'bevvi': '0 10px 40px -12px rgba(138, 30, 54, 0.35)',
        'bevvi-sm': '0 4px 14px -4px rgba(138, 30, 54, 0.2)',
      },
    },
  },
  plugins: [],
}

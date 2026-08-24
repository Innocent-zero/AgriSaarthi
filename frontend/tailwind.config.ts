import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        soil: { 50: '#FAF7F2', 100: '#F0E9DD', 700: '#6B5537', 900: '#3A2E1E' },
        leaf: {
          50: '#EDF7F0', 100: '#D3EDDC', 300: '#7FC99A',
          500: '#2E9E5B', 600: '#1B7A43', 700: '#146134', 900: '#0B3A20',
        },
        harvest: { 400: '#F4B740', 500: '#E09B12', 600: '#B87A08' },
        alert: { 400: '#F26A5A', 600: '#C0392B' },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.04), 0 8px 24px -12px rgba(16,24,40,.18)',
      },
      keyframes: {
        pulseRing: {
          '0%': { transform: 'scale(.85)', opacity: '.9' },
          '100%': { transform: 'scale(1.9)', opacity: '0' },
        },
        slideUp: {
          '0%': { transform: 'translateY(12px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        pulseRing: 'pulseRing 1.4s cubic-bezier(.24,.85,.3,1) infinite',
        slideUp: 'slideUp .28s ease-out both',
      },
    },
  },
  plugins: [],
};

export default config;
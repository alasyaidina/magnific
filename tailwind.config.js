/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0f0f0f',
        card: '#1a1a1a',
        accent: '#7c3aed',
        'accent-dim': '#6d28d9',
        vibe: {
          start: '#ff5fa2',
          mid: '#a855f7',
          end: '#22d3ee',
        },
      },
      animation: {
        'vibe-shine': 'vibe-shine 6s ease-in-out infinite',
        'vibe-pulse': 'vibe-pulse 2.4s ease-in-out infinite',
      },
      keyframes: {
        'vibe-shine': {
          '0%, 100%': { 'background-position': '0% 50%' },
          '50%': { 'background-position': '100% 50%' },
        },
        'vibe-pulse': {
          '0%, 100%': { opacity: 0.55, transform: 'scale(1)' },
          '50%': { opacity: 1, transform: 'scale(1.04)' },
        },
      },
    },
  },
  plugins: [],
};

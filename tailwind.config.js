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
      },
    },
  },
  plugins: [],
};

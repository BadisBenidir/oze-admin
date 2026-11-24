/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      keyframes: {
        // Éclair du badge « Livraison disponible » : bref flash doré, puis repos.
        'zap-flash': {
          '0%, 68%, 100%': { opacity: '1', transform: 'scale(1)', filter: 'drop-shadow(0 0 0 rgba(233,196,106,0))' },
          '74%': { opacity: '0.35', transform: 'scale(0.9)' },
          '80%': { opacity: '1', transform: 'scale(1.25)', filter: 'drop-shadow(0 0 4px rgba(233,196,106,0.9))' },
          '88%': { opacity: '1', transform: 'scale(1)', filter: 'drop-shadow(0 0 2px rgba(233,196,106,0.5))' },
        },
      },
      animation: {
        'zap-flash': 'zap-flash 2.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

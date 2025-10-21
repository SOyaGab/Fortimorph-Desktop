/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './app/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Ocean Vibe Design System Colors
        'ocean-primary': '#0077B6', // Depth - buttons, accents, active states
        'ocean-surface': '#48CAE4', // Surface - highlights, spinners, focus
        'ocean-deep': '#001D3D', // Deep - main background
        'ocean-container': '#003566', // Containers - panel backgrounds
        'ocean-text': '#F8F9FA', // Text/Icons - primary text/icons
        'ocean-success': '#4CAF50', // Coral - completed actions
        'ocean-warning': '#FFC300', // Sunset - low-battery alerts
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 150ms ease-in-out',
        'slide-up': 'slideUp 150ms ease-in-out',
        'spin-slow': 'spin 2s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      boxShadow: {
        'ocean-lg': '0 10px 15px -3px rgba(0, 119, 182, 0.3), 0 4px 6px -2px rgba(0, 119, 182, 0.15)',
        'ocean-xl': '0 20px 25px -5px rgba(0, 119, 182, 0.3), 0 10px 10px -5px rgba(0, 119, 182, 0.15)',
      },
    },
  },
  plugins: [],
};

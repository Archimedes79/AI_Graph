/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        graph: {
          bg: '#0f1117',
          panel: '#1a1d2e',
          border: '#2d3148',
          accent: '#6366f1',
          'accent-hover': '#818cf8',
          text: '#e2e8f0',
          muted: '#94a3b8',
        },
        node: {
          input: '#1e3a5f',
          ai: '#2d1b4e',
          code: '#1a3a2a',
          output: '#3a2000',
        },
      },
    },
  },
  plugins: [],
}

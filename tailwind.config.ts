import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#fef8e7',
          100: '#fcedc0',
          200: '#fae199',
          300: '#f8d572',
          400: '#f6c94b',
          500: '#FABE4C', // Main yellow from design
          600: '#e0a838',
          700: '#c18728',
          800: '#a06918',
          900: '#7f4d08',
        },
        secondary: {
          50: '#f0f1f3',
          100: '#dcdee2',
          200: '#c8cbd1',
          300: '#b4b8c0',
          400: '#a0a5af',
          500: '#363948', // Dark blue from design
          600: '#2e3139',
          700: '#26292e',
          800: '#1e2023',
          900: '#161718',
        },
        accent: {
          50: '#f4f7ef',
          100: '#e5ebd7',
          200: '#d6dfbf',
          300: '#c7d3a7',
          400: '#b8c78f',
          500: '#A4BC46', // Green from button
          600: '#91a83d',
          700: '#7d9134',
          800: '#69792b',
          900: '#556222',
        },
        surface: 'var(--color-surface)',
        'surface-elevated': 'var(--color-surface-elevated)',
        'surface-secondary': 'var(--color-surface-secondary)',
        foreground: 'var(--color-foreground)',
        'foreground-secondary': 'var(--color-foreground-secondary)',
        'foreground-muted': 'var(--color-foreground-muted)',
        'border-default': 'var(--color-border)',
        'border-secondary': 'var(--color-border-secondary)',
      },
      fontFamily: {
        bebas: ['"Bebas Neue"', 'cursive'],
        inter: ['"Inter"', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config

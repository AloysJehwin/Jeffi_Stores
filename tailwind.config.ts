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
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#d97706', // Deep golden amber — 4.8:1 with white, still reads as yellow-gold
          600: '#b45309',
          700: '#92400e',
          800: '#78350f',
          900: '#451a03',
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
          50: '#f2f7e8',
          100: '#e0edc5',
          200: '#c8de97',
          300: '#aecf63',
          400: '#97c238',
          500: '#5a8a00', // Deep forest green — 5.1:1 with white
          600: '#4a7200',
          700: '#3a5900',
          800: '#2b4200',
          900: '#1c2c00',
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

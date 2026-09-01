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
          500: '#f59e0b', // Amber — vibrant in light mode, warm gold
          600: '#d97706', // Deeper amber — used in dark mode via dark: overrides
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        },
        secondary: {
          50: '#f0f1f3',
          100: '#dcdee2',
          200: '#c8cbd1',
          300: '#b4b8c0',
          400: '#a0a5af',
          500: '#363948',
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
          500: '#7cb900', // Bright green — vibrant in light mode (~3.5:1 with white, AA large)
          600: '#5a8a00', // Deep forest green — used in dark mode via dark: overrides
          700: '#4a7200',
          800: '#3a5900',
          900: '#2b4200',
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
      fontSize: {
        xs:    ['clamp(0.8rem, 0.79rem + 0.05vw, 0.83rem)',   { lineHeight: '1rem' }],
        sm:    ['clamp(0.9rem, 0.89rem + 0.05vw, 0.925rem)',  { lineHeight: '1.25rem' }],
        base:  ['clamp(0.9rem, 0.83rem + 0.31vw, 1rem)',      { lineHeight: '1.5rem' }],
        lg:    ['clamp(1rem, 0.92rem + 0.36vw, 1.125rem)',    { lineHeight: '1.6' }],
        xl:    ['clamp(1.1rem, 0.98rem + 0.53vw, 1.25rem)',   { lineHeight: '1.55' }],
        '2xl': ['clamp(1.3rem, 1.1rem + 0.89vw, 1.5rem)',     { lineHeight: '1.4' }],
        '3xl': ['clamp(1.55rem, 1.27rem + 1.24vw, 1.875rem)', { lineHeight: '1.3' }],
        '4xl': ['clamp(1.8rem, 1.4rem + 1.78vw, 2.25rem)',    { lineHeight: '1.2' }],
        '5xl': ['clamp(2.1rem, 1.5rem + 2.67vw, 3rem)',       { lineHeight: '1.1' }],
        '6xl': ['clamp(2.4rem, 1.5rem + 4vw, 3.75rem)',       { lineHeight: '1.05' }],
      },
      keyframes: {
        'cart-pulse': {
          '0%':   { transform: 'scale(1)' },
          '40%':  { transform: 'scale(1.4)' },
          '100%': { transform: 'scale(1)' },
        },
        'heart-pulse': {
          '0%':   { transform: 'scale(1)' },
          '50%':  { transform: 'scale(1.3)' },
          '100%': { transform: 'scale(1)' },
        },
        'fade-in-up': {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'toast-in': {
          '0%':   { opacity: '0', transform: 'translateY(16px) scale(0.96)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'toast-out': {
          '0%':   { opacity: '1', transform: 'translateY(0) scale(1)' },
          '100%': { opacity: '0', transform: 'translateY(8px) scale(0.96)' },
        },
        'slide-up': {
          '0%':   { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        'shimmer': {
          '0%':   { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'cart-pulse': 'cart-pulse 500ms ease-out',
        'heart-pulse': 'heart-pulse 350ms ease-out',
        'fade-in-up': 'fade-in-up 250ms ease-out',
        'fade-in': 'fade-in 200ms ease-out',
        'toast-in': 'toast-in 250ms ease-out',
        'toast-out': 'toast-out 200ms ease-in forwards',
        'slide-up': 'slide-up 280ms cubic-bezier(0.32, 0.72, 0, 1)',
        'shimmer': 'shimmer 2.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}

export default config

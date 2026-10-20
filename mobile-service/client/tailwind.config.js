// Same palette and semantic classes as the web (controller-service/tailwind.config.ts): both read
// packages/design-tokens, so the app never carries its own copy of a colour. Semantic colours are CSS
// variables set on :root / .dark (NativeWind resolves var() at runtime), exactly like the site.
const plugin = require('tailwindcss/plugin')
const tokens = require('../../packages/design-tokens')

module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: tokens.primary,
        secondary: tokens.secondary,
        accent: tokens.accent,
        surface: 'var(--color-surface)',
        'surface-elevated': 'var(--color-surface-elevated)',
        'surface-secondary': 'var(--color-surface-secondary)',
        foreground: 'var(--color-foreground)',
        'foreground-secondary': 'var(--color-foreground-secondary)',
        'foreground-muted': 'var(--color-foreground-muted)',
        'border-default': 'var(--color-border)',
        'border-secondary': 'var(--color-border-secondary)',
      },
      borderRadius: { card: `${tokens.radius.card}px`, button: `${tokens.radius.button}px`, hero: `${tokens.radius.hero}px` },
      fontFamily: { bebas: ['BebasNeue-Regular'], inter: ['Inter'] },
    },
  },
  plugins: [plugin(({ addBase }) => addBase({ ':root': tokens.cssVars('light'), '.dark': tokens.cssVars('dark') }))],
}

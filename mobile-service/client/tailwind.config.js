// Same palette and semantic classes as the web (controller-service/tailwind.config.ts): both read
// packages/design-tokens, so the app never carries its own copy of a colour. Semantic colours are CSS
// variables (NativeWind resolves var() at runtime), the same values the site sets on :root / .dark.
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
      // field/panel/sheet are the app's own geometry (src/ui); card/button/hero stay the web's shared tokens.
      borderRadius: {
        card: `${tokens.radius.card}px`, button: `${tokens.radius.button}px`, hero: `${tokens.radius.hero}px`,
        field: '16px', panel: '20px', sheet: '28px',
      },
      // Families embedded at build time by the expo-font plugin (app.json), so font-bold etc. pick the real weight.
      fontFamily: { bebas: ['BebasNeue-Regular'], inter: ['Inter'], display: ['PlusJakartaSans'] },
    },
  },
  // NativeWind reads dark variables from the prefers-color-scheme media block (it ignores a .dark rule) and
  // follows nativewind's colorScheme, so dark: variants and the variables always agree.
  plugins: [
    plugin(({ addBase }) =>
      addBase({
        ':root': tokens.cssVars('light'),
        '@media (prefers-color-scheme: dark)': { ':root': tokens.cssVars('dark') },
      })
    ),
  ],
}

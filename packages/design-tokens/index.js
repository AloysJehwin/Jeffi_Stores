// The storefront's design tokens — the single source for the web (tailwind.config + globals.css base)
// and the mobile app (mobile-service/client tailwind + theme). Plain CommonJS so Metro and Tailwind
// can both require it without a build step. Change a colour here, not in either consumer.
const primary = { 50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706', 700: '#b45309', 800: '#92400e', 900: '#78350f' }
const secondary = { 50: '#f0f1f3', 100: '#dcdee2', 200: '#c8cbd1', 300: '#b4b8c0', 400: '#a0a5af', 500: '#363948', 600: '#2e3139', 700: '#26292e', 800: '#1e2023', 900: '#161718' }
const accent = { 50: '#f2f7e8', 100: '#e0edc5', 200: '#c8de97', 300: '#aecf63', 400: '#97c238', 500: '#7cb900', 600: '#5a8a00', 700: '#4a7200', 800: '#3a5900', 900: '#2b4200' }

// Semantic surfaces per scheme (the CSS variables on :root / .dark).
const schemes = {
  light: {
    surface: '#f9fafb', surfaceElevated: '#ffffff', surfaceSecondary: '#f3f4f6',
    foreground: '#111827', foregroundSecondary: '#4b5563', foregroundMuted: '#6b7280',
    border: '#d1d5db', borderSecondary: '#9ca3af',
    primary500: '#f59e0b', primary600: '#d97706', accent500: '#7cb900', accent600: '#5a8a00',
    cardShadow: '0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.06)',
  },
  dark: {
    surface: '#1a1b23', surfaceElevated: '#24252f', surfaceSecondary: '#2e303b',
    foreground: '#f3f4f6', foregroundSecondary: '#d1d5db', foregroundMuted: '#aeb4c0',
    border: '#3f4150', borderSecondary: '#6a6c82',
    primary500: '#d97706', primary600: '#b45309', accent500: '#74a800', accent600: '#4a7200',
    cardShadow: '0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.06)',
  },
}

// Tailwind defaults the storefront uses for status (stock, SALE ribbon, wishlist, digital); same values as the web.
const status = {
  success: '#16a34a', danger: '#dc2626', heart: '#ef4444', digital: '#7c3aed',
  saleFrom: '#f43f5e', saleTo: '#f97316', white: '#ffffff', black: '#000000',
}

const radius = { card: 12, button: 8, pill: 999, hero: 20 }
const fonts = { display: 'Bebas Neue', body: 'Inter' }

/** CSS custom properties for one scheme, as tailwind's addBase / a :root block expects. */
function cssVars(scheme) {
  const s = schemes[scheme]
  return {
    '--color-surface': s.surface, '--color-surface-elevated': s.surfaceElevated, '--color-surface-secondary': s.surfaceSecondary,
    '--color-foreground': s.foreground, '--color-foreground-secondary': s.foregroundSecondary, '--color-foreground-muted': s.foregroundMuted,
    '--color-border': s.border, '--color-border-secondary': s.borderSecondary, '--color-card-shadow': s.cardShadow,
    '--primary-500': s.primary500, '--primary-600': s.primary600, '--accent-500': s.accent500, '--accent-600': s.accent600,
  }
}

module.exports = { primary, secondary, accent, schemes, status, radius, fonts, cssVars }

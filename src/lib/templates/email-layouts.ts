// Email layout registry — the 5-6 selectable templates every campaign/mailer can choose from.
// Each layout wraps the admin's body HTML (rich-text OR block-builder output) in a themed shell built on
// mailShell. The {store_name}/{store_web}/{customer_*} variable tokens are left intact for the send
// pipeline's renderVars to fill, so insert-variables keep working inside every layout.
import { mailShell, type MailTheme } from '@/lib/shared/mail-template'

export interface EmailLayoutContext {
  /** Body HTML (already variable-token-bearing). */
  bodyHtml: string
  /** Document <title> / preview subject. */
  title: string
  /** Store logo URL, when the store has one (header image instead of text brand). */
  logoUrl?: string
  /** Footer lines (copyright, address). Tokens allowed. */
  footerLines?: string[]
  /** Optional kicker above the title. */
  kicker?: string
}

export interface EmailLayout {
  key: string
  label: string
  description: string
  /** True when the block builder can target this layout (all current layouts support it). */
  supportsBlocks: boolean
  render: (ctx: EmailLayoutContext) => string
}

const DEFAULT_FOOTER = [
  `&copy; ${new Date().getFullYear()} {store_name} &bull; <a href="{store_web}" style="color:#666;">{store_web}</a>`,
]

// Brand token the shell renders in the header. Left as a variable so each store's name fills at send.
const BRAND = '{store_name}'

function layout(theme: MailTheme) {
  return (ctx: EmailLayoutContext): string =>
    mailShell({
      brand: BRAND,
      documentTitle: ctx.title,
      kicker: ctx.kicker,
      content: ctx.bodyHtml,
      footerLines: ctx.footerLines ?? DEFAULT_FOOTER,
      theme: { ...theme, logoUrl: ctx.logoUrl ?? theme.logoUrl },
    })
}

// 6 presets, available to EVERY campaign and the ad-hoc mailer. Accent is the only strong colour so a
// store's own accent (resolved at send) could later override; today they ship distinct, tasteful looks.
export const EMAIL_LAYOUTS: EmailLayout[] = [
  {
    key: 'classic',
    label: 'Classic',
    description: 'The familiar clean card — blue accent, centered brand. Safe for any message.',
    supportsBlocks: true,
    render: layout({ accent: '#2563eb', containerBg: '#f9f9f9', frame: 'card', headerAlign: 'center' }),
  },
  {
    key: 'bold',
    label: 'Bold',
    description: 'High-contrast, left-aligned header on white — strong for launches and announcements.',
    supportsBlocks: true,
    render: layout({ accent: '#111827', containerBg: '#ffffff', frame: 'card', headerAlign: 'left' }),
  },
  {
    key: 'minimal',
    label: 'Minimal',
    description: 'Edge-to-edge, no card chrome — understated, letter-like.',
    supportsBlocks: true,
    render: layout({ accent: '#374151', pageBg: '#ffffff', containerBg: '#ffffff', frame: 'full', headerAlign: 'left' }),
  },
  {
    key: 'promo',
    label: 'Promo / Sale',
    description: 'Warm orange accent on a soft background — built for discounts and offers.',
    supportsBlocks: true,
    render: layout({ accent: '#e07b3f', pageBg: '#fff7ed', containerBg: '#ffffff', frame: 'card', headerAlign: 'center' }),
  },
  {
    key: 'festive',
    label: 'Festive',
    description: 'Deep red accent on a cream background — seasonal and celebratory.',
    supportsBlocks: true,
    render: layout({ accent: '#b91c1c', pageBg: '#fff8f0', containerBg: '#fffdf7', frame: 'card', headerAlign: 'center' }),
  },
  {
    key: 'fresh',
    label: 'Fresh',
    description: 'Green accent on a light-mint background — upbeat, good for restock/back-in-stock.',
    supportsBlocks: true,
    render: layout({ accent: '#059669', pageBg: '#f0fdf4', containerBg: '#ffffff', frame: 'card', headerAlign: 'center' }),
  },
]

export const DEFAULT_EMAIL_LAYOUT = 'classic'

const BY_KEY = new Map(EMAIL_LAYOUTS.map(l => [l.key, l]))

export function getEmailLayout(key: string | null | undefined): EmailLayout {
  return (key && BY_KEY.get(key)) || BY_KEY.get(DEFAULT_EMAIL_LAYOUT)!
}

export function isEmailLayoutKey(key: unknown): key is string {
  return typeof key === 'string' && BY_KEY.has(key)
}

/** Client-safe metadata for the layout picker (no render fns). */
export const EMAIL_LAYOUT_OPTIONS = EMAIL_LAYOUTS.map(({ key, label, description, supportsBlocks }) => ({
  key,
  label,
  description,
  supportsBlocks,
}))

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
  /** Starter rich-text body loaded into the editor when this template is picked. Empty for 'custom'
   *  (keeps whatever the admin already has). Tokens like {firstName}/{ctaUrl} are intentional. */
  starterBody: string
  render: (ctx: EmailLayoutContext) => string
}

const DEFAULT_FOOTER = [
  `&copy; ${new Date().getFullYear()} {store_name} &bull; <a href="{store_web}" style="color:#666;">{store_web}</a>`,
]

// Brand token the shell renders in the header. Left as a variable so each store's name fills at send.
const BRAND = '{store_name}'

function layout(theme: MailTheme, extraCss?: string) {
  return (ctx: EmailLayoutContext): string =>
    mailShell({
      brand: BRAND,
      documentTitle: ctx.title,
      kicker: ctx.kicker,
      content: ctx.bodyHtml,
      footerLines: ctx.footerLines ?? DEFAULT_FOOTER,
      theme: { ...theme, logoUrl: ctx.logoUrl ?? theme.logoUrl },
      extraCss,
    })
}

// Per-layout character — small CSS layered on MAIL_BASE_CSS + the theme accent. Keeps the shared class
// vocabulary (.card/.button/.cta/.info/table.rows) so starter content and the block renderer look
// finished, while each template reads distinctly.
const LAYOUT_CSS = {
  classic: `.container{box-shadow:0 1px 3px rgba(0,0,0,0.06);} h2{font-size:22px;}`,
  bold: `.header{background:#111827;margin:-30px -30px 24px;padding:28px 30px;border-radius:10px 10px 0 0;}
    .brand{color:#fff !important;} .kicker{color:#9ca3af !important;}
    h2{font-size:28px;font-weight:800;letter-spacing:-0.3px;}
    .button{border-radius:4px;padding:14px 32px;}`,
  minimal: `.container{box-shadow:none;} h2,h3{font-weight:600;letter-spacing:-0.2px;}
    .card{border:1px solid #ececec;box-shadow:none;}
    .button{background:transparent !important;color:#111 !important;border:1px solid #111;padding:11px 26px;}`,
  promo: `.header{background:linear-gradient(135deg,#e07b3f,#f0a868);margin:-30px -30px 22px;padding:26px 30px;border-radius:10px 10px 0 0;}
    .brand{color:#fff !important;} .kicker{color:#fff5ec !important;}
    .promo-chip{display:inline-block;background:#fff;color:#e07b3f;font-weight:800;padding:6px 14px;border-radius:999px;font-size:14px;}
    .button{box-shadow:0 2px 8px rgba(224,123,63,0.35);}`,
  festive: `.container{border-top:5px solid #b91c1c;}
    .header:after{content:"✦ ✦ ✦";display:block;color:#b91c1c;letter-spacing:8px;font-size:12px;margin-top:8px;}
    h2{font-family:Georgia,'Times New Roman',serif;}`,
  fresh: `.card{background:#f0fdf4;border:1px solid #bbf7d0;}
    .button{border-radius:999px;} h2{color:#065f46;}`,
  custom: ``,
}

// Starter bodies: tasteful defaults so picking a template fills the editor with real content the admin
// can then tweak. Variable tokens ({firstName}, {ctaUrl}, {itemsHtml}…) stay for the send pipeline.
const S = {
  classic: `<p style="font-size:16px;color:#333;margin:0 0 14px;">Hi {firstName},</p>
<p style="font-size:15px;color:#333;line-height:1.6;margin:0 0 16px;">We thought you'd want to see this. Take a look and let us know what you think.</p>
{itemsHtml}
<div style="text-align:center;margin:24px 0;"><a href="{ctaUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;">Visit the store</a></div>`,
  bold: `<h2 style="margin:0 0 12px;">Hey {firstName} — don't miss this.</h2>
<p style="font-size:15px;color:#333;line-height:1.6;margin:0 0 16px;">Big things are happening. Here's what's new for you.</p>
{itemsHtml}
<div style="margin:24px 0;"><a href="{ctaUrl}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:700;">Check it out</a></div>`,
  minimal: `<p style="font-size:16px;color:#333;margin:0 0 14px;">Hi {firstName},</p>
<p style="font-size:15px;color:#333;line-height:1.7;margin:0 0 20px;">A quick note from us. We'd love for you to take a look.</p>
{itemsHtml}
<p style="margin:20px 0;"><a href="{ctaUrl}" style="color:#374151;font-weight:600;">Visit the store →</a></p>`,
  promo: `<h2 style="margin:0 0 10px;text-align:center;">A special offer for you, {firstName} 🎉</h2>
<p style="font-size:15px;color:#333;line-height:1.6;margin:0 0 16px;text-align:center;">Use code <strong>{couponCode}</strong> for <strong>{discountPercent}% off</strong> — for a limited time.</p>
{itemsHtml}
<div style="text-align:center;margin:24px 0;"><a href="{ctaUrl}" style="display:inline-block;background:#e07b3f;color:#fff;text-decoration:none;padding:12px 30px;border-radius:6px;font-weight:700;">Shop the sale</a></div>`,
  festive: `<h2 style="margin:0 0 10px;text-align:center;">Season's greetings, {firstName}! ✨</h2>
<p style="font-size:15px;color:#333;line-height:1.6;margin:0 0 16px;text-align:center;">Celebrate with something special, picked just for you.</p>
{itemsHtml}
<div style="text-align:center;margin:24px 0;"><a href="{ctaUrl}" style="display:inline-block;background:#b91c1c;color:#fff;text-decoration:none;padding:12px 30px;border-radius:6px;font-weight:700;">Explore the collection</a></div>`,
  fresh: `<p style="font-size:16px;color:#333;margin:0 0 14px;">Good news, {firstName}!</p>
<p style="font-size:15px;color:#333;line-height:1.6;margin:0 0 16px;">It's back — and we saved you a look. Grab it before it's gone again.</p>
{itemsHtml}
<div style="text-align:center;margin:24px 0;"><a href="{ctaUrl}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;">See what's back</a></div>`,
}

// 6 presets + a Custom entry. Presets ship a theme AND starter content; Custom keeps the admin's own
// content on the Classic theme. All are available to EVERY campaign + the mailer.
export const EMAIL_LAYOUTS: EmailLayout[] = [
  {
    key: 'classic',
    label: 'Classic',
    description: 'The familiar clean card — blue accent, centered brand. Safe for any message.',
    supportsBlocks: true,
    starterBody: S.classic,
    render: layout({ accent: '#2563eb', containerBg: '#f9f9f9', frame: 'card', headerAlign: 'center' }, LAYOUT_CSS.classic),
  },
  {
    key: 'bold',
    label: 'Bold',
    description: 'High-contrast, left-aligned header on white — strong for launches and announcements.',
    supportsBlocks: true,
    starterBody: S.bold,
    render: layout({ accent: '#111827', containerBg: '#ffffff', frame: 'card', headerAlign: 'left' }, LAYOUT_CSS.bold),
  },
  {
    key: 'minimal',
    label: 'Minimal',
    description: 'Edge-to-edge, no card chrome — understated, letter-like.',
    supportsBlocks: true,
    starterBody: S.minimal,
    render: layout({ accent: '#374151', pageBg: '#ffffff', containerBg: '#ffffff', frame: 'full', headerAlign: 'left' }, LAYOUT_CSS.minimal),
  },
  {
    key: 'promo',
    label: 'Promo / Sale',
    description: 'Warm orange accent on a soft background — built for discounts and offers.',
    supportsBlocks: true,
    starterBody: S.promo,
    render: layout({ accent: '#e07b3f', pageBg: '#fff7ed', containerBg: '#ffffff', frame: 'card', headerAlign: 'center' }, LAYOUT_CSS.promo),
  },
  {
    key: 'festive',
    label: 'Festive',
    description: 'Deep red accent on a cream background — seasonal and celebratory.',
    supportsBlocks: true,
    starterBody: S.festive,
    render: layout({ accent: '#b91c1c', pageBg: '#fff8f0', containerBg: '#fffdf7', frame: 'card', headerAlign: 'center' }, LAYOUT_CSS.festive),
  },
  {
    key: 'fresh',
    label: 'Fresh',
    description: 'Green accent on a light-mint background — upbeat, good for restock/back-in-stock.',
    supportsBlocks: true,
    starterBody: S.fresh,
    render: layout({ accent: '#059669', pageBg: '#f0fdf4', containerBg: '#ffffff', frame: 'card', headerAlign: 'center' }, LAYOUT_CSS.fresh),
  },
  {
    key: 'custom',
    label: 'Custom',
    description: 'Your own content. Set automatically once you edit a template.',
    supportsBlocks: true,
    starterBody: '',
    // Custom reuses the Classic theme shell; the content is entirely the admin's.
    render: layout({ accent: '#2563eb', containerBg: '#f9f9f9', frame: 'card', headerAlign: 'center' }),
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

/** Client-safe full-document render for the admin PREVIEW pane: wraps already-variable-filled body HTML
 *  in the selected layout's themed shell so e.g. Fresh and Promo look visibly different. The returned
 *  HTML is a complete email document; render it in an <iframe srcDoc> so its <style> doesn't leak. */
export function renderLayoutPreview(key: string | null | undefined, bodyHtml: string, logoUrl?: string): string {
  return getEmailLayout(key).render({ title: '', bodyHtml, logoUrl, footerLines: DEFAULT_FOOTER })
}

/** Client-safe metadata for the layout picker (no render fns). */
export const EMAIL_LAYOUT_OPTIONS = EMAIL_LAYOUTS.map(({ key, label, description, supportsBlocks, starterBody }) => ({
  key,
  label,
  description,
  supportsBlocks,
  starterBody,
}))

export const CUSTOM_LAYOUT_KEY = 'custom'

/** The starter body for a layout key, or '' for custom/unknown. */
export function layoutStarterBody(key: string | null | undefined): string {
  return EMAIL_LAYOUTS.find(l => l.key === key)?.starterBody ?? ''
}

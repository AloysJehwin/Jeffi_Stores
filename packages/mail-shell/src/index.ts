// The one shell every mail uses (store app, documents, message templates): store name or logo, optional
// grey kicker, title, the mail's own content, bordered footer carrying the brand. Mail-specific classes
// go in extraCss. A mail built without an explicit theme is marked so applyMailTheme can give it the
// store's logo and accent colour at send time.

export const MAIL_BASE_CSS = `
  body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; -webkit-font-smoothing: antialiased; }
  .container { background-color: #f9f9f9; border-radius: 10px; padding: 30px; border: 1px solid #e0e0e0; }
  .header { text-align: center; margin-bottom: 30px; }
  .brand { font-size: 28px; font-weight: bold; color: #2563eb; letter-spacing: 0.5px; }
  .kicker { color: #666; margin: 6px 0 0 0; }
  h2 { color: #1f2937; margin-top: 0; font-size: 22px; line-height: 1.3; }
  h3 { color: #1f2937; font-size: 17px; }
  p { margin: 0 0 14px; }
  a { color: #2563eb; }
  .eyebrow { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #6b7280; margin: 0 0 8px; }
  .lead { font-size: 16px; color: #374151; margin: 0 0 16px; }
  .divider { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
  .card { background-color: #ffffff; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #eee; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
  .info { background-color: #f0f9ff; border-left: 4px solid #2563eb; padding: 15px; margin: 20px 0; border-radius: 4px; }
  .warning { background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px; }
  .success { background-color: #d4edda; border-left: 4px solid #28a745; padding: 15px; margin: 20px 0; border-radius: 4px; }
  .danger { background-color: #fee2e2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0; border-radius: 4px; }
  .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
  .info-label { font-weight: bold; color: #555; }
  .code-box { background-color: #2563eb; color: white; font-size: 32px; font-weight: bold; text-align: center; padding: 20px; border-radius: 8px; letter-spacing: 8px; margin: 24px 0; }
  .button { display: inline-block; background-color: #2563eb; color: white !important; padding: 13px 32px; text-decoration: none; border-radius: 6px; font-weight: bold; }
  .cta { text-align: center; margin: 30px 0; }
  .muted { color: #666; font-size: 13px; }
  .mono { font-family: 'SFMono-Regular', Consolas, Menlo, monospace; }
  table.rows { width: 100%; border-collapse: collapse; background-color: white; border-radius: 8px; table-layout: fixed; }
  table.rows th, table.rows td { padding: 10px; border-bottom: 1px solid #eee; text-align: left; vertical-align: top; word-break: break-word; overflow-wrap: anywhere; }
  table.rows th { color: #555; font-weight: bold; }
  .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; color: #666; font-size: 14px; }
  .footer p { margin: 2px 0; }
  @media only screen and (max-width: 480px) {
    body { padding: 10px; }
    .container { padding: 20px; }
    h2 { font-size: 20px; }
    .button { display: block; text-align: center; }
  }
`

export interface MailTheme {
  /** Accent/brand colour for the store name + default buttons/code box. Defaults to the classic blue. */
  accent?: string
  /** Page background behind the container. */
  pageBg?: string
  /** Container background. */
  containerBg?: string
  /** When set, the header shows this logo image instead of the text brand. */
  logoUrl?: string
  /** 'card' (default rounded container) or 'full' (edge-to-edge, used by bold/hero layouts). */
  frame?: 'card' | 'full'
  /** Header alignment. */
  headerAlign?: 'center' | 'left'
}

const DEFAULT_THEME: Required<Pick<MailTheme, 'accent' | 'pageBg' | 'containerBg' | 'frame' | 'headerAlign'>> = {
  accent: '#2563eb',
  pageBg: '#ffffff',
  containerBg: '#f9f9f9',
  frame: 'card',
  headerAlign: 'center',
}

export interface MailShellOptions {
  brand: string
  kicker?: string
  title?: string
  content: string
  footerLines?: string[]
  extraCss?: string
  preheader?: string
  documentTitle?: string
  /** Optional visual theme. Omitted → the classic blue card look, re-themed by applyMailTheme at send time. */
  theme?: MailTheme
  /** Footer line inviting the customer to reply (the mail carries a reply address that is read). */
  replyHint?: boolean
}

export const REPLY_HINT = 'You can reply to this email if you need anything.'

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function mailShell(o: MailShellOptions): string {
  const brand = escapeHtml(o.brand)
  const t = { ...DEFAULT_THEME, ...(o.theme ?? {}) }
  const logoUrl = o.theme?.logoUrl
  const footer = [
    `<p><strong>${brand}</strong></p>`,
    ...(o.footerLines ?? []).filter(Boolean).map(l => `<p>${l}</p>`),
    ...(o.replyHint ? [`<p>${REPLY_HINT}</p>`] : []),
  ].join('\n              ')
  // Untouched by a caller theme: let applyMailTheme swap in the store's logo and accent.
  const mark = (name: string, html: string) => (o.theme ? html : `<!--mail-${name}-->${html}<!--/mail-${name}-->`)
  // Theme overrides applied as scoped inline-ish CSS after the base sheet so existing classes win by
  // default but the accent/background follow the selected layout.
  const themeCss = `
    body { background:${t.pageBg}; }
    .container { background-color:${t.containerBg}; ${t.frame === 'full' ? 'border-radius:0;border:none;padding:0;' : ''} }
    .header { text-align:${t.headerAlign}; }
    .brand { color:${t.accent}; }
    .code-box, .button { background-color:${t.accent}; }
    .info { border-left-color:${t.accent}; }
  `
  const brandHeader = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${brand}" style="max-height:48px;max-width:200px;display:inline-block;" />`
    : `<div class="brand" style="font-size:28px;font-weight:bold;color:${t.accent};letter-spacing:0.5px;">${brand}</div>`
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    ${o.documentTitle ? `<title>${escapeHtml(o.documentTitle)}</title>` : ''}
    <style>${MAIL_BASE_CSS}${themeCss}${o.extraCss ?? ''}</style>
  </head>
  <body>
    ${o.preheader ? `<span style="display:none;font-size:1px;color:#f9f9f9;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(o.preheader)}</span>` : ''}
    <div class="container">
      <div class="header">
        ${mark('brand', brandHeader)}
        ${o.kicker ? `<p class="kicker" style="color:#666;">${escapeHtml(o.kicker)}</p>` : ''}
      </div>
      ${o.title ? `<h2>${escapeHtml(o.title)}</h2>` : ''}
      ${o.content}
      <div class="footer">
              ${mark('footer', footer)}
      </div>
    </div>
  </body>
</html>`
}

export interface StoreMailTheme {
  logoUrl?: string | null
  accent?: string | null
  /** Add the reply line to the footer (the mail carries a reply address that is read). */
  replyHint?: boolean
}

const HEX = /^#[0-9a-f]{6}$/i

/** Gives a default-themed mailShell mail the store's logo and accent colour. Other HTML is returned as is. */
export function applyMailTheme(html: string, t: StoreMailTheme): string {
  if (!html.includes('<!--mail-brand-->')) return html
  let out = html
  const logo = t.logoUrl && /^https?:\/\//i.test(t.logoUrl) ? t.logoUrl : null
  if (logo) {
    out = out.replace(/<!--mail-brand-->([\s\S]*?)<!--\/mail-brand-->/, (_m, inner: string) => {
      const alt = /<div class="brand"[^>]*>([\s\S]*?)<\/div>/.exec(inner)?.[1] ?? ''
      return `<!--mail-brand--><img src="${escapeHtml(logo)}" alt="${alt}" style="max-height:48px;max-width:200px;display:inline-block;" /><!--/mail-brand-->`
    })
  }
  const accent = t.accent && HEX.test(t.accent) ? t.accent : null
  if (accent) {
    out = out
      .replace(/(<div class="brand" style="[^"]*?)color:#[0-9a-f]{6}/i, `$1color:${accent}`)
      .replace('</head>', `<style>.code-box,.button{background-color:${accent} !important}.info{border-left-color:${accent} !important}a{color:${accent}}.button{color:#ffffff !important}</style></head>`)
  }
  if (t.replyHint && !out.includes(REPLY_HINT)) out = out.replace('<!--/mail-footer-->', `<p>${REPLY_HINT}</p><!--/mail-footer-->`)
  return out
}

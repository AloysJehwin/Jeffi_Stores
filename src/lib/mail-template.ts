// The one shell every mail uses: store name in blue, optional grey kicker, title, the mail's own
// content, bordered footer carrying the brand. Mail-specific classes go in extraCss.

export const MAIL_BASE_CSS = `
  body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
  .container { background-color: #f9f9f9; border-radius: 10px; padding: 30px; border: 1px solid #e0e0e0; }
  .header { text-align: center; margin-bottom: 30px; }
  .brand { font-size: 28px; font-weight: bold; color: #2563eb; letter-spacing: 0.5px; }
  .kicker { color: #666; margin: 6px 0 0 0; }
  h2 { color: #333; margin-top: 0; }
  h3 { color: #333; }
  .card { background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
  .info { background-color: #f0f9ff; border-left: 4px solid #2563eb; padding: 15px; margin: 20px 0; border-radius: 4px; }
  .warning { background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px; }
  .success { background-color: #d4edda; border-left: 4px solid #28a745; padding: 15px; margin: 20px 0; border-radius: 4px; }
  .danger { background-color: #fee2e2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0; border-radius: 4px; }
  .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
  .info-label { font-weight: bold; color: #555; }
  .code-box { background-color: #2563eb; color: white; font-size: 32px; font-weight: bold; text-align: center; padding: 20px; border-radius: 8px; letter-spacing: 8px; margin: 24px 0; }
  .button { display: inline-block; background-color: #2563eb; color: white !important; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; }
  .cta { text-align: center; margin: 30px 0; }
  .muted { color: #666; font-size: 13px; }
  .mono { font-family: 'SFMono-Regular', Consolas, Menlo, monospace; }
  table.rows { width: 100%; border-collapse: collapse; background-color: white; border-radius: 8px; }
  table.rows th, table.rows td { padding: 10px; border-bottom: 1px solid #eee; text-align: left; vertical-align: top; }
  table.rows th { color: #555; font-weight: bold; }
  .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; color: #666; font-size: 14px; }
`

export interface MailShellOptions {
  brand: string
  kicker?: string
  title?: string
  content: string
  footerLines?: string[]
  extraCss?: string
  preheader?: string
  documentTitle?: string
}

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
  const footer = [`<p><strong>${brand}</strong></p>`, ...(o.footerLines ?? []).filter(Boolean).map(l => `<p>${l}</p>`)].join('\n              ')
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    ${o.documentTitle ? `<title>${escapeHtml(o.documentTitle)}</title>` : ''}
    <style>${MAIL_BASE_CSS}${o.extraCss ?? ''}</style>
  </head>
  <body>
    ${o.preheader ? `<span style="display:none;font-size:1px;color:#f9f9f9;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(o.preheader)}</span>` : ''}
    <div class="container">
      <div class="header">
        <div class="brand" style="font-size:28px;font-weight:bold;color:#2563eb;letter-spacing:0.5px;">${brand}</div>
        ${o.kicker ? `<p class="kicker" style="color:#666;">${escapeHtml(o.kicker)}</p>` : ''}
      </div>
      ${o.title ? `<h2>${escapeHtml(o.title)}</h2>` : ''}
      ${o.content}
      <div class="footer">
              ${footer}
      </div>
    </div>
  </body>
</html>`
}

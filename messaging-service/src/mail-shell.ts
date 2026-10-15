// Minimal mirror of monolith's mailShell. Wraps rendered template body in the tenant's
// brand header + footer so recipient sees branded mail even when the stored template is plain text.
// Skipped when the body already starts with <!DOCTYPE or <html — admin-authored full HTML is passed through.

const esc = (v: unknown) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const BASE_CSS = `
  body{font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;}
  .container{background-color:#f9f9f9;border-radius:10px;padding:30px;border:1px solid #e0e0e0;}
  .header{text-align:center;margin-bottom:30px;}
  .brand{font-size:28px;font-weight:bold;color:#2563eb;letter-spacing:0.5px;}
  .kicker{color:#666;margin:6px 0 0;}
  h2{color:#1f2937;margin-top:0;font-size:22px;line-height:1.3;}
  p{margin:0 0 14px;}
  a{color:#2563eb;}
  .button{display:inline-block;background-color:#2563eb;color:white !important;padding:13px 32px;text-decoration:none;border-radius:6px;font-weight:bold;}
  .cta{text-align:center;margin:30px 0;}
  .footer{text-align:center;margin-top:30px;padding-top:20px;border-top:1px solid #e0e0e0;color:#666;font-size:14px;}
  .footer p{margin:2px 0;}
`

export interface WrapOpts {
  brand?: string
  kicker?: string
  footerContact?: string
}

export function wrapEmail(body: string, opts: WrapOpts): string {
  if (/^\s*<!DOCTYPE|^\s*<html/i.test(body)) return body
  const brand = esc(opts.brand || 'Notifications')
  const kicker = opts.kicker ? `<p class="kicker">${esc(opts.kicker)}</p>` : ''
  const footerContact = opts.footerContact ? `<p>${esc(opts.footerContact)}</p>` : ''
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BASE_CSS}</style></head><body><div class="container"><div class="header"><div class="brand">${brand}</div>${kicker}</div>${body}<div class="footer"><p><strong>${brand}</strong></p>${footerContact}</div></div></body></html>`
}

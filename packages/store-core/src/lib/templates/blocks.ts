// Email block-builder: a JSON block document the admin composes, rendered to email-safe HTML that then
// flows through the same layout + variable pipeline as rich-text bodies. Variable tokens ({store_name},
// {customer_first_name}, {productCard}, …) are left intact for renderVars to fill at send time.
//
// Self-contained (no imports of the heavy send modules) so it stays usable in the client preview and
// avoids an import cycle with email-campaigns.ts.

// Matches ctaButton() in email-campaigns.ts so blocks and rich-text CTAs look identical.
function ctaButton(text: string, url: string): string {
  return `<a href="${url}" style="display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;margin:16px 0;">${text}</a>`
}

export type EmailBlock =
  | { type: 'heading'; text: string; align?: 'left' | 'center' }
  | { type: 'text'; html: string }
  | { type: 'image'; url: string; alt?: string; href?: string; width?: number }
  | { type: 'hero_image'; url: string; alt?: string; href?: string }
  | { type: 'cta_button'; text: string; url: string }
  | { type: 'divider' }
  | { type: 'spacer'; size?: 'sm' | 'md' | 'lg' }
  // Token-driven product blocks: expanded by the send pipeline's registered vars.
  | { type: 'product_rows' } // -> {itemsHtml}
  | { type: 'product_card' } // -> {productCard}
  // The message's coupon: {couponCode}/{discountLabel} fill per send; the block drops out without a coupon.
  | { type: 'coupon'; heading?: string; note?: string }
  // Hand-picked products, captured when picked so the email shows what the admin saw.
  | { type: 'products'; items: EmailProduct[]; columns?: 1 | 2 }

export interface EmailProduct {
  name: string
  url: string
  image?: string | null
  price?: string | null
  mrp?: string | null
}

export const BLOCK_TYPES: EmailBlock['type'][] = [
  'heading',
  'text',
  'image',
  'hero_image',
  'cta_button',
  'divider',
  'spacer',
  'product_rows',
  'product_card',
  'coupon',
  'products',
]

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// NOTE: block text/HTML may contain {var} tokens — do NOT escape those fields (renderVars fills them
// later and escapes values). Only escape attribute-only, non-templated fields (urls/alt).
function renderBlock(b: EmailBlock): string {
  switch (b.type) {
    case 'heading':
      return `<h2 style="margin:0 0 12px;text-align:${b.align === 'center' ? 'center' : 'left'};">${b.text}</h2>`
    case 'text':
      return `<div style="font-size:15px;line-height:1.6;color:#333;margin:0 0 14px;">${b.html}</div>`
    case 'image': {
      const img = `<img src="${esc(b.url)}" alt="${esc(b.alt)}" width="${b.width ?? 560}" style="display:block;max-width:100%;height:auto;border-radius:6px;margin:0 auto;" />`
      return `<div style="text-align:center;margin:0 0 16px;">${b.href ? `<a href="${esc(b.href)}">${img}</a>` : img}</div>`
    }
    case 'hero_image': {
      const img = `<img src="${esc(b.url)}" alt="${esc(b.alt)}" style="display:block;width:100%;max-width:600px;height:auto;border-radius:8px;margin:0 0 20px;" />`
      return b.href ? `<a href="${esc(b.href)}">${img}</a>` : img
    }
    case 'cta_button':
      return `<div class="cta" style="text-align:center;margin:24px 0;">${ctaButton(b.text, b.url)}</div>`
    case 'divider':
      return `<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />`
    case 'spacer': {
      const h = b.size === 'lg' ? 32 : b.size === 'sm' ? 8 : 16
      return `<div style="height:${h}px;line-height:${h}px;">&nbsp;</div>`
    }
    case 'product_rows':
      return '{itemsHtml}'
    case 'product_card':
      return '{productCard}'
    case 'coupon':
      return `{#if couponCode}<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:20px 0;"><tr><td align="center" style="border:2px dashed #e07b3f;border-radius:10px;padding:20px;background:#fff7ed;">
${b.heading ? `<div style="font-size:16px;font-weight:600;color:#333;margin:0 0 8px;">${b.heading}</div>` : ''}<div style="font-size:26px;font-weight:800;letter-spacing:2px;color:#e07b3f;font-family:monospace;">{couponCode}</div>
<div style="font-size:14px;color:#555;margin-top:6px;">{discountLabel}</div>${b.note ? `<div style="font-size:12px;color:#888;margin-top:8px;">${b.note}</div>` : ''}</td></tr></table>{/if}`
    case 'products':
      return productGrid(b.items ?? [], b.columns === 1 ? 1 : 2)
    default:
      return ''
  }
}

function productCell(p: EmailProduct, width: number): string {
  const price = p.price
    ? `<div style="margin-top:6px;">${p.mrp && p.mrp !== p.price ? `<span style="color:#999;text-decoration:line-through;font-size:13px;">₹${esc(p.mrp)}</span>&nbsp;` : ''}<strong style="color:#1a3a4a;font-size:16px;">₹${esc(p.price)}</strong></div>`
    : ''
  const img = p.image ? `<a href="${esc(p.url)}"><img src="${esc(p.image)}" alt="${esc(p.name)}" width="${width}" style="display:block;width:100%;max-width:${width}px;height:auto;border-radius:6px;background:#f5f5f5;margin:0 auto 10px;" /></a>` : ''
  return `${img}<a href="${esc(p.url)}" style="color:#1a3a4a;font-weight:600;font-size:15px;text-decoration:none;">${esc(p.name)}</a>${price}
<div style="margin-top:10px;"><a href="${esc(p.url)}" style="display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:8px 18px;border-radius:6px;font-weight:600;font-size:13px;">Shop now</a></div>`
}

function productGrid(items: EmailProduct[], columns: 1 | 2): string {
  if (!items.length) return ''
  const width = columns === 1 ? 280 : 240
  const rows: string[] = []
  for (let i = 0; i < items.length; i += columns) {
    const cells = items.slice(i, i + columns).map(p => `<td valign="top" align="center" width="${Math.floor(100 / columns)}%" style="padding:10px;">${productCell(p, width)}</td>`)
    if (cells.length < columns) cells.push(`<td width="${Math.floor(100 / columns)}%"></td>`)
    rows.push(`<tr>${cells.join('')}</tr>`)
  }
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:8px 0 16px;">${rows.join('')}</table>`
}

export function isEmailBlockArray(v: unknown): v is EmailBlock[] {
  return Array.isArray(v) && v.every(b => b && typeof b === 'object' && typeof (b as any).type === 'string')
}

/** Render a block document to body HTML (still containing variable tokens for the send pipeline). */
export function renderBlocks(blocks: unknown): string {
  if (!isEmailBlockArray(blocks)) return ''
  return blocks.map(renderBlock).join('\n')
}

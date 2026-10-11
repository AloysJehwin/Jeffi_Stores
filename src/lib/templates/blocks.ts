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
    default:
      return ''
  }
}

export function isEmailBlockArray(v: unknown): v is EmailBlock[] {
  return Array.isArray(v) && v.every(b => b && typeof b === 'object' && typeof (b as any).type === 'string')
}

/** Render a block document to body HTML (still containing variable tokens for the send pipeline). */
export function renderBlocks(blocks: unknown): string {
  if (!isEmailBlockArray(blocks)) return ''
  return blocks.map(renderBlock).join('\n')
}

// Client-safe: the sample data + renderer every email preview uses (campaign editor, Templates page),
// so the two show the same thing.
import { renderConditionals, renderTemplate as renderVars, sampleVariableMap, stripDoubleBraceTokens } from '@/lib/templates/variables-shared'
import { renderLayoutPreview } from '@/lib/templates/email-layouts'
import { bridgeVars } from '@/lib/templates/var-bridge'

export const SAMPLE_ITEMS_HTML = `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;margin:16px 0;">
  <tr>
    <td valign="top" style="padding:12px 12px 12px 0;width:80px;"><img src="https://placehold.co/120x120/e07b3f/ffffff?text=A" alt="Sample A" width="72" height="72" style="display:block;border-radius:6px;border:1px solid #e5e7eb;background:#f5f5f5;width:72px;height:72px;" /></td>
    <td valign="top" style="padding:12px 0;"><span style="color:#1a3a4a;font-weight:600;font-size:15px;">Sample Product A</span><div style="color:#777;font-size:13px;margin-top:4px;">Qty: 2</div></td>
    <td align="right" valign="top" style="padding:12px 0 12px 12px;color:#1a3a4a;font-weight:600;font-size:14px;white-space:nowrap;">₹500</td>
  </tr>
  <tr>
    <td valign="top" style="padding:12px 12px 12px 0;width:80px;"><img src="https://placehold.co/120x120/1a3a4a/ffffff?text=B" alt="Sample B" width="72" height="72" style="display:block;border-radius:6px;border:1px solid #e5e7eb;background:#f5f5f5;width:72px;height:72px;" /></td>
    <td valign="top" style="padding:12px 0;"><span style="color:#1a3a4a;font-weight:600;font-size:15px;">Sample Product B</span><div style="color:#777;font-size:13px;margin-top:4px;">Qty: 1</div></td>
    <td align="right" valign="top" style="padding:12px 0 12px 12px;color:#1a3a4a;font-weight:600;font-size:14px;white-space:nowrap;">₹1,200</td>
  </tr>
</table>`

export const SAMPLE_PRODUCT_CARD = `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:8px 0 20px;background:#fafafa;border:1px solid #e5e7eb;border-radius:8px;">
  <tr><td align="center" style="padding:24px 24px 16px;"><img src="https://placehold.co/280x280/e07b3f/ffffff?text=Product" alt="Sample Product" width="280" style="display:block;max-width:100%;border-radius:6px;background:#fff;" /></td></tr>
  <tr><td align="center" style="padding:0 24px 24px;"><div style="color:#1a3a4a;font-size:18px;font-weight:700;">Sample Product</div><div style="margin:12px 0 0;"><span style="color:#999;text-decoration:line-through;font-size:14px;">₹999</span>&nbsp;&nbsp;<strong style="color:#e07b3f;font-size:22px;">₹799</strong></div></td></tr>
</table>`

export const CAMPAIGN_SAMPLE_VARS: Record<string, string | number> = {
  firstName: 'Sample',
  itemCount: 2,
  cartItems: SAMPLE_ITEMS_HTML,
  itemsHtml: SAMPLE_ITEMS_HTML,
  productCard: SAMPLE_PRODUCT_CARD,
  orderNumber: 'TEST-12345',
  total: '2200.00',
  discountPercent: 10,
  couponCode: 'BACK-AB12CD',
  productName: 'Sample Product',
  productImageUrl: 'https://placehold.co/280x280/e07b3f/ffffff?text=Product',
  oldPrice: '999',
  newPrice: '799',
  ctaUrl: '#',
}

// Same pipeline as the send: scenario vars, then registered variables (samples), then unset vars collapse.
export function renderPreviewTemplate(template: string, vars: Record<string, string | number>): string {
  const samples = sampleVariableMap()
  const filled = renderVars(renderVars(renderConditionals(template || '', { ...samples, ...vars }), vars), samples)
  return stripDoubleBraceTokens(filled).replace(/\{(\w+)\}/g, (_m, k) => (vars[k] != null ? String(vars[k]) : ''))
}

/** Full preview document: body with sample values inside the email layout (default layout unless given). */
export function emailPreviewDoc(body: string, layout?: string | null, vars: Record<string, string | number> = CAMPAIGN_SAMPLE_VARS): string {
  const v = bridgeVars(vars)
  return renderPreviewTemplate(renderLayoutPreview(layout, renderPreviewTemplate(body, v)), v)
}

export const previewSubject = (subject: string, vars: Record<string, string | number> = CAMPAIGN_SAMPLE_VARS) =>
  renderPreviewTemplate(subject, bridgeVars(vars))

/** No layout: just the body with sample values (templates set to send their HTML as written). */
export function emailBodyDoc(body: string, vars: Record<string, string | number> = CAMPAIGN_SAMPLE_VARS): string {
  return `<!doctype html><html><body style="margin:0;padding:16px;background:#fff">${renderPreviewTemplate(body, bridgeVars(vars))}</body></html>`
}

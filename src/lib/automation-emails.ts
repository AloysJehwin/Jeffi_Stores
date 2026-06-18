import {
  type CampaignKind,
  type Campaign,
  getCampaign,
  canSendMarketing,
  alreadySentForReference,
  recordSent,
  generateCouponForCampaign,
  getAssignedCouponCode,
  buildUnsubscribeUrl,
  renderTemplate,
  wrapWithTracking,
} from './marketing'
import { baseLayout, ctaButton } from './email-campaigns'
import { queryOne } from './db'
import { sendAuditedMail } from './mail-audit'

function resolveAppUrl(): string {
  const isLocalhost = (v: string | undefined) => !!v && /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(v)
  const isProd = process.env.NODE_ENV === 'production'
  const pickFirst = (vals: Array<string | undefined>) =>
    vals.find(v => v && (!isProd || !isLocalhost(v))) || ''

  const candidate =
    pickFirst([
      process.env.NEXT_PUBLIC_APP_URL,
      process.env.APP_URL,
      process.env.NEXT_PUBLIC_BASE_URL,
      process.env.BASE_URL,
    ]) ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
    (isProd ? 'https://jeffistores.in' : 'http://localhost:3000')
  return candidate.replace(/\/$/, '')
}

export const APP_URL = resolveAppUrl()

interface UserContext {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  unsubscribe_token: string
}

export async function sendCampaignEmail(params: {
  campaign: Campaign
  user: UserContext
  referenceId: string | null
  vars: Record<string, string | number>
}): Promise<{ ok: boolean; sentId?: string; reason?: string }> {
  const { campaign, user, referenceId, vars } = params

  const eligibility = await canSendMarketing(user.id, campaign.kind as CampaignKind)
  if (!eligibility.ok) return { ok: false, reason: eligibility.reason }

  if (await alreadySentForReference(campaign.kind as CampaignKind, user.id, referenceId)) {
    return { ok: false, reason: 'already_sent' }
  }

  const sentId = await recordSent({
    campaignKind: campaign.kind as CampaignKind,
    userId: user.id,
    referenceId,
  })
  if (!sentId) return { ok: false, reason: 'record_failed' }

  const subject = renderTemplate(campaign.subject_template, vars)
  const renderedBody = renderTemplate(campaign.body_template, vars)
  const unsubscribeUrl = buildUnsubscribeUrl(user.unsubscribe_token, campaign.kind as CampaignKind)
  const tracked = wrapWithTracking(renderedBody, sentId, unsubscribeUrl)
  const html = baseLayout(subject, tracked)

  try {
    await sendAuditedMail({
      from: `"Jeffi Store's" <${process.env.SES_FROM_EMAIL}>`,
      to: user.email,
      subject,
      html,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      kind: 'automation',
      templateName: campaign.kind,
      entityType: 'users',
      entityId: user.id,
      userId: user.id,
      metadata: { sentId, referenceId },
    })
    return { ok: true, sentId }
  } catch (err) {
    console.error('[route]', err)
    return { ok: false, reason: 'send_failed' }
  }
}

export async function fetchUserContext(userId: string): Promise<UserContext | null> {
  return queryOne<UserContext>(
    `SELECT id, email, first_name, last_name, unsubscribe_token::text AS unsubscribe_token
     FROM users WHERE id = $1`,
    [userId]
  )
}

export async function fetchProductImageUrl(productId: string): Promise<string> {
  const row = await queryOne<{ image_url: string }>(
    `SELECT image_url FROM product_images WHERE product_id = $1 ORDER BY display_order ASC LIMIT 1`,
    [productId]
  )
  return row?.image_url || ''
}

const PLACEHOLDER_IMAGE = 'https://placehold.co/120x120/f5f5f5/999999?text=Item'

export interface EmailItem {
  name: string
  quantity?: number
  unitLabel?: string
  price?: number
  imageUrl?: string | null
  productUrl?: string | null
}

export function renderItemRows(items: EmailItem[]): string {
  if (!items.length) return ''
  const rows = items.map(i => {
    const img = i.imageUrl || PLACEHOLDER_IMAGE
    const qty = i.quantity != null ? `${i.quantity}${i.unitLabel ? ` ${i.unitLabel}` : ''}` : ''
    const priceCell = i.price != null
      ? `<td align="right" valign="top" style="padding:12px 0 12px 12px;color:#1a3a4a;font-weight:600;font-size:14px;white-space:nowrap;">₹${Math.round(i.price).toLocaleString('en-IN')}</td>`
      : ''
    const nameCell = i.productUrl
      ? `<a href="${i.productUrl}" style="color:#1a3a4a;text-decoration:none;font-weight:600;font-size:15px;">${i.name}</a>`
      : `<span style="color:#1a3a4a;font-weight:600;font-size:15px;">${i.name}</span>`
    return `<tr>
      <td valign="top" style="padding:12px 12px 12px 0;width:80px;">
        <img src="${img}" alt="${i.name.replace(/"/g, '&quot;')}" width="72" height="72" style="display:block;border-radius:6px;border:1px solid #e5e7eb;background:#f5f5f5;object-fit:cover;width:72px;height:72px;" />
      </td>
      <td valign="top" style="padding:12px 0;">
        ${nameCell}
        ${qty ? `<div style="color:#777;font-size:13px;margin-top:4px;">Qty: ${qty}</div>` : ''}
      </td>
      ${priceCell}
    </tr>`
  }).join('')
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;margin:16px 0;">${rows}</table>`
}

export function renderHeroProduct(item: { name: string; imageUrl?: string | null; productUrl?: string | null; oldPrice?: number; newPrice?: number }): string {
  const img = item.imageUrl || PLACEHOLDER_IMAGE
  const priceBlock = item.newPrice != null
    ? `<div style="margin:12px 0 0;">${item.oldPrice != null && item.oldPrice !== item.newPrice ? `<span style="color:#999;text-decoration:line-through;font-size:14px;">₹${Math.round(item.oldPrice).toLocaleString('en-IN')}</span>&nbsp;&nbsp;` : ''}<strong style="color:#e07b3f;font-size:22px;">₹${Math.round(item.newPrice).toLocaleString('en-IN')}</strong></div>`
    : ''
  const nameWrap = item.productUrl
    ? `<a href="${item.productUrl}" style="color:#1a3a4a;text-decoration:none;">${item.name}</a>`
    : item.name
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:8px 0 20px;background:#fafafa;border:1px solid #e5e7eb;border-radius:8px;">
      <tr>
        <td align="center" style="padding:24px 24px 16px;">
          <img src="${img}" alt="${item.name.replace(/"/g, '&quot;')}" width="280" style="display:block;max-width:100%;border-radius:6px;background:#fff;" />
        </td>
      </tr>
      <tr>
        <td align="center" style="padding:0 24px 24px;">
          <div style="color:#1a3a4a;font-size:18px;font-weight:700;">${nameWrap}</div>
          ${priceBlock}
        </td>
      </tr>
    </table>`
}

export async function resolveCoupon(campaign: Campaign, _userId: string): Promise<{ couponCode: string; discountPercent: number }> {
  if (campaign.coupon_id) {
    const info = await getAssignedCouponCode(campaign.coupon_id)
    if (info) {
      const pct = info.discountType === 'percentage' ? info.discountValue : 0
      return { couponCode: info.code, discountPercent: pct }
    }
  }
  if (campaign.discount_percent > 0) {
    const code = await generateCouponForCampaign({
      campaignKind: campaign.kind as CampaignKind,
      discountPercent: campaign.discount_percent,
      expiresInDays: 14,
    })
    if (code) return { couponCode: code, discountPercent: campaign.discount_percent }
  }
  return { couponCode: '', discountPercent: campaign.discount_percent }
}

export async function sendAbandonedCartEmail(userId: string, cartItems: Array<{ name: string; quantity: number; price: number }>) {
  const campaign = await getCampaign('abandoned_cart')
  const user = await fetchUserContext(userId)
  if (!campaign || !user) return { ok: false, reason: 'precond' }

  const itemsHtml = cartItems
    .slice(0, 5)
    .map(i => `<li>${i.quantity} × ${i.name} (₹${Math.round(i.price)})</li>`)
    .join('')

  const { couponCode, discountPercent } = await resolveCoupon(campaign, userId)

  return sendCampaignEmail({
    campaign,
    user,
    referenceId: null,
    vars: {
      firstName: user.first_name || 'there',
      itemCount: cartItems.length,
      cartItems: `<ul>${itemsHtml}</ul>`,
      couponCode,
      discountPercent,
      ctaUrl: `${APP_URL}/cart`,
    },
  })
}

export async function sendAbandonedCheckoutEmail(userId: string, order: { id: string; order_number: string; total_amount: string | number }) {
  const campaign = await getCampaign('abandoned_checkout')
  const user = await fetchUserContext(userId)
  if (!campaign || !user) return { ok: false, reason: 'precond' }

  const { couponCode, discountPercent } = await resolveCoupon(campaign, userId)

  return sendCampaignEmail({
    campaign,
    user,
    referenceId: order.id,
    vars: {
      firstName: user.first_name || 'there',
      orderNumber: order.order_number,
      total: Number(order.total_amount).toFixed(2),
      couponCode,
      discountPercent,
      ctaUrl: `${APP_URL}/cart`,
    },
  })
}

export async function sendPostPurchaseEmail(userId: string, order: { id: string; order_number: string }) {
  const campaign = await getCampaign('post_purchase')
  const user = await fetchUserContext(userId)
  if (!campaign || !user) return { ok: false, reason: 'precond' }

  const { couponCode, discountPercent } = await resolveCoupon(campaign, userId)

  return sendCampaignEmail({
    campaign,
    user,
    referenceId: order.id,
    vars: {
      firstName: user.first_name || 'there',
      orderNumber: order.order_number,
      couponCode,
      discountPercent,
      ctaUrl: `${APP_URL}/account/orders/${order.id}`,
    },
  })
}

export async function sendReviewReminderEmail(userId: string, order: { id: string; order_number: string }) {
  const campaign = await getCampaign('review_reminder')
  const user = await fetchUserContext(userId)
  if (!campaign || !user) return { ok: false, reason: 'precond' }

  const { couponCode, discountPercent } = await resolveCoupon(campaign, userId)

  return sendCampaignEmail({
    campaign,
    user,
    referenceId: order.id,
    vars: {
      firstName: user.first_name || 'there',
      orderNumber: order.order_number,
      couponCode,
      discountPercent,
      ctaUrl: `${APP_URL}/account/orders/${order.id}`,
    },
  })
}

export async function sendWinbackEmail(userId: string, kind: 'winback_90' | 'winback_180') {
  const campaign = await getCampaign(kind)
  const user = await fetchUserContext(userId)
  if (!campaign || !user) return { ok: false, reason: 'precond' }

  const { couponCode, discountPercent } = await resolveCoupon(campaign, userId)
  if ((campaign.coupon_id || campaign.discount_percent > 0) && !couponCode) {
    return { ok: false, reason: 'coupon_failed' }
  }

  return sendCampaignEmail({
    campaign,
    user,
    referenceId: null,
    vars: {
      firstName: user.first_name || 'there',
      discountPercent,
      couponCode,
      ctaUrl: `${APP_URL}/products`,
    },
  })
}

export async function sendRestockEmail(userId: string, product: { id: string; name: string; slug: string }) {
  const campaign = await getCampaign('restock')
  const user = await fetchUserContext(userId)
  if (!campaign || !user) return { ok: false, reason: 'precond' }

  const { couponCode, discountPercent } = await resolveCoupon(campaign, userId)
  const productImageUrl = await fetchProductImageUrl(product.id)

  return sendCampaignEmail({
    campaign,
    user,
    referenceId: product.id,
    vars: {
      firstName: user.first_name || 'there',
      productName: product.name,
      productImageUrl,
      couponCode,
      discountPercent,
      ctaUrl: `${APP_URL}/products/${product.slug}`,
    },
  })
}

export async function sendPriceDropEmail(
  userId: string,
  product: { id: string; name: string; slug: string },
  oldPrice: number,
  newPrice: number
) {
  const campaign = await getCampaign('price_drop')
  const user = await fetchUserContext(userId)
  if (!campaign || !user) return { ok: false, reason: 'precond' }

  const { couponCode, discountPercent } = await resolveCoupon(campaign, userId)
  const productImageUrl = await fetchProductImageUrl(product.id)

  return sendCampaignEmail({
    campaign,
    user,
    referenceId: product.id,
    vars: {
      firstName: user.first_name || 'there',
      productName: product.name,
      productImageUrl,
      oldPrice: Math.round(oldPrice).toString(),
      newPrice: Math.round(newPrice).toString(),
      couponCode,
      discountPercent,
      ctaUrl: `${APP_URL}/products/${product.slug}`,
    },
  })
}

export async function sendTestCampaignEmail(kind: CampaignKind, toEmail: string) {
  const campaign = await getCampaign(kind)
  if (!campaign) return { ok: false, reason: 'campaign_not_found' }

  const sampleItems = [
    { name: 'Sample Product A', quantity: 2, price: 500, imageUrl: 'https://placehold.co/120x120/e07b3f/ffffff?text=A', productUrl: '#' },
    { name: 'Sample Product B', quantity: 1, price: 1200, imageUrl: 'https://placehold.co/120x120/1a3a4a/ffffff?text=B', productUrl: '#' },
  ]
  const sampleVars: Record<string, string | number> = {
    firstName: 'Sample',
    itemCount: sampleItems.length,
    cartItems: renderItemRows(sampleItems),
    itemsHtml: renderItemRows(sampleItems),
    productCard: renderHeroProduct({ name: 'Sample Product', imageUrl: 'https://placehold.co/280x280/e07b3f/ffffff?text=Product', productUrl: '#', oldPrice: 999, newPrice: 799 }),
    orderNumber: 'TEST-12345',
    total: '2200.00',
    discountPercent: campaign.discount_percent || 10,
    couponCode: 'TEST-CODE',
    productName: 'Sample Product',
    productImageUrl: 'https://placehold.co/280x280/e07b3f/ffffff?text=Product',
    oldPrice: '999',
    newPrice: '799',
    ctaUrl: `${APP_URL}/products`,
  }

  const subject = `[TEST] ${renderTemplate(campaign.subject_template, sampleVars)}`
  const body = renderTemplate(campaign.body_template, sampleVars)
  const html = baseLayout(subject, body + `<p style="margin-top:24px;color:#999;font-size:12px;">— This is a test send. Tracking pixel and unsubscribe footer omitted.</p>`)

  try {
    await sendAuditedMail({
      from: `"Jeffi Store's" <${process.env.SES_FROM_EMAIL}>`,
      to: toEmail,
      subject,
      html,
      kind: 'automation',
      templateName: `${kind}_test`,
      entityType: null,
      entityId: null,
      userId: null,
    })
    return { ok: true }
  } catch (err: any) {
    return { ok: false, reason: err?.message || 'send_failed' }
  }
}

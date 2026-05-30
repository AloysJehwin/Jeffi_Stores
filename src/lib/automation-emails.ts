import { transporter } from './email'
import {
  type CampaignKind,
  type Campaign,
  getCampaign,
  canSendMarketing,
  alreadySentForReference,
  recordSent,
  generateCouponForUser,
  getAssignedCouponCode,
  buildUnsubscribeUrl,
  renderTemplate,
  wrapWithTracking,
} from './marketing'
import { baseLayout, ctaButton } from './email-campaigns'
import { queryOne } from './db'

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')

interface UserContext {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  unsubscribe_token: string
}

async function sendCampaignEmail(params: {
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
    await transporter.sendMail({
      from: `"Jeffi Store's" <${process.env.SES_FROM_EMAIL}>`,
      to: user.email,
      subject,
      html,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    })
    return { ok: true, sentId }
  } catch {
    return { ok: false, reason: 'send_failed' }
  }
}

async function fetchUserContext(userId: string): Promise<UserContext | null> {
  return queryOne<UserContext>(
    `SELECT id, email, first_name, last_name, unsubscribe_token::text AS unsubscribe_token
     FROM users WHERE id = $1`,
    [userId]
  )
}

async function resolveCoupon(campaign: Campaign, userId: string): Promise<{ couponCode: string; discountPercent: number }> {
  if (campaign.coupon_id) {
    const info = await getAssignedCouponCode(campaign.coupon_id)
    if (info) {
      const pct = info.discountType === 'percentage' ? info.discountValue : 0
      return { couponCode: info.code, discountPercent: pct }
    }
  }
  if (campaign.discount_percent > 0) {
    const code = await generateCouponForUser({
      userId,
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

  return sendCampaignEmail({
    campaign,
    user,
    referenceId: product.id,
    vars: {
      firstName: user.first_name || 'there',
      productName: product.name,
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

  return sendCampaignEmail({
    campaign,
    user,
    referenceId: product.id,
    vars: {
      firstName: user.first_name || 'there',
      productName: product.name,
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

  const sampleVars: Record<string, string | number> = {
    firstName: 'Sample',
    itemCount: 3,
    cartItems: '<ul><li>2 × Widget (₹500)</li><li>1 × Gadget (₹1200)</li></ul>',
    orderNumber: 'TEST-12345',
    total: '2200.00',
    discountPercent: campaign.discount_percent || 10,
    couponCode: 'TEST-CODE',
    productName: 'Sample Product',
    oldPrice: '999',
    newPrice: '799',
    ctaUrl: `${APP_URL}/products`,
  }

  const subject = `[TEST] ${renderTemplate(campaign.subject_template, sampleVars)}`
  const body = renderTemplate(campaign.body_template, sampleVars)
  const html = baseLayout(subject, body + `<p style="margin-top:24px;color:#999;font-size:12px;">— This is a test send. Tracking pixel and unsubscribe footer omitted.</p>`)

  try {
    await transporter.sendMail({
      from: `"Jeffi Store's" <${process.env.SES_FROM_EMAIL}>`,
      to: toEmail,
      subject,
      html,
    })
    return { ok: true }
  } catch (err: any) {
    return { ok: false, reason: err?.message || 'send_failed' }
  }
}

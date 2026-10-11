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
} from '@/lib/shared/marketing'
import { baseLayout, ctaButton } from '@/lib/shared/email-campaigns'
import {
  isTruthyVar,
  renderConditionals,
  renderTemplate as renderVars,
  resolveTemplateVariables,
  stripDoubleBraceTokens,
} from '@/lib/templates/variables'
import { cooldownMinutes } from '@/lib/campaigns/duration'
import { DEFAULT_COUPON_DISCOUNT } from '@/lib/campaigns/default-templates'
import { queryOne } from '@/lib/shared/db'
import { sendAuditedMail } from '@/lib/shared/mail-audit'
import { apiBaseUrl } from '@/lib/shared/customer-links'

interface UserContext {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  unsubscribe_token: string
  baseUrl: string
}

// The campaign's send cooldown in MINUTES, read from its JSONB parameters (not on the Campaign type).
// Used to window the per-reference "already sent" check so recurring campaigns resend each cycle — at
// minute granularity, matching the eligibility preview. Reads the canonical `sendCooldown` (minutes) or
// the legacy `sendCooldownDays` integer. Returns null when the campaign has no cooldown (one-shot block).
function campaignCooldownMinutes(campaign: Campaign): number | null {
  const params = (campaign as unknown as { parameters?: Record<string, unknown> }).parameters
  if (!params) return null
  const hasCooldown =
    params.sendCooldown !== undefined && params.sendCooldown !== null
      ? true
      : typeof params.sendCooldownDays === 'number' && params.sendCooldownDays > 0
  if (!hasCooldown) return null
  return cooldownMinutes(params)
}

// Registered variables ({store_name}, {customer_first_name}, custom ones…) for this recipient. The
// store web is the customer's own base host, so a business customer sees the portal it uses.
async function recipientVars(user: Pick<UserContext, 'email' | 'first_name' | 'last_name' | 'baseUrl'>) {
  let web = user.baseUrl
  try {
    web = new URL(user.baseUrl).host
  } catch {}
  return resolveTemplateVariables({
    recipient: { email: user.email, first_name: user.first_name, last_name: user.last_name },
    store: web ? { web } : undefined,
  })
}

function stringVars(vars: Record<string, string | number>): Record<string, string> {
  return Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v == null ? '' : String(v)]))
}

// An element holding nothing but {couponCode} (the coupon box in templates saved before the
// {#if couponCode} block existed) is dropped when there is no coupon, rather than mailed empty.
const BARE_COUPON_ELEMENT_RE = /<(p|div|td|span)\b[^>]*>\s*\{\{?\s*couponCode\s*\}?\}\s*<\/\1>/gi

// {#if …} blocks, then scenario vars ({firstName}, {itemsHtml}…) and registered variables in both
// brace syntaxes, then the legacy collapse of any unset single-brace var to ''. Registered values are
// escaped in html.
export function renderCampaignTemplate(
  template: string,
  scenarioVars: Record<string, string | number>,
  registered: Record<string, string>,
  html: boolean
): string {
  let t = renderConditionals(template || '', { ...registered, ...scenarioVars })
  if (!isTruthyVar(scenarioVars.couponCode)) t = t.replace(BARE_COUPON_ELEMENT_RE, '')
  const pre = renderVars(renderVars(t, stringVars(scenarioVars)), registered, { escape: html })
  return renderTemplate(stripDoubleBraceTokens(pre), scenarioVars)
}

export async function sendCampaignEmail(params: {
  campaign: Campaign
  user: UserContext
  referenceId: string | null
  vars: Record<string, string | number>
  metadata?: Record<string, unknown>
}): Promise<{ ok: boolean; sentId?: string; reason?: string }> {
  const { campaign, user, referenceId, vars, metadata } = params

  const eligibility = await canSendMarketing(user.id, campaign.kind as CampaignKind)
  if (!eligibility.ok) return { ok: false, reason: eligibility.reason }

  // Honor the campaign's cooldown for keyed references so a recurring campaign resends after the
  // window instead of being blocked forever (abandoned_cart day-2 was never sending). (#campaign)
  const cooldownMin = campaignCooldownMinutes(campaign)
  if (await alreadySentForReference(campaign.kind as CampaignKind, user.id, referenceId, cooldownMin)) {
    return { ok: false, reason: 'already_sent' }
  }

  const sentId = await recordSent({
    campaignKind: campaign.kind as CampaignKind,
    userId: user.id,
    referenceId,
    metadata,
  })
  if (!sentId) return { ok: false, reason: 'record_failed' }

  const registered = await recipientVars(user)
  const subject = renderCampaignTemplate(campaign.subject_template, vars, registered, false)
  // Body source by template_mode: 'blocks' renders the block document, else the rich-text body_template.
  // Both still carry variable tokens that renderCampaignTemplate/renderVars fill below.
  let bodySource = campaign.body_template
  if (campaign.template_mode === 'blocks' && campaign.blocks != null) {
    const { renderBlocks } = await import('@/lib/templates/blocks')
    const rendered = renderBlocks(campaign.blocks)
    if (rendered) bodySource = rendered
  }
  const renderedBody = renderCampaignTemplate(bodySource, vars, registered, true)
  const { campaignMailFromAsync } = await import('@/lib/catalog/brand')
  const [fromAddr, apiBase] = await Promise.all([campaignMailFromAsync(), apiBaseUrl()])
  const storeName = registered.store_name
  // Unsubscribe and tracking are API routes, so they use the store host even for a business
  // customer, whose page base can end in /business (no API lives there).
  const unsubscribeUrl = buildUnsubscribeUrl(user.unsubscribe_token, campaign.kind as CampaignKind, apiBase)
  const tracked = wrapWithTracking(renderedBody, sentId, unsubscribeUrl, apiBase, storeName)
  const html = renderVars(baseLayout(subject, tracked, user.baseUrl, campaign.template_layout), registered, {
    escape: true,
  })

  try {
    await sendAuditedMail({
      from: fromAddr,
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
  } catch {
    return { ok: false, reason: 'send_failed' }
  }
}

export async function sendCampaignEmailRendered(params: {
  campaign: Campaign
  user: UserContext
  referenceId: string | null
  subject: string
  html: string
  ampHtml?: string
}): Promise<{ ok: boolean; sentId?: string; reason?: string }> {
  const { campaign, user, referenceId, subject, html, ampHtml } = params

  const eligibility = await canSendMarketing(user.id, campaign.kind as CampaignKind)
  if (!eligibility.ok) return { ok: false, reason: eligibility.reason }

  const cooldownMin = campaignCooldownMinutes(campaign)
  if (await alreadySentForReference(campaign.kind as CampaignKind, user.id, referenceId, cooldownMin)) {
    return { ok: false, reason: 'already_sent' }
  }

  const sentId = await recordSent({
    campaignKind: campaign.kind as CampaignKind,
    userId: user.id,
    referenceId,
  })
  if (!sentId) return { ok: false, reason: 'record_failed' }

  const { campaignMailFromAsync } = await import('@/lib/catalog/brand')
  const [fromAddr, apiBase, registered] = await Promise.all([
    campaignMailFromAsync(),
    apiBaseUrl(),
    recipientVars(user),
  ])
  const storeName = registered.store_name
  const unsubscribeUrl = buildUnsubscribeUrl(user.unsubscribe_token, campaign.kind as CampaignKind, apiBase)
  // The renderer leaves {store_name} / {store_web} and composer tokens for the sender to fill.
  const tracked = wrapWithTracking(
    renderVars(html, registered, { escape: true }),
    sentId,
    unsubscribeUrl,
    apiBase,
    storeName
  )
  const ampFilled = ampHtml ? renderVars(ampHtml, registered, { escape: true }) : undefined
  const finalSubject = renderVars(subject, registered)

  try {
    await sendAuditedMail({
      from: fromAddr,
      to: user.email,
      subject: finalSubject,
      html: tracked,
      amp: ampFilled,
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
  } catch {
    return { ok: false, reason: 'send_failed' }
  }
}

export async function fetchUserContext(userId: string): Promise<UserContext | null> {
  const row = await queryOne<{
    id: string
    email: string
    first_name: string | null
    last_name: string | null
    unsubscribe_token: string
    is_business: boolean
  }>(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.unsubscribe_token::text AS unsubscribe_token,
            (bp.approval_status = 'approved') AS is_business
     FROM users u
     LEFT JOIN business_profiles bp ON bp.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  )
  if (!row) return null
  // Tenant-aware either way: a tenant store's customers get that store's host, never the platform's.
  const { storeBaseUrlAsync, businessBaseUrlAsync } = await import('@/lib/catalog/brand')
  return { ...row, baseUrl: row.is_business ? await businessBaseUrlAsync() : await storeBaseUrlAsync() }
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
  const rows = items
    .map(i => {
      const img = i.imageUrl || PLACEHOLDER_IMAGE
      const qty = i.quantity != null ? `${i.quantity}${i.unitLabel ? ` ${i.unitLabel}` : ''}` : ''
      const priceCell =
        i.price != null
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
    })
    .join('')
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;margin:16px 0;">${rows}</table>`
}

export function renderHeroProduct(item: {
  name: string
  imageUrl?: string | null
  productUrl?: string | null
  oldPrice?: number
  newPrice?: number
}): string {
  const img = item.imageUrl || PLACEHOLDER_IMAGE
  const priceBlock =
    item.newPrice != null
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

// The campaign's own discount, else the kind's default, but only when its template shows a coupon.
function couponDiscountFor(campaign: Campaign): number {
  if (campaign.discount_percent > 0) return campaign.discount_percent
  const fallback = DEFAULT_COUPON_DISCOUNT[campaign.kind] ?? 0
  if (!fallback) return 0
  const c = campaign as unknown as { subject_template?: unknown; body_template?: unknown }
  const tpl = [c.subject_template, c.body_template].filter(t => typeof t === 'string').join(' ')
  return !tpl || /\{\{?\s*couponCode\s*\}?\}/i.test(tpl) ? fallback : 0
}

export async function resolveCoupon(
  campaign: Campaign,
  _userId: string
): Promise<{ couponCode: string; discountPercent: number }> {
  if (campaign.coupon_id) {
    // Inactive or expired assigned coupons fall through to a fresh one.
    const info = await getAssignedCouponCode(campaign.coupon_id)
    if (info) {
      const pct = info.discountType === 'percentage' ? info.discountValue : 0
      return { couponCode: info.code, discountPercent: pct }
    }
  }
  const discount = couponDiscountFor(campaign)
  if (discount > 0) {
    const code = await generateCouponForCampaign({
      campaignKind: campaign.kind as CampaignKind,
      discountPercent: discount,
      expiresInDays: 14,
    })
    if (code) return { couponCode: code, discountPercent: discount }
  }
  // Coupon creation failed or none applies: the template's {#if couponCode} blocks hide the box.
  return { couponCode: '', discountPercent: 0 }
}

export async function sendAbandonedCartEmail(
  userId: string,
  cartItems: Array<{ name: string; quantity: number; price: number }>
) {
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
      ctaUrl: `${user.baseUrl}/cart`,
    },
  })
}

export async function sendAbandonedCheckoutEmail(
  userId: string,
  order: { id: string; order_number: string; total_amount: string | number }
) {
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
      ctaUrl: `${user.baseUrl}/cart`,
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
      ctaUrl: `${user.baseUrl}/account/orders/${order.id}`,
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
      ctaUrl: `${user.baseUrl}/account/orders/${order.id}`,
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
      ctaUrl: `${user.baseUrl}/products`,
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
      ctaUrl: `${user.baseUrl}/products/${product.slug}`,
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
      ctaUrl: `${user.baseUrl}/products/${product.slug}`,
    },
  })
}

export async function sendTestCampaignEmail(kind: CampaignKind, toEmail: string) {
  const campaign = await getCampaign(kind)
  if (!campaign) return { ok: false, reason: 'campaign_not_found' }

  const { storeBaseUrlAsync, campaignMailFromAsync } = await import('@/lib/catalog/brand')
  const baseUrl = await storeBaseUrlAsync()

  const sampleItems = [
    {
      name: 'Sample Product A',
      quantity: 2,
      price: 500,
      imageUrl: 'https://placehold.co/120x120/e07b3f/ffffff?text=A',
      productUrl: '#',
    },
    {
      name: 'Sample Product B',
      quantity: 1,
      price: 1200,
      imageUrl: 'https://placehold.co/120x120/1a3a4a/ffffff?text=B',
      productUrl: '#',
    },
  ]
  const sampleVars: Record<string, string | number> = {
    firstName: 'Sample',
    itemCount: sampleItems.length,
    cartItems: renderItemRows(sampleItems),
    itemsHtml: renderItemRows(sampleItems),
    productCard: renderHeroProduct({
      name: 'Sample Product',
      imageUrl: 'https://placehold.co/280x280/e07b3f/ffffff?text=Product',
      productUrl: '#',
      oldPrice: 999,
      newPrice: 799,
    }),
    orderNumber: 'TEST-12345',
    total: '2200.00',
    discountPercent: campaign.discount_percent || 10,
    couponCode: 'TEST-CODE',
    productName: 'Sample Product',
    productImageUrl: 'https://placehold.co/280x280/e07b3f/ffffff?text=Product',
    oldPrice: '999',
    newPrice: '799',
    ctaUrl: `${baseUrl}/products`,
    // Loyalty, referral and birthday campaigns.
    tier: 'Gold',
    points: 250,
    pointsWorth: 250,
    rewardPoints: 100,
    referralCode: 'SAMPLE7K2Q',
    shareUrl: `${baseUrl}/r/SAMPLE7K2Q`,
  }

  let web = baseUrl
  try {
    web = new URL(baseUrl).host
  } catch {}
  const registered = await resolveTemplateVariables({
    recipient: { email: toEmail, first_name: 'Sample', last_name: 'Customer' },
    store: web ? { web } : undefined,
  })
  const subject = `[TEST] ${renderCampaignTemplate(campaign.subject_template, sampleVars, registered, false)}`
  // Match the real send: block-builder mode renders the blocks, else the rich-text body; wrap in the
  // campaign's chosen layout (not always Classic). Keeps the test true to what recipients get.
  let bodySource = campaign.body_template
  if ((campaign as any).template_mode === 'blocks' && (campaign as any).blocks != null) {
    const { renderBlocks } = await import('@/lib/templates/blocks')
    const rendered = renderBlocks((campaign as any).blocks)
    if (rendered) bodySource = rendered
  }
  const body = renderCampaignTemplate(bodySource, sampleVars, registered, true)
  const html = renderVars(
    baseLayout(
      subject,
      body +
        `<p style="margin-top:24px;color:#999;font-size:12px;">— This is a test send. Tracking pixel and unsubscribe footer omitted.</p>`,
      baseUrl,
      (campaign as any).template_layout
    ),
    registered,
    { escape: true }
  )

  try {
    await sendAuditedMail({
      from: await campaignMailFromAsync(),
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

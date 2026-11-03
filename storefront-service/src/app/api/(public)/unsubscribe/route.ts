import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/shared/db'
import { currentBrandNameAsync } from '@/lib/catalog/brand'
import { getSiteControls } from '@/lib/catalog/site-controls'
import { resolveGoogleTag, gtagBootstrapScript } from '@/lib/analytics/google-tag'
import { resolveTenant } from '@/lib/tenancy/tenant-context'

export const dynamic = 'force-dynamic'

// The store's Google tag under the storefront's Consent Mode: this page is on the store host, so the
// visitor's cookie choice applies.
async function tagHead(ok: boolean, campaign: string | null): Promise<string> {
  const [c, tenant] = await Promise.all([getSiteControls(), resolveTenant().catch(() => null)])
  const tag = resolveGoogleTag({
    tagId: c.marketing.googleTagId,
    conversionId: c.marketing.googleAdsConversionId,
    conversionLabel: c.marketing.googleAdsConversionLabel,
    isTenant: tenant != null,
  })
  if (!tag.tagIds.length) return ''
  const event = ok ? `gtag('event','unsubscribe',${JSON.stringify({ campaign: campaign || 'all' }).replace(/</g, '\\u003c')});` : ''
  return `<script>${gtagBootstrapScript(tag, true)}${event}</script><script async src="https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(tag.tagIds[0])}"></script>`
}

async function unsubscribe(token: string, campaignKind: string | null): Promise<{ ok: boolean; email?: string }> {
  const user = await queryOne<{ id: string; email: string }>(
    `UPDATE users
     SET marketing_opt_out = TRUE, marketing_opt_out_at = NOW()
     WHERE unsubscribe_token = $1
     RETURNING id, email`,
    [token]
  )
  if (!user) return { ok: false }

  if (campaignKind) {
    await query(
      `UPDATE email_campaigns_sent
       SET unsubscribed_at = NOW()
       WHERE user_id = $1 AND campaign_kind = $2 AND unsubscribed_at IS NULL`,
      [user.id, campaignKind]
    ).catch(() => {})
  }

  return { ok: true, email: user.email }
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const campaign = req.nextUrl.searchParams.get('campaign')

  if (!token) {
    return new NextResponse('Invalid unsubscribe link.', { status: 400, headers: { 'Content-Type': 'text/html' } })
  }

  const result = await unsubscribe(token, campaign)
  const brand = await currentBrandNameAsync()
  const head = await tagHead(result.ok, campaign).catch(() => '')
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Unsubscribed — ${brand}</title>
  ${head}
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 480px; margin: 80px auto; padding: 24px; color: #18181b; text-align: center; }
    h1 { font-size: 24px; margin-bottom: 12px; }
    p { color: #6b7280; line-height: 1.6; }
    a { color: #2563eb; }
  </style>
</head>
<body>
  ${
    result.ok
      ? `<h1>You've been unsubscribed</h1>
       <p>${result.email ? `<strong>${result.email}</strong>` : 'You'} will no longer receive marketing emails from ${brand}.</p>
       <p>You'll still get transactional emails (order confirmations, OTPs, etc.).</p>
       <p style="margin-top:24px;"><a href="/">Return to ${brand}</a></p>`
      : `<h1>Link not recognised</h1>
       <p>This unsubscribe link is invalid or expired. <a href="/account">Sign in</a> to manage email preferences.</p>`
  }
</body>
</html>`

  return new NextResponse(html, {
    status: result.ok ? 200 : 404,
    headers: { 'Content-Type': 'text/html' },
  })
}

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const campaign = req.nextUrl.searchParams.get('campaign')

  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  }
  const result = await unsubscribe(token, campaign)
  return NextResponse.json({ success: result.ok })
}

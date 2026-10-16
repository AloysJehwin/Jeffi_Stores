import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { adsTenantKey, managerClient, saveAdsConfig } from '@/lib/google-ads/credentials'
import { formatCustomerId } from '@/lib/google-ads/client'
import { getAdsConnectionStatus } from '@/lib/google-ads/connection'
import { BILLING_URL, NEW_ACCOUNT_CURRENCY, NEW_ACCOUNT_TIME_ZONE, createStoreAccount } from '@/lib/google-ads/account-create'
import { adsErrorResponse, readJson, withCampaignPlan } from '@/lib/google-ads/manage-route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Body = z.object({
  name: z.string().trim().min(1, 'Name the account').max(100),
  inviteEmail: z.string().trim().email('Enter the Google account email to invite').nullable().optional(),
  preview: z.boolean().optional(),
})

// A new Google Ads account for this store under the platform manager account (INR, Asia/Kolkata),
// saved as a manager-mode connection. Sold with campaign management (Pro and up).
export async function POST(request: NextRequest) {
  const admin = await withCampaignPlan(await requireAdminScope(request, 'google_ads:write'), 'Creating a Google Ads account')
  if (admin instanceof NextResponse) return admin
  const parsed = Body.safeParse(await readJson(request))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 })
  const mgr = managerClient()
  if (!mgr) {
    return NextResponse.json(
      { error: 'The platform manager account is not configured (GOOGLE_ADS_LOGIN_CUSTOMER_ID / GOOGLE_ADS_MANAGER_REFRESH_TOKEN).' },
      { status: 503 }
    )
  }
  const tenantKey = await adsTenantKey()
  const current = await getAdsConnectionStatus(tenantKey)
  if (current.connected && current.connectedVia !== 'platform') {
    return NextResponse.json({ error: `This store is already connected to Google Ads ${formatCustomerId(current.customerId)}. Disconnect it first.` }, { status: 409 })
  }
  try {
    const { name, inviteEmail, preview } = parsed.data
    const result = await createStoreAccount(mgr, { name, inviteEmail: inviteEmail ?? null }, { preview })
    if ('preview' in result) return NextResponse.json({ ok: true, preview: true })
    await saveAdsConfig(
      tenantKey,
      { customer_id: result.customerId, connected_via: 'manager' },
      { account_name: result.name, link_status: 'active', created_by_platform: true, invited_email: result.invitation?.email ?? null }
    )
    await logAdminAudit({
      adminId: admin.adminId,
      action: 'create',
      entityType: 'system',
      entityId: null,
      summary: `Created Google Ads account ${formatCustomerId(result.customerId)} under the platform manager${result.invitation?.sent ? ` and invited ${result.invitation.email}` : ''}`,
      request,
    })
    return NextResponse.json({
      ok: true,
      customerId: result.customerId,
      name: result.name,
      currency: NEW_ACCOUNT_CURRENCY,
      timeZone: NEW_ACCOUNT_TIME_ZONE,
      invitation: result.invitation,
      billingUrl: BILLING_URL,
      status: await getAdsConnectionStatus(tenantKey),
    })
  } catch (e) {
    return adsErrorResponse(e)
  }
}

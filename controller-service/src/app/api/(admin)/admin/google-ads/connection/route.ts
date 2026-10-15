import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import {
  adsTenantKey,
  readAdsConfig,
  saveAdsConfig,
  deleteAdsConfig,
  managerClient,
  type GoogleAdsConfig,
} from '@/lib/google-ads/credentials'
import { GoogleAdsClient, GoogleAdsApiError, isValidCustomerId, normalizeCustomerId, formatCustomerId } from '@/lib/google-ads/client'
import { verifyAccount } from '@/lib/google-ads/accounts'
import { getAdsConnectionStatus } from '@/lib/google-ads/connection'
import { isAdsSyncRunning } from '@/lib/google-ads/sync'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const customerId = z.string().trim().refine(isValidCustomerId, 'Enter the 10-digit customer id (123-456-7890)')
const optionalId = z
  .string()
  .trim()
  .optional()
  .nullable()
  .refine(v => !v || isValidCustomerId(v), 'Manager id must be a 10-digit customer id')

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('select'), customerId, loginCustomerId: optionalId }),
  z.object({
    action: z.literal('manual'),
    customerId,
    loginCustomerId: optionalId,
    refreshToken: z.string().trim().min(20, 'Paste the OAuth refresh token'),
  }),
  z.object({ action: z.literal('manager'), customerId, invite: z.boolean().optional() }),
])

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:read')
  if (admin instanceof NextResponse) return admin
  return NextResponse.json(await getAdsConnectionStatus(await adsTenantKey()))
}

const message = (e: unknown) => (e instanceof GoogleAdsApiError || e instanceof Error ? e.message : String(e))

// Connect an account: pick one after Google sign-in, enter credentials by hand, or have the
// manager account manage it. Every path proves access with one read before saving.
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:write')
  if (admin instanceof NextResponse) return admin
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 })
  }
  const body = parsed.data
  const tenantKey = await adsTenantKey()
  const cid = normalizeCustomerId(body.customerId)

  let cfg: GoogleAdsConfig
  let client: GoogleAdsClient
  try {
    if (body.action === 'manager') {
      const mgr = managerClient({ retryDelays: [] })
      if (!mgr) {
        return NextResponse.json(
          { error: 'The platform manager account is not configured (GOOGLE_ADS_LOGIN_CUSTOMER_ID / GOOGLE_ADS_MANAGER_REFRESH_TOKEN).' },
          { status: 503 }
        )
      }
      cfg = { customer_id: cid, connected_via: 'manager' }
      client = mgr.forCustomer(cid, mgr.customerId)
      try {
        const info = await verifyAccount(client)
        await saveAdsConfig(tenantKey, cfg, { account_name: info.descriptive_name, link_status: 'active' })
      } catch (e) {
        if (!body.invite) throw e
        // Not linked yet: send a manager link invitation the owner accepts in Google Ads.
        await mgr.post('/customerClientLinks:mutate', {
          operation: { create: { clientCustomer: `customers/${cid}`, status: 'PENDING' } },
        })
        await saveAdsConfig(tenantKey, cfg, { link_status: 'invited' })
        await audit(request, admin.adminId, `Invited Google Ads ${formatCustomerId(cid)} to the platform manager account`)
        return NextResponse.json({
          ok: true,
          invited: true,
          message: `Invitation sent. In Google Ads for ${formatCustomerId(cid)}, open Admin > Access and security > Managers and accept it.`,
        })
      }
    } else {
      const existing = body.action === 'select' ? await readAdsConfig(tenantKey) : null
      const refreshToken = body.action === 'manual' ? body.refreshToken : existing?.oauth_refresh_token
      if (!refreshToken) return NextResponse.json({ error: 'Sign in with Google first.' }, { status: 400 })
      cfg = {
        oauth_refresh_token: refreshToken,
        customer_id: cid,
        login_customer_id: body.loginCustomerId ? normalizeCustomerId(body.loginCustomerId) : undefined,
        connected_via: body.action === 'manual' ? 'manual' : 'oauth',
        // The sign-in's granted scopes stay with its token (conversion uploads check them).
        ...(body.action === 'select' && existing?.scopes ? { scopes: existing.scopes } : {}),
      }
      client = new GoogleAdsClient({ refreshToken, customerId: cid, loginCustomerId: cfg.login_customer_id, retryDelays: [] })
      const info = await verifyAccount(client)
      await saveAdsConfig(tenantKey, cfg, { account_name: info.descriptive_name })
    }
  } catch (e) {
    return NextResponse.json({ error: message(e) }, { status: 400 })
  }

  await audit(request, admin.adminId, `Connected Google Ads account ${formatCustomerId(cid)} (${cfg.connected_via})`)
  return NextResponse.json({ ok: true, status: await getAdsConnectionStatus(tenantKey) })
}

// The synced report data stays (it is the store's own history); only the credential goes.
export async function DELETE(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:write')
  if (admin instanceof NextResponse) return admin
  if (await isAdsSyncRunning()) {
    return NextResponse.json({ error: 'A Google Ads sync is running. Disconnect once it finishes.' }, { status: 409 })
  }
  await deleteAdsConfig(await adsTenantKey())
  await audit(request, admin.adminId, 'Disconnected Google Ads')
  return NextResponse.json({ ok: true })
}

function audit(request: NextRequest, adminId: string | null, summary: string) {
  return logAdminAudit({ adminId, action: 'update', entityType: 'system', entityId: null, summary, request })
}

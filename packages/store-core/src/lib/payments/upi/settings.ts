import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { query } from '@/lib/shared/db'
import { authenticateAdmin, requireAdminScope } from '@/lib/auth/jwt'
import { hasScope, isPlatformOwner } from '@/lib/auth/scopes'
import { getIntegrationCredential, getTenantUpiId, setTenantUpiId } from '@/lib/tenant-registry'
import { ROOT_DOMAIN } from '@/lib/tenant-registry/shared'
import { phonePeAccountFor, type PhonePeAccount, type PhonePeAccountInfo } from '@/lib/payments/phonepe-account'
import { alertAddress, PLATFORM_ALERT_SLUG } from './alert-parse'
import { envPhonePeCreds, invalidateUpiModeCache, merchantUpiVpa, storedPhonePeCreds, upiStatus } from './creds'
import { storeDb } from './intents'
import { alertStats } from './upg'

/**
 * What Site Controls → UPI collection shows and changes (docs/plans/UPI_UPG_V2.md §4, §7): the
 * provider in effect, the UPI ID, bank-alert forwarding, and the PhonePe account.
 */

const mask = (k: string) => (k.length > 10 ? `${k.slice(0, 6)}…${k.slice(-4)}` : k)
const base = () => (process.env.PUBLIC_WEBHOOK_BASE_URL || process.env.APP_URL || `https://${ROOT_DOMAIN}`).replace(/\/$/, '')
export const phonePeWebhookUrl = (a: PhonePeAccount) => (a.kind === 'platform' ? `${base()}/api/webhooks/upi` : a.slug ? `${base()}/api/webhooks/upi/${a.slug}` : null)

type Admin = { role: string; scopes?: string[] | null }
/** PhonePe credentials and the UPI ID decide whose account the money reaches: the owner only. */
export const mayEditUpi = (admin: Admin) => isPlatformOwner(admin.role) && hasScope(admin.role, admin.scopes as any, 'financial:write')

export async function phonePeAccountInfo(account: PhonePeAccount, admin: Admin): Promise<PhonePeAccountInfo> {
  const [saved, row, upiId] = await Promise.all([
    storedPhonePeCreds(account.credTenantId).catch(() => null),
    getIntegrationCredential(account.credTenantId, 'phonepe').catch(() => null),
    merchantUpiVpa(account.tenantId).catch(() => null),
  ])
  const creds = saved ?? (account.kind === 'platform' ? envPhonePeCreds() : null)
  return {
    kind: account.kind,
    upiMode: account.upiMode,
    editable: mayEditUpi(admin),
    connected: !!creds,
    ...(account.kind === 'platform' ? { fromEnv: !saved && !!creds } : {}),
    env: creds?.env ?? null,
    clientId: creds ? mask(creds.clientId) : null,
    clientVersion: creds?.clientVersion ?? null,
    merchantId: creds?.merchantId ?? null,
    webhookAuthSet: !!(creds?.webhookUsername && creds?.webhookPassword),
    webhookUrl: phonePeWebhookUrl(account),
    upiId,
    updatedAt: saved ? (row?.meta?.updated_at ?? null) : null,
    updatedBy: saved ? (row?.meta?.updated_by ?? null) : null,
  }
}

/** GET /api/admin/integrations/upi (financial:read) */
export async function handleUpiSettingsGet(request: NextRequest): Promise<NextResponse> {
  const admin = await requireAdminScope(request, 'financial:read')
  if (admin instanceof NextResponse) return admin
  try {
    const account = await phonePeAccountFor()
    const [status, vpa, phonepe] = await Promise.all([upiStatus(account.tenantId), merchantUpiVpa(account.tenantId), phonePeAccountInfo(account, admin)])
    const stats = await alertStats(vpa?.toLowerCase() ?? null, storeDb).catch(() => ({ lastAlertAt: null, trustedCount30d: 0, gmailConfirmation: null }))
    const { upiMode: _m, upiId: _u, updatedAt: _a, updatedBy: _b, ...phonepeView } = phonepe
    return NextResponse.json({
      provider: status.provider,
      killed: status.killed,
      ...(status.reason ? { reason: status.reason } : {}),
      vpa,
      vpaEditable: mayEditUpi(admin),
      alerts: {
        address: alertAddress(account.slug ?? PLATFORM_ALERT_SLUG),
        // A bank's own alert reached us and verified in the last 30 days.
        connected: stats.trustedCount30d > 0,
        lastAlertAt: stats.lastAlertAt,
        trustedCount30d: stats.trustedCount30d,
        ...(stats.gmailConfirmation ? { gmailConfirmation: stats.gmailConfirmation } : {}),
      },
      phonepe: phonepeView,
    })
  } catch (e: any) {
    console.error('[upi:settings]', e?.message ?? e)
    return NextResponse.json({ error: 'Could not load the UPI settings' }, { status: 500 })
  }
}

const VpaBody = z.object({ vpa: z.string().trim().max(120).regex(/^[\w.\-]{2,}@[a-zA-Z][a-zA-Z0-9]{1,}$/, 'A UPI ID looks like name@bank') })

/** PUT /api/admin/integrations/upi/vpa { vpa } — store owner / platform owner, financial:write. */
export async function handleUpiVpaPut(request: NextRequest): Promise<NextResponse> {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'financial:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  if (!isPlatformOwner(admin.role)) return NextResponse.json({ error: 'Only the owner can change the UPI ID.' }, { status: 403 })
  const parsed = VpaBody.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 })
  const vpa = parsed.data.vpa.toLowerCase()
  try {
    const account = await phonePeAccountFor()
    if (account.kind === 'platform') {
      await query(`INSERT INTO site_settings (key, value, updated_at) VALUES ('upi_vpa', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [vpa])
    } else if (!(await setTenantUpiId(account.tenantId!, vpa))) {
      return NextResponse.json({ error: 'Add your settlement bank account first (Ecom Store → Payouts), then set the UPI ID.' }, { status: 409 })
    }
    invalidateUpiModeCache()
    return NextResponse.json({ ok: true, vpa: account.kind === 'platform' ? vpa : ((await getTenantUpiId(account.tenantId!).catch(() => null)) ?? vpa) })
  } catch (e: any) {
    console.error('[upi:vpa]', e?.message ?? e)
    return NextResponse.json({ error: 'Could not save the UPI ID' }, { status: 500 })
  }
}
